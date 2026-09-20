/**
 * [adapt] 来源: $SRC/frontend/src/api/request.ts (mmagix-minicuts-backup/frontend)
 * 改动类型: [adapt] —— 拆除的业务依赖:
 *   - i18n(文案改管理站内置中文常量)
 *   - refreshToken 双令牌刷新单飞(管理站凭据域独立,见《02-技术方案》§6.3:
 *     embed token 对管理站 API 无效。[DEF-01] 起对齐服务端 18a/AdminTokenFilter
 *     双轨:登录会话 Bearer token(admin 域请求注入 Authorization,无效 401)+
 *     X-IA-Admin-Key 自动化/引导通道(无效/缺失 403 缺省封闭))
 *   - 融光 router/store 直接 import(改为注入式 unauthorizedHandler,避免循环依赖)
 * 保留:CommonResult(code===0)信封解包、ApiError 归一、字段级校验错误解析、
 * X-Trace-Id 链路追踪、写操作 Idempotency-Key、silent 静默标记。
 */
import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { ApiError, HTTP_STATUS } from '@/api/errorCodes'
import type { ApiFieldError } from '@/api/errorCodes'

const TIMEOUT = 30000
const TRACE_ID_STORAGE_KEY = 'ia:trace-id'
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])

function getOrCreateTraceId(): string {
  let traceId = ''
  try {
    traceId = sessionStorage.getItem(TRACE_ID_STORAGE_KEY) || ''
  } catch {
    // sessionStorage 不可用(隐私模式等),退化为每次新生成
  }
  if (!traceId) {
    traceId = uuidv4()
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}

/** 懒注入管理凭据 getter(避免 store ↔ api 循环依赖) */
let adminKeyGetter: (() => string) | null = null
export function setAdminKeyGetter(getter: (() => string) | null) {
  adminKeyGetter = getter
}

/** [DEF-01] 懒注入管理会话 token getter(login 成功后由 authStore 注册) */
let authTokenGetter: (() => string) | null = null
export function setAuthTokenGetter(getter: (() => string) | null) {
  authTokenGetter = getter
}

/** 401/凭据失效时的统一出口(由 authStore 注册,跳登录页) */
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

const request: AxiosInstance = axios.create({
  baseURL: '',
  timeout: TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
})

request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // FormData 上传必须让 axios 自动加 multipart boundary(沿用 $SRC P0 修复)
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type')
    } else if (!config.headers.has('Content-Type') && !(config.data instanceof URLSearchParams)) {
      config.headers.set('Content-Type', 'application/json')
    }

    // [DEF-01] 管理站凭据双轨(对齐服务端 AdminTokenFilter):
    // - 主通道:登录会话 Bearer token,仅对 admin 域请求注入 Authorization;
    // - 引导/自动化通道:X-IA-Admin-Key(Bearer 缺席时兜底注入)。
    // Bearer 无效 → 服务端 401;Admin-Key 无效/缺失 → 403。
    const isAdminApi = typeof config.url === 'string' && config.url.includes('/ia/api/v1/admin')
    if (isAdminApi && authTokenGetter) {
      const token = authTokenGetter()
      if (token) config.headers.set('Authorization', `Bearer ${token}`)
    }
    if (isAdminApi && !config.headers.has('Authorization') && adminKeyGetter) {
      const key = adminKeyGetter()
      if (key) config.headers.set('X-IA-Admin-Key', key)
    }

    // 链路追踪:同一会话保持 trace_id,方便前后端日志串联
    config.headers.set('X-Trace-Id', getOrCreateTraceId())

    // 写操作幂等性:后端可识别重试,防重复提交
    if (config.method && WRITE_METHODS.has(config.method.toLowerCase())) {
      config.headers.set('Idempotency-Key', uuidv4())
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  },
)

function isSilent(config?: AxiosRequestConfig): boolean {
  return (config as RequestConfig | undefined)?.silent === true
}

