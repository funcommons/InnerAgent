/**
 * [port] API 错误类型 — 自 $SRC/src/api/errorCodes.ts 裁剪移植 (去掉未使用的
 * HTTP_STATUS 之外的常量与业务错误码表), 改动类型: [port] 机械复制 + 裁剪。
 * i18n 文案在 client.ts 内直接内联中文兜底 (SDK 不带 vue-i18n 依赖)。
 */

/** HTTP 状态码 (沿用源实现子集) */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const

/** framework4j 字段级错误 (param validate 失败) */
export interface ApiFieldError {
  field: string
  code?: string
  message: string
  rejectedValue?: unknown
}

export interface ApiErrorOptions {
  status?: number
  traceId?: string
  silent?: boolean
  details?: ApiFieldError[]
}

/** 业务/HTTP 统一错误 (源 ApiError 语义保持: code 为业务码或 HTTP status, 0 = 网络层) */
export class ApiError extends Error {
  readonly code: number
  readonly status?: number
  readonly traceId?: string
  readonly details?: ApiFieldError[]
  silent?: boolean

  constructor(code: number, message: string, options: ApiErrorOptions = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status
    this.traceId = options.traceId
    this.details = options.details
    if (options.silent) this.silent = true
  }

  /** 源实现语义: 业务码 10200 或 HTTP 401 视为未认证 */
  isAuthError(): boolean {
    return this.code === 10200 || this.status === 401
  }
}
