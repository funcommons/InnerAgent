/**
 * [adapt] 用户级配置 API (模型/Skill/MCP 引用) — 源: $SRC/src/api/ai-model.ts +
 * api/agent-config.ts 的 SDK 消费子集。
 *
 * 契约: `/api/ai/agent-config/*` → `{base}/me/*` (用户级配置)。
 * 偏差 (契约未逐条列出, 取最贴近映射, 服务端 T3b 对齐):
 * - GET /api/ai/model/list-by-type?type=1  → GET {base}/me/models?type=1 (对话模型列表)
 * - GET /api/ai/assistant/reference-options → GET {base}/me/reference-options
 * ai-model.ts 其余管理面端点 (page/create/update/api-config/comfyui…) 属 InnerAgent
 * 管理站 (inneragent-web) 范围, 不进 SDK; AgentWorkspace/迁移端点属服务端自管, 同理裁剪。
 */

import { getBaseURL } from './config'
import { http } from './client'
import type { AssistantReferenceOptions } from './conversations'

// ========== 类型 ([port] 裁剪自 ai-model.ts) ==========

export type MultimodalInputType = 'image' | 'video' | 'audio' | 'file'
export type MultimodalInputTransport = 'url' | 'base64'
export type MultimodalInputTransports = Partial<Record<MultimodalInputType, MultimodalInputTransport[]>>

/** AI 模型 (对话 SDK 消费的字段; 管理面字段裁剪) */
export interface AiModel {
  id: number
  name: string
  code: string
  description: string | null
  status: number
  defaultModel: boolean
  supportVision: boolean
  multimodalInputTypes: MultimodalInputType[]
  multimodalInputTransports: MultimodalInputTransports
  supportReasoning: boolean
  reasoningEffortLevels: string[]
  contextWindow: number | null
}

export type { AssistantReferenceOptions }

// ========== API ==========

export const aiModelApi = {
  /** 按类型获取可用模型列表 (composer 仅消费 type=1 对话模型) */
  listByType: (type: number) =>
    http.get<AiModel[]>(`${getBaseURL()}/me/models?type=${type}`),
}

export const meApi = {
  /** 助手可引用 Skill/MCP 工具 (原 /api/ai/assistant/reference-options) */
  referenceOptions: () =>
    http.get<AssistantReferenceOptions>(`${getBaseURL()}/me/reference-options`),
}
