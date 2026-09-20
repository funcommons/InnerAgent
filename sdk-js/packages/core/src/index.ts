/**
 * @inneragent/sdk-core — InnerAgent SDK 核心 (任务 P1-T3a)。
 *
 * 职责:
 * - init({ appKey, tokenGetter, theme?, mode? }) 契约入口 (config.ts)
 * - API 重映射: /runs (SSE)、/conversations*、/me/*、/attachments (runs/conversations/me/attachments)
 * - SSE 事件协议解析 (runId:seq、outputType 全集, 协议不变)
 * - 助手状态机: pinia store + 纯事件 reducer (store/ timeline/)
 * - 页面上下文注册 (pageContext: autoReferences + context{page,object})
 */

// ---- 契约入口 ----
export {
  init,
  resetSdkConfig,
  getSdkConfig,
  getBaseURL,
  applyTheme,
  IframeModeNotImplementedError,
  IA_THEME_TOKENS,
  type SdkInitOptions,
  type SdkRuntimeConfig,
  type TokenGetter,
  type SdkMode,
  type IaThemeTokens,
} from './config'

// ---- HTTP / SSE 基建 ----
export { http, request } from './client'
export { ApiError, HTTP_STATUS, type ApiFieldError } from './errorCodes'
export { authenticatedFetch } from './sseAuth'

// ---- Run API (SSE + 查询) ----
export {
  startRunStream,
  continueRunStream,
  reconnectRunStream,
  cancelRun,
  confirmRunTools,
  expireRunConfirmation,
  getRunStatus,
  listRunningRuns,
  resetRunningListCache,
  type AiChatReq,
  type AiChatStreamEvent,
  type BaseAiChatStreamEvent,
  type OutputType,
  type StreamCallbacks,
  type ToolCallInfo,
  type ToolConfirmationDecision,
  type ToolExecutionMode,
  type PendingToolCallPlan,
  type PendingToolCallInfo,
  type ToolCallScope,
  type RunStatus,
  type RunStatusResponse,
  type RunningRun,
  type RunTarget,
  type AiMultimodalInput,
  type AiMultimodalInputType,
  type AiMultimodalInputTransport,
} from './runs'

// ---- 会话 / 用户配置 / 附件 ----
export {
  getAssistantReferenceOptions,
  listConversations,
  listMessages,
  deleteConversation,
  deleteConversationByConversationId,
  type AgentConversation,
  type AgentMessage,
  type AssistantPageResult,
  type AssistantReferenceOptions,
  type AssistantSkillReferenceOption,
  type AssistantMcpToolReferenceOption,
  type AssistantMessageReferences,
  type AssistantMessageProjectReference,
} from './conversations'
export { aiModelApi, meApi, type AiModel, type MultimodalInputType, type MultimodalInputTransport, type MultimodalInputTransports } from './me'
export { uploadAttachment, type AttachmentTransport } from './attachments'
export { resolveMediaUrl } from './mediaUrl'

// ---- 页面上下文 ----
export {
  setAssistantPageContext,
  clearAssistantPageContext,
  getAssistantPageContext,
  setRunContext,
  clearRunContext,
  getRunContext,
  type AssistantPageContextRef,
  type AssistantRunContext,
} from './pageContext'

// ---- 时间线 reducer (纯函数) ----
export {
  createInitialPipelineState,
  createPendingPipelineState,
  pendingPipelineForNextRun,
  reducePipelineEvent,
  reduceAssistantEvent,
  statusIsRunning,
  statusFromPipeline,
  normalizeTitle,
  hasTerminal,
  terminalStatusForEvent,
  hasLiveTranscript,
  persistedToolTimelineStatus,
  cancelCallingTimelineTools,
  messagesToTimeline,
  timelineForMessages,
  messageKey,
  mergeMessages,
  uniqueConversations,
  resolveHistoryErrorMessage,
  type AgentPipelineState,
  type AssistantPendingConfirmation,
} from './timeline/assistantTimeline'
export type { TimelineItem, SubTimelineItem, ToolTimelineStatus } from './timeline/types'

// ---- 展示配置注入 ----
export {
  setAssistantToolDisplayNames,
  getToolDisplayName,
  setSubAgentToolNames,
  resetAssistantDisplayConfig,
} from './displayNames'

// ---- 事件钩子注入 ----
export { setAssistantEventHooks, type AssistantEventHooks } from './store/assistantEvents'

// ---- 约束范围([new] P2-scope 任务 #15:确认等待事件 scope 解析/提取) ----
export {
  normalizeToolCallScope,
  pendingScopeDigest,
  DEGRADED_SCOPE,
  type NormalizedToolCallScope,
} from './scope'

// ---- 助手 store (pinia) ----
export {
  useAssistantStore,
  makeRuntime,
  defaultPersistedState,
  assistantAgentType,
  ASSISTANT_CATEGORY,
  NEW_ASSISTANT_DRAFT_KEY,
  ASSISTANT_STORAGE_SCHEMA_VERSION,
  type AssistantConnectionInfo,
  type AssistantConnectionMode,
  type AssistantConversationRuntime,
} from './store/assistant'
