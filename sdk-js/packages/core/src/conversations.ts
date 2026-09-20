/**
 * [adapt] 助手会话历史 API — 源: $SRC/src/api/assistant.ts。
 *
 * 端点重映射 (契约: GET /api/ai/assistant/conversations* → GET {base}/conversations*):
 * - GET    {base}/reference-options                     助手可引用 Skill/MCP 工具 (→ /me 域, 见 me.ts 契约偏差)
 * - GET    {base}/conversations?pageNo&pageSize&category 会话列表 (分页, category 过滤)
 * - GET    {base}/conversations/{conversationId}/messages 会话消息列表
 * - DELETE {base}/conversations/{id}                    按数据库 id 删除
 * - DELETE {base}/conversations/by-conversation-id/{id} 按稳定会话标识幂等删除
 *
 * 流式端点由 runs.ts 承载 —— 助手聊天与 Run 共用同一套 SSE 契约。
 */

import { getBaseURL } from './config'
import { http } from './client'
import type { AiMultimodalInput, ToolExecutionMode } from './runs'

// ========== 类型定义 ([port]) ==========

export type { AiMultimodalInput, ToolExecutionMode }

/** 助手对话 (后端 AgentConversation 实体) */
export interface AgentConversation {
  id: number
  conversationId: string
  userId: number
  projectId: number | null
  contextType?: string
  agentType?: string
  category?: string
  contextId?: number
  title: string
  messageCount: number
  lastMessageTime?: string
  status: string
  agentStateStatus?: 'ACTIVE' | 'EXPIRED'
  createTime?: string
}

/** 助手消息 (后端 AgentMessage 实体; role: user/assistant/tool) */
export interface AgentMessage {
  id: number
  conversationId: string
  runId?: string
  projectionKey?: string
  role: string
  content: string
  referencesJson?: string
  toolName?: string
  toolStatus?: string
  /** 工具调用 ID（关联同一次调用的发起和结果） */
  toolCallId?: string
  /** 父级工具调用 ID（子 Agent 事件归属） */
  parentToolCallId?: string
  reasoningContent?: string
  reasoningDurationMs?: number | null
  messageOrder: number
  createTime?: string
}

export interface AssistantPageResult<T> {
  list: T[]
  total: number
}

export interface AssistantSkillReferenceOption {
  id: string
  name: string
  displayName: string
  description: string
  source: string
}

export interface AssistantMcpToolReferenceOption {
  serverName: string
  toolName: string
  description: string
  readOnly: boolean
}

export interface AssistantReferenceOptions {
  skills: AssistantSkillReferenceOption[]
  mcpTools: AssistantMcpToolReferenceOption[]
}

/** 发送消息时的引用上下文 (源 AssistantMessageReferences) */
export interface AssistantMessageProjectReference {
  id: number
  name: string
  description?: string
}

export interface AssistantMessageReferences {
  project?: AssistantMessageProjectReference | null
  skills: AssistantSkillReferenceOption[]
  mcpTools: AssistantMcpToolReferenceOption[]
  multimodalInputs?: AiMultimodalInput[]
}

// ========== Query API ==========

/** 获取助手可主动引用的 Skill 与 MCP 工具 (契约偏差: 落 /me 域, 见 me.ts) */
export async function getAssistantReferenceOptions(): Promise<AssistantReferenceOptions> {
  return http.get<AssistantReferenceOptions>(`${getBaseURL()}/me/reference-options`)
}

/** 获取对话列表（分页; category=assistant 时仅助手对话） */
export async function listConversations(params: {
  pageNo: number
  pageSize: number
  category?: string
}): Promise<AssistantPageResult<AgentConversation>> {
  const searchParams = new URLSearchParams({
    pageNo: String(params.pageNo),
    pageSize: String(params.pageSize),
  })
  if (params.category) {
    searchParams.set('category', params.category)
  }
  return http.get<AssistantPageResult<AgentConversation>>(
    `${getBaseURL()}/conversations?${searchParams}`,
  )
}

/** 获取对话消息列表 */
export async function listMessages(conversationId: string): Promise<AgentMessage[]> {
  return http.get<AgentMessage[]>(
    `${getBaseURL()}/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
}

/** 删除对话 (按数据库 id) */
export async function deleteConversation(id: number): Promise<void> {
  await http.delete(`${getBaseURL()}/conversations/${id}`)
}

/** 按稳定会话标识幂等删除，兼容尚未同步数据库 ID 的乐观会话。 */
export async function deleteConversationByConversationId(conversationId: string): Promise<void> {
  await http.delete(
    `${getBaseURL()}/conversations/by-conversation-id/${encodeURIComponent(conversationId)}`,
  )
}
