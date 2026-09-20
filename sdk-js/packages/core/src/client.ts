/**
 * [adapt] HTTP 客户端 — 源: $SRC/src/api/request.ts (axios 拦截器实现)。
 *
 * 定向适配 (与源实现的差异, 其余信封/错误语义 1:1):
 * 1. axios → 原生 fetch: SDK 不引入 axios, FormData/JSON Content-Type 处理内联。
 * 2. 鉴权: userStore accessToken/refreshToken → 契约 tokenGetter 回调
 *    (`Authorization: Bearer <embed token>`); 401 时**再次调用 tokenGetter**
 *    (过期懒换, 单飞合并) 并重试一次, 不再区分 refreshToken/登录页跳转。
 * 3. baseURL: '' (同源代理) → config.baseURL (默认 '/ia/api/v1', 契约 API 重映射)。
 * 4. 拆除业务依赖: vue-router (redirectToLogin)、vue-i18n (文案内联中文兜底)、
 *    Idempotency-Key 头 (InnerAgent 契约未定义, confirm 幂等由服务端 §6.4 保证)。
 * 5. X-Trace-Id 链路追踪保留 (crypto.randomUUID, sessionStorage 降级安全)。
 */

import { getBaseURL, getSdkConfig } from './config'
import { ApiError, HTTP_STATUS, type ApiFieldError } from './errorCodes'

const TRACE_ID_STORAGE_KEY = 'inneragent:trace-id'

function getOrCreateTraceId(): string {
  let traceId = ''
  try {
    traceId = sessionStorage.getItem(TRACE_ID_STORAGE_KEY) || ''
  } catch {
    // sessionStorage 不可用 (SSR / 隐私模式), 退化为每次新生成
  }
  if (!traceId) {
    traceId = newTraceId()
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}

function newTraceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ---- 401 懒换单飞: 并发请求共享同一次 tokenGetter 重取 ----

let tokenRefreshPromise: Promise<string | null> | null = null

/** 单飞重取 token (契约: tokenGetter 被再次调用; null 表示宿主明确给不出 token) */
export function refreshTokenSingleFlight(): Promise<string | null> {
  if (!tokenRefreshPromise) {
    const { tokenGetter } = getSdkConfig()
    tokenRefreshPromise = Promise.resolve()
      .then(() => tokenGetter())
      .finally(() => { tokenRefreshPromise = null })
  }
  return tokenRefreshPromise
}

// 测试隔离用: 单飞窗口强拆 (正常无需调用)
export function resetTokenRefreshSingleFlight(): void {
  tokenRefreshPromise = null
}

/** 内部: 解析本次请求携带的 token (override 用于 401 懒换重试)。sseAuth 复用。 */
export async function resolveToken(override?: string | null): Promise<string | null> {
  if (override !== undefined) return override
  const { tokenGetter } = getSdkConfig()
  return Promise.resolve().then(() => tokenGetter())
}

export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** 请求体; FormData 时由 fetch 自动带 multipart boundary。 */
  body?: unknown
  /** 静默请求: 错误对象标记 silent, 由调用方决定如何呈现。 */
  silent?: boolean
  /** 请求超时毫秒, 默认 30000; 0 = 不超时 (上传/下载大文件)。 */
  timeoutMs?: number
  headers?: Record<string, string>
  /** 内部: 401 已重试过一次 (懒换只重试一次, 防死循环)。 */
  __retried?: boolean
  /** 内部: 401 懒换后用于重试的新 token。 */
  __overrideToken?: string | null
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData
}

