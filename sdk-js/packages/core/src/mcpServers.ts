/**
 * [new] 用户级三方 MCP 服务器 API (P4/W15 SDK 配置视图, 02-技术方案 §9.1
 * 「Skill/MCP 用户配置 → 迁至 SDK 配置视图」)。
 *
 * 契约对齐 inneragent-server McpUserServerController (P4 批次① commit 4212188):
 * - GET    {base}/mcp-servers              本人列表 (行级 userId 隔离, 含停用)
 * - GET    {base}/mcp-servers/{id}         详情
 * - POST   {base}/mcp-servers              注册 (防 SSRF; OAUTH 即 501)
 * - PUT    {base}/mcp-servers/{id}         更新
 * - POST   {base}/mcp-servers/{id}/enable  启用 (其三方工具回到本人目录)
 * - POST   {base}/mcp-servers/{id}/disable 停用 (从本人目录摘除其全部三方工具)
 * - DELETE {base}/mcp-servers/{id}         删除
 *
 * 安全口径 (与服务端 VO 同步):
 * - credentials 永不回显原文, 响应仅携带打码形 `credentialsMasked`
 *   (前 2 字符 + ***); 注册/更新请求体是 credentials 唯一出口。
 * - 行级隔离在服务端强制 (requireCurrentUserId), SDK 不做本地权限假设。
 *
 * 配置视图消费面 (读模式为主): list/get + enable/disable;
 * register/update/remove 面向 headless 宿主自定义 UI 完整暴露。
 */

import { http } from './client'

/** 三方 MCP 服务器 (服务端 McpServerRespVO; 应用级与用户级同形) */
export interface McpUserServer {
  id: number
  /** 服务器键 (FQN 命名空间, 字母/数字/连字符) */
  serverKey: string
  name: string
  /** Streamable HTTP 端点 URL */
  endpointUrl: string
  /** 传输方式 (当前 streamable-http) */
  transport: string
  /** 鉴权策略: STATIC_HEADER | OAUTH(501 占位) */
  authType: string
  headerName: string | null
  /** 静态头值打码形 (前 2 字符 + ***); 原文永不回显 */
  credentialsMasked: string | null
  /** tools/call 超时 (秒, 1-600) */
  timeoutSeconds: number | null
  enabled: boolean
  updateTime: string | null
}

/** 注册/更新请求体 (服务端 McpServerSaveReqVO; 应用级与用户级同形) */
export interface McpUserServerSaveReq {
  serverKey: string
  name: string
  endpointUrl: string
  /** 缺省 streamable-http */
  transport?: string
  /** 缺省 STATIC_HEADER; OAUTH 为 501 占位 */
  authType?: string
  /** STATIC_HEADER 必填 */
  headerName?: string
  /** 静态头值 (STATIC_HEADER 必填; 服务端打码回显) */
  credentials?: string
  /** 缺省 30, 1-600 */
  timeoutSeconds?: number
  /** 缺省 true */
  enabled?: boolean
}

export const mcpUserServersApi = {
  /** 本人的三方 MCP 服务器列表 (含停用; 配置视图主列表) */
  list(): Promise<McpUserServer[]> {
    return http.get<McpUserServer[]>('/mcp-servers')
  },

  /** 详情 */
  get(id: number): Promise<McpUserServer> {
    return http.get<McpUserServer>(`/mcp-servers/${id}`)
  },

  /** 注册 (防 SSRF 拒绝本机/内网地址; OAUTH 即 501) */
  register(req: McpUserServerSaveReq): Promise<McpUserServer> {
    return http.post<McpUserServer>('/mcp-servers', req)
  },

  /** 更新 (credentials 不传/空 → 保持原值口径由服务端定, 见差距清单) */
  update(id: number, req: McpUserServerSaveReq): Promise<McpUserServer> {
    return http.put<McpUserServer>(`/mcp-servers/${id}`, req)
  },

  /** 启用 */
  enable(id: number): Promise<McpUserServer> {
    return http.post<McpUserServer>(`/mcp-servers/${id}/enable`)
  },

  /** 停用 (从本人目录摘除其全部三方工具) */
  disable(id: number): Promise<McpUserServer> {
    return http.post<McpUserServer>(`/mcp-servers/${id}/disable`)
  },

  /** 删除 */
  remove(id: number): Promise<boolean> {
    return http.delete<boolean>(`/mcp-servers/${id}`)
  },
}
