/**
 * [new] InnerAgent 管理 API 通用信封与分页类型。
 * 信封沿用融光 CommonResult 形状(code===0 成功),见《02-技术方案》§7.1 兼容策略;
 * 分页请求/响应对齐 $SRC PageResult 形状(list + total + pageNo/pageSize)。
 */

/** 业务信封(code===0 成功;data 为载荷) */
export interface CommonResult<T> {
  code: number
  message?: string
  data: T
  /** 字段级校验错误(部分校验失败场景) */
  error?: Array<{ field: string; code?: string; message: string; rejectedValue?: unknown }>
  trace_id?: string
}

/** 分页响应 */
export interface PageResult<T> {
  list: T[]
  total: number
  pageNo: number
  pageSize: number
}

/** 分页请求基类(所有列表页共用) */
export interface PageQuery {
  pageNo?: number
  pageSize?: number
}

/** 审计通用时间戳格式(ISO-8601,含时区) */
export type IsoDateTime = string
