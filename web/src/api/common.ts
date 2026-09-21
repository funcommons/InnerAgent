/**
 * [new] InnerAgent 管理 API 通用信封与分页类型。
 * 信封对齐服务端 com/inneragent/platform/common/CommonResult:{code,msg,data},
 * code===0 成功;错误时 HTTP 状态=业务 code,响应体仍为该信封(P2 对齐)。
 * 分页请求/响应对齐服务端 PageResult 形状(list + total + pageNo/pageSize):
 * audit-logs / model-configs / webhook-deliveries 等分页域共用。
 */

/** 业务信封(code===0 成功;data 为载荷;服务端字段名为 msg) */
export interface CommonResult<T> {
  code: number
  /** 服务端信封字段(主要形) */
  msg?: string
  /** 历史兼容字段(过渡期与 msg 双读) */
  message?: string
  data: T
  /** 字段级校验错误(部分校验失败场景) */
  error?: Array<{ field: string; code?: string; message: string; rejectedValue?: unknown }>
  trace_id?: string
}

/** 分页响应(仅 mock 域使用:audit-logs/model-configs/webhook deliveries 等) */
export interface PageResult<T> {
  list: T[]
  total: number
  pageNo: number
  pageSize: number
}

/** 分页请求基类(仅 mock 域使用;真实 apps/tools/grants 列表无分页) */
export interface PageQuery {
  pageNo?: number
  pageSize?: number
}

/** 审计通用时间戳格式(ISO-8601;服务端 LocalDateTime 序列化可无时区后缀) */
export type IsoDateTime = string