/** 从响应(header + body)提取 trace_id 并写回 sessionStorage */
function captureTraceId(headers: AxiosResponse['headers'], body: { trace_id?: string } | null | undefined): string {
  const headerVal = headers['x-trace-id'] || headers['X-Trace-Id']
  const traceId = (typeof headerVal === 'string' ? headerVal : '') || body?.trace_id || ''
  if (traceId) {
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}

request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { data, headers } = response

    // 无信封(裸数据/文件流)直接返回
    if (data === null || data === undefined || data.code === undefined) {
      captureTraceId(headers, null)
      return data
    }

    // 业务成功(CommonResult: code === 0)→ 解包 data
    if (data.code === 0) {
      captureTraceId(headers, data)
      return data.data
    }

    // 业务错误 → ApiError(服务端信封字段为 msg,message 为过渡兼容)
    const errorMsg = data.msg || data.message || '请求失败'
    const traceId = captureTraceId(headers, data)
    const details: ApiFieldError[] = Array.isArray(data.error)
      ? data.error
          .filter((e: { message?: unknown } | null) => e != null && typeof e.message === 'string')
          .map((e: { field?: unknown; code?: unknown; message: string; rejectedValue?: unknown }) => ({
            field: typeof e.field === 'string' ? e.field : '',
            code: typeof e.code === 'string' ? e.code : undefined,
            message: e.message,
            rejectedValue: e.rejectedValue,
          }))
      : []
    const apiError = new ApiError(data.code, errorMsg, {
      traceId,
      details: details.length > 0 ? details : undefined,
    })
    if (isSilent(response.config)) {
      apiError.silent = true
    }
    return Promise.reject(apiError)
  },
  (error) => {
    const silent = isSilent(error.config)

    // 401/403:管理凭据失效 → 清登录态 + 跳登录(统一出口,不弹窗)。
    // P2 对齐:服务端 AdminTokenFilter 对凭据缺失/错误/未配置一律 403(缺省封闭)
    const respStatus = error.response?.status
    if (
      (respStatus === HTTP_STATUS.UNAUTHORIZED || respStatus === HTTP_STATUS.FORBIDDEN)
      && unauthorizedHandler
    ) {
      unauthorizedHandler()
    }

    if (error.response) {
      const { status, data, headers } = error.response
      const traceId = captureTraceId(headers, data)
      // 服务端信封字段为 msg(CommonResult{code,msg,data});message 过渡兼容
      const serverMsg: string | undefined = data?.msg || data?.message
      let message = '网络错误,请稍后重试'
      switch (status) {
        case HTTP_STATUS.BAD_REQUEST:
          message = serverMsg || '请求参数错误'
          break
        case HTTP_STATUS.UNAUTHORIZED:
          // 透出后端原始错误(如「管理 key 无效」),无 msg 才回落
          message = serverMsg || '未认证或凭据已失效'
          break
        case HTTP_STATUS.FORBIDDEN:
          // 管理面:AdminTokenFilter 403(缺省封闭/凭据无效)透出原文
          message = serverMsg || '无权执行该操作'
          break
        case HTTP_STATUS.NOT_FOUND:
          message = serverMsg || '资源不存在'
          break
        case HTTP_STATUS.CONFLICT:
          // 如 appKey/工具 FQN 唯一冲突(409)
          message = serverMsg || '资源状态冲突'
          break
        case HTTP_STATUS.LOCKED:
          // [DEF-01] 423:管理员账号锁定(服务端文案含剩余秒数,原样透出)
          message = serverMsg || '账号已锁定,请稍后重试'
          break
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
          message = serverMsg || '服务内部错误'
          break
        default:
          message = serverMsg || `请求失败 (${status})`
      }
      const apiError = new ApiError(status, message, { status, silent, traceId })
      return Promise.reject(apiError)
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError(0, '请求超时', { silent }))
    }
    return Promise.reject(new ApiError(0, '网络错误,请稍后重试', { silent }))
  },
)

/** 封装的请求方法;silent: true 时错误不打全局提示,由调用方处理 */
export interface RequestConfig extends AxiosRequestConfig {
  silent?: boolean
}

// 响应拦截器已把信封解包为 data,故此处的 Promise<T> 即业务载荷类型
// (axios 自身类型无法表达拦截器改写,做一次受控断言)
export const http = {
  get<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return request.get(url, config) as Promise<T>
  },
  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.post(url, data, config) as Promise<T>
  },
  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.put(url, data, config) as Promise<T>
  },
  delete<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return request.delete(url, config) as Promise<T>
  },
  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.patch(url, data, config) as Promise<T>
  },
}

export default request