function serializeBody(config: RequestConfig): BodyInit | undefined {
  const { body } = config
  if (body === undefined || body === null) return undefined
  if (isFormDataBody(body) || typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body
  return JSON.stringify(body)
}

function baseHeaders(config: RequestConfig): Headers {
  const headers = new Headers(config.headers)
  const { body } = config
  if (isFormDataBody(body)) {
    headers.delete('Content-Type')
  } else if (typeof body === 'string') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  } else if (body !== undefined && body !== null && !(body instanceof URLSearchParams)) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

/** CommonResult 信封 (融光形状: code===0 成功; msg/message 错误文案) */
interface CommonResultEnvelope {
  code?: number
  data?: unknown
  msg?: string
  message?: string
  error?: unknown
  trace_id?: string
}

function fieldErrors(error: unknown): ApiFieldError[] {
  if (!Array.isArray(error)) return []
  return error
    .filter((e): e is Record<string, unknown> => e != null && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string')
    .map((e) => ({
      field: typeof e.field === 'string' ? e.field : '',
      code: typeof e.code === 'string' ? e.code : undefined,
      message: e.message as string,
      rejectedValue: e.rejectedValue,
    }))
}

function readTraceId(headers: Headers, body: CommonResultEnvelope | null): string {
  const headerVal = headers.get('x-trace-id') || ''
  const traceId = headerVal || body?.trace_id || ''
  if (traceId) {
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}

function timeoutFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!timeoutMs) return fetch(url, init)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  // 外部 signal 与内部超时并存: 外部中断也触发
  const linkedSignal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  return fetch(url, { ...init, signal: linkedSignal }).finally(() => clearTimeout(timer))
}

/**
 * 单次请求 (含 401 懒换重试 + 信封解包)。
 * 返回信封 data 字段; 非 0 业务码 / HTTP 错误 → ApiError。
 * 相对路径自动拼 baseURL (仅 http(s):// 视为绝对地址)。
 */
export async function request<T = unknown>(url: string, config: RequestConfig = {}): Promise<T> {
  const isAbsolute = /^https?:\/\//.test(url)
  const fullUrl = isAbsolute ? url : `${getBaseURL()}${url.startsWith('/') ? '' : '/'}${url}`
  return doRequest<T>(fullUrl, config)
}

async function doRequest<T = unknown>(fullUrl: string, config: RequestConfig): Promise<T> {
  const headers = baseHeaders(config)

  const token = await resolveToken(config.__overrideToken)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Trace-Id', getOrCreateTraceId())

  let response: Response
  try {
    response = await timeoutFetch(fullUrl, {
      method: config.method ?? 'GET',
      headers,
      body: serializeBody(config),
    }, config.timeoutMs ?? 30_000)
  } catch {
    throw new ApiError(0, '网络错误，请稍后重试', { silent: config.silent })
  }

  // 401 → 再次调用 tokenGetter (过期懒换, 单飞) → 用新 token 重试一次。
  // 宿主 tokenGetter 返回 null 表示给不出 token → 不重试, 按 401 抛错。
  if (response.status === HTTP_STATUS.UNAUTHORIZED && !config.__retried) {
    const freshToken = await refreshTokenSingleFlight().catch(() => null)
    if (freshToken) {
      return doRequest<T>(fullUrl, { ...config, __retried: true, __overrideToken: freshToken })
    }
  }

  if (!response.ok) {
    const { message, body } = await readErrorPayload(response)
    throw new ApiError(response.status, message, {
      status: response.status,
      silent: config.silent,
      traceId: readTraceId(response.headers, body),
    })
  }

  const payload = (await response.json().catch(() => null)) as CommonResultEnvelope | null
  if (payload === null || payload.code === undefined) {
    return payload as T
  }
  if (payload.code === 0) {
    readTraceId(response.headers, payload)
    return payload.data as T
  }
  throw new ApiError(payload.code, payload.message || payload.msg || '请求失败', {
    silent: config.silent,
    traceId: readTraceId(response.headers, payload),
    details: fieldErrors(payload.error),
  })
}

async function readErrorPayload(response: Response): Promise<{ message: string; body: CommonResultEnvelope | null }> {
  let body: CommonResultEnvelope | null = null
  try {
    const text = await response.text()
    if (text.trim()) body = JSON.parse(text) as CommonResultEnvelope
  } catch {
    body = null
  }
  let message = '请求失败'
  switch (response.status) {
    case HTTP_STATUS.BAD_REQUEST: message = body?.message || '请求参数错误'; break
    case HTTP_STATUS.UNAUTHORIZED: message = body?.msg || body?.message || '登录已过期，请重新登录'; break
    case HTTP_STATUS.FORBIDDEN: message = '没有权限访问'; break
    case HTTP_STATUS.NOT_FOUND: message = '请求的资源不存在'; break
    case HTTP_STATUS.INTERNAL_SERVER_ERROR: message = body?.message || '服务器内部错误'; break
    default: message = body?.message || `请求失败 (${response.status})`
  }
  return { message, body }
}

export const http = {
  get<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...config, method: 'GET' })
  },
  post<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...config, method: 'POST', body: data })
  },
  put<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...config, method: 'PUT', body: data })
  },
  delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...config, method: 'DELETE' })
  },
  patch<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...config, method: 'PATCH', body: data })
  },
}
