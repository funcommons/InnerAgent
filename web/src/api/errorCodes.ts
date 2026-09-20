/**
 * [adapt] 来源: $SRC/frontend/src/api/errorCodes.ts (mmagix-minicuts-backup/frontend)
 * 改动类型: [adapt] —— 保留 CommonResult(code===0) 信封语义、ApiError、HTTP_STATUS 与
 * 认证/资源/限流错误码段;删除融光业务错误码(内容/群组/作品/积分等)与
 * i18n 依赖;新增管理站所需的 10301(管理 key 无效)/10302(锁定)码段。
 * P2 对齐:服务端管理面错误码即 HTTP 状态镜像(BusinessException.code → HTTP
 * 状态,信封体仍携带 code,见 GlobalExceptionHandler);400/403/404/409 语义
 * 直接对齐,10301/10302 为过渡保留(服务端尚未细分)。
 */

/** 后端业务错误码(信封 code 字段;0 = 成功) */
export const ApiErrorCode = {
  SUCCESS: 0,

  // 系统错误 (10000-10999)
  SYSTEM_ERROR: 10001,
  SERVICE_UNAVAILABLE: 10002,
  SERVICE_TIMEOUT: 10003,

  // 参数错误 (10100-10199)
  INVALID_PARAMETER: 10100,
  REQUIRED_PARAMETER_MISSING: 10101,
  PARAMETER_FORMAT_ERROR: 10102,

  // 认证授权 (10200-10299)
  UNAUTHORIZED: 10200,
  TOKEN_EXPIRED: 10201,
  TOKEN_INVALID: 10202,
  ACCOUNT_DISABLED: 10204,

  // 权限 (10300-10399)
  FORBIDDEN: 10300,
  /** [new] 管理 key 无效(管理站认证,《02-技术方案》§6.3) */
  ADMIN_KEY_INVALID: 10301,
  /** [new] 管理员账号失败锁定(Argon2 + 失败锁定,P2 正式实现) */
  ADMIN_LOCKED: 10302,

  // 资源 (10400-10499)
  RESOURCE_NOT_FOUND: 10400,
  DATA_ALREADY_EXISTS: 10401,
  DATA_STATUS_CONFLICT: 10402,

  // 限流 (10500-10599)
  RATE_LIMIT_EXCEEDED: 10500,
  DUPLICATE_SUBMISSION: 10501,
  THIRD_PARTY_ERROR: 10502,
} as const

export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

/** HTTP 状态码常量 */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

/** 单条字段级校验错误(信封 error[].field / message) */
export interface ApiFieldError {
  /** 字段路径(如 "name"、"publicKey") */
  field: string
  /** 字段级错误码 */
  code?: string
  /** 可读描述 */
  message: string
  /** 拒绝值(用于回显哪个值不对) */
  rejectedValue?: unknown
}

type ApiErrorOptions = {
  status?: number
  silent?: boolean
  traceId?: string
  details?: ApiFieldError[]
}

/** 统一 API 错误对象:拦截器把 HTTP 错误 / 业务错误都转成 ApiError 抛出 */
export class ApiError extends Error {
  /** 业务错误码(来自信封 code;HTTP 错误时复用 HTTP 状态值) */
  public readonly code: number
  /** HTTP 状态码(仅 HTTP 错误时有值) */
  public readonly status?: number
  /** true 则 handleError 不提示,由调用方处理 */
  public silent: boolean
  /** 链路追踪 ID(X-Trace-Id) */
  public readonly traceId?: string
  /** 字段级错误详情 */
  public readonly details?: ApiFieldError[]

  constructor(code: number, message: string, options: ApiErrorOptions = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status
    this.silent = options.silent ?? false
    this.traceId = options.traceId
    this.details = options.details
  }

  /** 业务错误(来自信封 code,HTTP 200) */
  isBusinessError(): boolean {
    return this.status === undefined
  }

  /** HTTP 错误(如 401、500) */
  isHttpError(): boolean {
    return this.status !== undefined
  }

  /**
   * 是否为管理站未认证(应跳登录页)。管理面凭据域独立:embed/M2M 令牌一律无效。
   * P2 对齐:服务端 AdminTokenFilter 对 X-IA-Admin-Key 缺失/错误/未配置(缺省封闭)
   * 一律以 403 拒绝,管理站 403 视为凭据失效统一回登录页(管理站仅访问
   * /ia/api/v1/admin/**,不存在"已登录但无权限"的第二种 403 来源)。
   */
  isAuthError(): boolean {
    if (this.status === HTTP_STATUS.UNAUTHORIZED) return true
    if (this.status === HTTP_STATUS.FORBIDDEN) return true
    if (this.status !== undefined) return false
    return this.code === ApiErrorCode.UNAUTHORIZED
      || this.code === ApiErrorCode.TOKEN_EXPIRED
      || this.code === ApiErrorCode.TOKEN_INVALID
      || this.code === ApiErrorCode.ADMIN_KEY_INVALID
  }
}
