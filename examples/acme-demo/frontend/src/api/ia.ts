/**
 * InnerAgent 宿主侧 API(docs/接入指南.md §2 步骤⑤)。
 *
 * embed token 签发端点: `GET /api/ia/embed-token` (登录态内; 后端用宿主私钥签
 * RS256 JWT, iss=appKey, sub=用户 ID, exp 建议 12h, 公钥登记给 InnerAgent)。
 *
 * 响应契约 (CommonResult 信封, 由 request.ts 响应拦截器解包):
 *   HTTP 200 { code: 0, data: { token: "<jwt>" } }  → 拦截器解包后得到 { token }
 * 失败 (未登录/网络/非 0 code) → 抛 ApiError, 由调用方 UI 呈现, 不白屏。
 */

import { http } from '@/api/request'

export const IA_EMBED_TOKEN_URL = '/api/ia/embed-token'

export interface IaEmbedTokenData {
  token: string
  expiresIn: number
  appKey: string
}

/** 开通状态四分态 (后端 /api/ia/server-status, 经管理面实时查询) */
export type IaServerState = 'registered' | 'not_registered' | 'unreachable' | 'admin_key_missing'

export interface IaServerStatus {
  state: IaServerState
  appId: number
  appKey: string | null
  signKeyFingerprint: string | null
}

/**
 * 从解包后的响应数据提取 embed token。
 * - { token: string } → token (常规契约)
 * - 非 string 的 token / 空对象 → null (调用方按「拿不到 token」处理)
 * - 纯文本 JWT (三段式) → 原样返回 (兼容裸文本端点形态, 接入指南 §2 步骤⑤示例)
 */
export function extractEmbedToken(data: unknown): string | null {
  if (typeof data === 'string') {
    const token = data.trim()
    return token ? token : null
  }
  if (data && typeof data === 'object') {
    const token = (data as { token?: unknown }).token
    if (typeof token === 'string' && token.trim()) return token.trim()
  }
  return null
}

/**
 * 拉取 embed token; 拿不到返回 null (SDK tokenGetter 的 null 语义: 明确无 token,
 * SDK 按 401 抛 ApiError.isAuthError, 不重试)。静默请求: 失败不弹全局提示,
 * 由嵌入页内嵌错误卡呈现。
 */
export async function fetchIaEmbedToken(): Promise<string | null> {
  const data = await http.get<unknown>(IA_EMBED_TOKEN_URL, {
    silent: true,
    skipAuthRedirect: true,
  })
  return extractEmbedToken(data)
}

/** 开通状态自检 (总览页实时拉取; 探测失败由后端归一为 unreachable, 前端 fail-open) */
export async function fetchIaServerStatus(): Promise<IaServerStatus> {
  return http.get<IaServerStatus>('/api/ia/server-status', { silent: true, skipAuthRedirect: true })
}

// ===== Agent 管理(/ia/agent-admin):创建 / 管理 / 配置 InnerAgent Agent 定义 =====

/** 定义行(管理面 DefinitionView 的页面投影;prompts/spec 取页面所需字段) */
export interface IaAgentDefinitionRow {
  id: number | null
  agentType: string
  kind: string
  name: string
  enabled: boolean
  modelId: number | null
  toolWhitelist: string[]
  subAgentTools: string[]
  systemPrompt: string | null
  greeting: string | null
}

/** 保存请求(definitionId 空=创建;systemPrompt/greeting 空=编辑时保持原值) */
export interface IaAgentSaveReq {
  definitionId: number | null
  agentType: string
  name: string
  kind: string
  enabled: boolean
  modelId: number | null
  toolWhitelist: string[]
  subAgentTools: string[]
  systemPrompt: string
  greeting: string
}

/** 保存结果(bundle import 的 {created,updated,skipped,errors[]}) */
export interface IaAgentSaveResult {
  created: number
  updated: number
  skipped: number
  errors: unknown[]
}

/** 下拉选项聚合(tools/models 为服务端原样行,宽松取字段) */
export interface IaAgentOptions {
  tools: Array<Record<string, unknown>>
  models: Array<Record<string, unknown>>
  subAgents: Array<{ agentType: string; name: string }>
}

/** PageResult(records/list/裸数组)→ 行数组 */
function rowsOf(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const rows = (obj.records ?? obj.list) as unknown
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>
  }
  return []
}

function asString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value : fallback
}

/** 管理面定义行 → 页面行(spec/prompts 宽松解包,缺省安全值) */
function toDefinitionRow(raw: Record<string, unknown>): IaAgentDefinitionRow {
  const spec = (raw.spec ?? null) as Record<string, unknown> | null
  const prompts = (raw.prompts ?? null) as Record<string, unknown> | null
  const whitelist = (spec?.toolWhitelist ?? []) as unknown
  const subTools = (spec?.subAgentTools ?? []) as unknown
  return {
    id: typeof raw.id === 'number' ? raw.id : null,
    agentType: asString(raw.agentType) ?? '',
    kind: asString(raw.kind) ?? 'main',
    name: asString(raw.name) ?? '',
    enabled: raw.enabled !== false,
    modelId: typeof raw.modelId === 'number' ? raw.modelId : null,
    toolWhitelist: Array.isArray(whitelist) ? (whitelist as string[]) : [],
    subAgentTools: Array.isArray(subTools) ? (subTools as string[]) : [],
    systemPrompt: asString(prompts?.systemPrompt),
    greeting: asString(prompts?.greeting),
  }
}

/** 定义分页列表(后端已按本应用过滤) */
export async function fetchAgentDefinitions(): Promise<IaAgentDefinitionRow[]> {
  const data = await http.get<unknown>('/api/ia/agent-admin/definitions')
  return rowsOf(data).map(toDefinitionRow)
}

/** 表单下拉聚合:工具注册表 + 对话模型 + 可挂子 Agent */
export async function fetchAgentOptions(): Promise<IaAgentOptions> {
  const data = (await http.get<Record<string, unknown>>('/api/ia/agent-admin/options')) as {
    tools?: unknown
    models?: unknown
    subAgents?: IaAgentOptions['subAgents']
  }
  return {
    tools: Array.isArray(data.tools) ? (data.tools as Array<Record<string, unknown>>) : [],
    models: Array.isArray(data.models) ? (data.models as Array<Record<string, unknown>>) : [],
    subAgents: Array.isArray(data.subAgents) ? data.subAgents : [],
  }
}

/** 创建 / 覆盖更新单条定义(bundle overwrite 通道;返回导入结果) */
export async function saveAgentDefinition(req: IaAgentSaveReq): Promise<IaAgentSaveResult> {
  return http.post<IaAgentSaveResult>('/api/ia/agent-admin/save', req)
}
