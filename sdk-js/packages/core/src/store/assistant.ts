/**
 * [port] 助手会话 store。源: $SRC/src/store/assistant.ts (1538 行)。
 *
 * 来源对照:
 * - lib/store/assistant-store.ts → Pinia setup store 主体 (会话分页/选择/发送/
 *   停止/工具确认三链路/删除/历史加载)
 * - lib/store/assistant-connection-coordinator.ts → 连接协调器 (SSE start/reconnect、
 *   后台状态轮询、事件去重、durable cursor 对齐), 并入本文件 (模块级非响应式状态)
 * - lib/store/assistant-runtime.ts / assistant-persistence.ts → makeRuntime +
 *   持久化 (drafts/runIds/cursor/执行模式)
 * - lib/api/ai-assistant.ts → 查询端点移植至 ../conversations.ts
 * - 流式端点复用 ../runs.ts (重映射后的 /runs*)
 *
 * 定向适配 (改动类型 [adapt]):
 * - import 重锚到 core 内部模块 (runs/conversations/pageContext/timeline)
 * - 拆除业务依赖: '@/store/pipeline' (融光 Pipeline 任务卡片 store) →
 *   assistantEventHooks 注入接口 (onToolFinished/onRunTerminal, 默认 no-op)
 * - ASSISTANT_AGENT_TYPE / 存储前缀 / baseURL → config.ts 运行时配置
 * - 请求体 context 合并 pageContext.getRunContext() (契约: context{page,object})
 * - 移植差异 (沿源): zustand → Pinia; 浮窗几何状态机未移植; controller 不进响应式 state
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  cancelRun,
  confirmRunTools,
  expireRunConfirmation,
  getRunStatus,
  startRunStream,
  reconnectRunStream,
  type AiChatReq,
  type AiChatStreamEvent,
  type RunStatusResponse,
  type ToolExecutionMode,
} from '../runs'
import {
  deleteConversation as deleteConversationApi,
  deleteConversationByConversationId,
  listConversations,
  listMessages,
  type AgentConversation,
  type AgentMessage,
  type AssistantMessageReferences,
} from '../conversations'
import {
  getAssistantPageContext,
  getRunContext,
  type AssistantPageContextRef,
} from '../pageContext'
import { getSdkConfig } from '../config'
import { assistantEventHooks } from './assistantEvents'
import {
  createInitialPipelineState,
  hasLiveTranscript,
  hasTerminal,
  normalizeTitle,
  pendingPipelineForNextRun,
  reduceAssistantEvent,
  statusFromPipeline,
  statusIsRunning,
  terminalStatusForEvent,
  timelineForMessages,
  uniqueConversations,
  mergeMessages,
  type AgentPipelineState,
} from '../timeline/assistantTimeline'

// ========== 常量 / 类型 ==========

export const ASSISTANT_CATEGORY = 'assistant'
export const NEW_ASSISTANT_DRAFT_KEY = '__new__'
/**
 * 助手对话使用的 Agent 类型 ([adapt]): 默认沿用融光 'ai_media', 可经
 * init({ agentType }) 覆盖为 InnerAgent 侧定义的 Agent。
 */
export function assistantAgentType(): string {
  try {
    return getSdkConfig().agentType
  } catch {
    return 'ai_media'
  }
}
const PAGE_SIZE = 20

export type AssistantConnectionMode = 'start' | 'reconnect'

/** 连接元数据 (响应式); AbortController 在模块级 Map */
export interface AssistantConnectionInfo {
  conversationId: string
  runId?: string
  connectionGeneration: number
  connectionMode: AssistantConnectionMode
}

export interface AssistantConversationRuntime {
  conversation: AgentConversation
  messages: AgentMessage[]
  pipeline: AgentPipelineState
  draft: string
  status: string
  /** True only after a server status response or a durable SSE event. */
  statusConfirmed: boolean
  /** The run id currently advertised by the server for this conversation. */
  knownRunId?: string
  /** Server metadata only; never used as the local replay cursor. */
  remoteLastSequence?: number
  messagesLoaded: boolean
  messagesLoading: boolean
  messagesError?: string
  connectionError?: string
  /**
   * [P1 #5] 断流静默提示态:传输层断开但可自动恢复(已有 runId / reconnect 模式)。
   * UI 渲染非阻断「连接中断,自动重连中…」并抑制手动重试;事件送达即清除。
   * 与终态失败(start 建流被拒 / 重连耗尽)互斥。
   */
  reconnecting?: boolean
  unread: boolean
  toolExecutionMode: ToolExecutionMode
}

export function makeRuntime(
  conversation: AgentConversation,
  drafts: Record<string, string>,
  runIds: Record<string, string>,
  toolExecutionMode: ToolExecutionMode,
): AssistantConversationRuntime {
  const conversationId = conversation.conversationId
  const knownRunId = runIds[conversationId]
  // The event cursor is meaningful only together with the in-memory timeline.
  // After a page refresh the timeline is empty, so replay from the journal
  // origin to recover reasoning text and its original start timestamp.
  const lastSequence = 0
  return {
    conversation,
    messages: [],
    pipeline: {
      ...createInitialPipelineState(),
      conversationId,
      runId: knownRunId,
      lastSequence,
    },
    draft: drafts[conversationId] ?? '',
    status: conversation.status || 'completed',
    statusConfirmed: !statusIsRunning(conversation.status),
    knownRunId,
    messagesLoaded: false,
    messagesLoading: false,
    reconnecting: false,
    unread: false,
    toolExecutionMode,
  }
}

// ========== 持久化 (旧 assistant-persistence.ts; 几何字段裁剪) ==========

export const ASSISTANT_STORAGE_SCHEMA_VERSION = 1

interface PersistedAssistantState {
  schemaVersion: number
  selectedConversationId: string | null
  selectedModelId: number | null
  drafts: Record<string, string>
  /** A cursor is valid only when its conversation entry has the same run id. */
  runIds: Record<string, string>
  lastSequences: Record<string, number>
  toolExecutionModes: Record<string, ToolExecutionMode>
  newToolExecutionMode: ToolExecutionMode
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function storageKey(userId: string | number): string {
  // [adapt] 前缀 fusion-assistant → config.storagePrefix (默认 inneragent-assistant)
  let prefix = DEFAULT_STORAGE_PREFIX_FALLBACK
  try {
    prefix = getSdkConfig().storagePrefix
  } catch {
    // 未 init 时退回默认前缀 (持久化读取路径允许在 init 前发生)
  }
  return `${prefix}:${userId}:v${ASSISTANT_STORAGE_SCHEMA_VERSION}`
}

const DEFAULT_STORAGE_PREFIX_FALLBACK = 'inneragent-assistant'

function isToolExecutionMode(value: unknown): value is ToolExecutionMode {
  return value === 'DEFAULT'
    || value === 'ALWAYS_ASK'
    || value === 'ALWAYS_ALLOW'
    || value === 'FULL_ACCESS'
}

function safeRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim()) result[key] = entry
  }
  return result
}

function safeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
      result[key] = Math.floor(entry)
    }
  }
  return result
}

function safeToolExecutionModes(value: unknown): Record<string, ToolExecutionMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, ToolExecutionMode> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isToolExecutionMode(entry)) result[key] = entry
  }
  return result
}

function readRaw(userId: string | number): Partial<PersistedAssistantState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const value = parsed as Partial<PersistedAssistantState>
    return value.schemaVersion === ASSISTANT_STORAGE_SCHEMA_VERSION ? value : {}
  } catch {
    return {}
  }
}

export function defaultPersistedState(userId: string | number): PersistedAssistantState {
  const value = readRaw(userId)
  return {
    schemaVersion: ASSISTANT_STORAGE_SCHEMA_VERSION,
    selectedConversationId: typeof value.selectedConversationId === 'string'
      ? value.selectedConversationId
      : null,
    selectedModelId: typeof value.selectedModelId === 'number'
      && Number.isSafeInteger(value.selectedModelId)
      ? value.selectedModelId
      : null,
    drafts: safeRecord(value.drafts),
    runIds: safeRecord(value.runIds),
    lastSequences: safeNumberRecord(value.lastSequences),
    toolExecutionModes: safeToolExecutionModes(value.toolExecutionModes),
    newToolExecutionMode: isToolExecutionMode(value.newToolExecutionMode)
      ? value.newToolExecutionMode
      : 'DEFAULT',
  }
}

function clearAssistantPersistTimer(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
}

// ========== 模块级连接状态 (不进响应式 state) ==========

const expiringConfirmations = new Set<string>()
const connectionControllers = new Map<number, AbortController>()

type ToolConfirmationDecisionTarget =
  | { kind: 'single'; toolCallId: string; approved: boolean }
  | { kind: 'all'; approved: boolean }

function initialConversationToolExecutionMode(
  modes: Record<string, ToolExecutionMode>,
  conversationId: string,
  preferredMode: ToolExecutionMode,
): ToolExecutionMode {
  const persisted = modes[conversationId]
  return persisted === undefined ? preferredMode : persisted
}

/**
 * 汇总发送消息时的页面上下文引用：
 * 页面注册的当前对象 + 助手内显式选择的项目（显式选择优先）。
 * 切换了项目时丢弃原页面的分镜/镜头引用，避免跨项目误操作。
 */
function buildAutoReferences(
  referencedProjectId: number | null | undefined,
  conversationProjectId: number | null,
): AssistantPageContextRef[] | undefined {
  const pageRefs = getAssistantPageContext()
  if (!pageRefs.length) return undefined
  const pageProjectId = pageRefs.find((ref) => ref.type === 'project')?.id ?? null
  const activeProjectId = referencedProjectId ?? conversationProjectId ?? pageProjectId
  if (pageProjectId !== null
    && activeProjectId !== null
    && pageProjectId !== activeProjectId) {
    return [{ type: 'project', id: activeProjectId }]
  }
  return pageRefs
}

// ========== Store ==========

export const useAssistantStore = defineStore('assistant', () => {
  // ---- state ----
  const hydratedUserId = ref<string | number | null>(null)
  const initialized = ref(false)
  /** 助手窗口是否展开 (旧 mode !== 'collapsed'; 由挂载页面/宿主布局驱动) */
  const open = ref(false)
  const selectedConversationId = ref<string | null>(null)
  const selectedModelId = ref<number | null>(null)
  const conversations = ref<AgentConversation[]>([])
  const conversationStates = ref<Record<string, AssistantConversationRuntime>>({})
  const newDraft = ref('')
  const newToolExecutionMode = ref<ToolExecutionMode>('DEFAULT')
  const drawerOpen = ref(false)
  const conversationsLoading = ref(false)
  const conversationsError = ref<string | undefined>(undefined)
  const hasMoreConversations = ref(false)
  const conversationPage = ref(0)
  const connection = ref<AssistantConnectionInfo | null>(null)
  const connectionGeneration = ref(0)

  // ---- 持久化 ----

  function writeAssistantPersisted(): void {
    if (typeof window === 'undefined' || !hydratedUserId.value) return
    const drafts: Record<string, string> = { __new__: newDraft.value }
    const runIds: Record<string, string> = {}
    const lastSequences: Record<string, number> = {}
    const toolExecutionModes: Record<string, ToolExecutionMode> = {}

    for (const [conversationId, runtime] of Object.entries(conversationStates.value)) {
      toolExecutionModes[conversationId] = runtime.toolExecutionMode
      if (runtime.draft) drafts[conversationId] = runtime.draft

      const advertisedRunId = runtime.knownRunId || runtime.pipeline.runId
      if (advertisedRunId) runIds[conversationId] = advertisedRunId

      const cursorRunId = runtime.pipeline.runId
      const cursor = Math.max(0, Math.floor(runtime.pipeline.lastSequence))
      // Never persist a cursor without the run identity it belongs to.
      if (cursor > 0 && cursorRunId && cursorRunId === advertisedRunId) {
        lastSequences[conversationId] = cursor
      }
    }

    const value: PersistedAssistantState = {
      schemaVersion: ASSISTANT_STORAGE_SCHEMA_VERSION,
      selectedConversationId: selectedConversationId.value,
      selectedModelId: selectedModelId.value,
      drafts,
      runIds,
      lastSequences,
      toolExecutionModes,
      newToolExecutionMode: newToolExecutionMode.value,
    }
    try {
      localStorage.setItem(storageKey(hydratedUserId.value), JSON.stringify(value))
    } catch {
      // A full/private storage must never break the assistant UI.
    }
  }

  function persist(): void {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      writeAssistantPersisted()
    }, 250)
  }

  function commitAssistantPersist(): void {
    writeAssistantPersisted()
  }

  // ---- runtime 操作 ----

  function updateRuntime(
    conversationId: string,
    updater: (runtime: AssistantConversationRuntime) => AssistantConversationRuntime,
  ): void {
    const runtime = conversationStates.value[conversationId]
    if (!runtime) return
    conversationStates.value = {
      ...conversationStates.value,
      [conversationId]: updater(runtime),
    }
  }

  // ============ 连接协调器 (旧 assistant-connection-coordinator.ts) ============

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollInFlightGeneration: number | null = null
  let pollFailureCount = 0
  let lifecycleGeneration = 0
  let ensureGeneration = 0
  let pendingEnsure: { conversationId: string; generation: number } | null = null
  let ensureRetryTimer: ReturnType<typeof setTimeout> | null = null
  const eventKeysByRun = new Map<string, Set<string>>()
  const metadataGenerations = new Map<string, number>()

  const beginMetadataRequest = (conversationId: string): number => {
    const generation = (metadataGenerations.get(conversationId) ?? 0) + 1
    metadataGenerations.set(conversationId, generation)
    return generation
  }

  const invalidateMetadataRequests = (conversationId: string): void => {
    metadataGenerations.set(
      conversationId,
      (metadataGenerations.get(conversationId) ?? 0) + 1,
    )
  }

  const isCurrentMetadataRequest = (conversationId: string, generation: number): boolean =>
    metadataGenerations.get(conversationId) === generation

  const invalidatePendingEnsure = (): void => {
    ensureGeneration += 1
    pendingEnsure = null
    if (ensureRetryTimer) clearTimeout(ensureRetryTimer)
    ensureRetryTimer = null
  }

  const loadTerminalMessagesWithoutReplacingLiveTranscript = (conversationId: string): void => {
    if (!open.value || selectedConversationId.value !== conversationId) return
    const runtime = conversationStates.value[conversationId]
    if (!runtime || hasLiveTranscript(runtime)) return
    void loadMessagesIfNeeded(conversationId)
  }

  // ---- [DEF-06] 断流窗口覆盖 run 终态的补偿回填 ----
  // 现象(R1 L8-06 取证): 断流期间 run 完成 → 状态轮询先判「已完成」并终态化 →
  // ensureContentConnection 见非运行态放弃重连 → UI 保留截断 live 投影(库层为全文)。
  // 修复: 轮询判终态时若本地投影未消费过根终态事件(seq 落后), 先经 /events 从本地
  // 游标补偿回填, 回填交付根终态事件后再由事件流终态化; 回填按冷却节流(与 5s
  // ensure 重试同量级), 连续失败达上限回落旧语义(messagesLoaded=false → 历史回放兜底)。
  const REPLAY_MAX_ATTEMPTS = 5
  const REPLAY_RETRY_COOLDOWN_MS = 4500
  const replayAttempts = new Map<string, number>()
  const replayLastAttemptAt = new Map<string, number>()
  /**
   * [P1 #5] 自动重连耗尽判定:连续传输失败达上限即升级错误态并停止自动重试。
   * 上限与补偿回填(REPLAY_MAX_ATTEMPTS)同源 = 5;成功的事件送达 / 新 run 复位。
   */
  const CONNECT_FAILURE_LIMIT = REPLAY_MAX_ATTEMPTS
  const reconnectFailures = new Map<string, number>()

  /** 投影已消费过根终态事件(DONE/ERROR/CANCELLED 已入 reducer) */
  const pipelineReachedTerminal = (pipeline: AgentPipelineState): boolean =>
    pipeline.status === 'done' || pipeline.status === 'error' || pipeline.status === 'cancelled'

  /**
   * 终态轮询命中时, 本地 live 投影是否「落后」且需要补偿:
   * 会话前台可见 + 存在 live 投影 + 投影未见过根终态事件 + 已知 runId。
   * (后台会话由 messagesLoaded=false + 重开时历史回放自愈, 不走补偿。)
   */
  const needsCompensatingReplay = (conversationId: string): boolean => {
    const runtime = conversationStates.value[conversationId]
    if (!runtime || !hasLiveTranscript(runtime)) return false
    if (pipelineReachedTerminal(runtime.pipeline)) return false
    if (!(runtime.pipeline.runId || runtime.knownRunId)) return false
    return open.value && selectedConversationId.value === conversationId
  }

  /**
   * 启动补偿回填(reconnect 从本地游标续 GET /runs/{runId}/events, 幂等)。
   * 返回 true = 已接管(调用方不得据轮询结果终态化); false = 重试已耗尽, 回落旧语义。
   */
  const beginCompensatingReplay = (conversationId: string): boolean => {
    const runtime = conversationStates.value[conversationId]
    const runId = runtime?.pipeline.runId || runtime?.knownRunId
    if (!runtime || !runId) return false
    if (connection.value?.conversationId === conversationId) return true // 回填连接在途
    const now = Date.now()
    const lastAt = replayLastAttemptAt.get(conversationId)
    if (lastAt !== undefined && now - lastAt < REPLAY_RETRY_COOLDOWN_MS) return true // 重试循环在途, 冷却节流
    if ((replayAttempts.get(conversationId) ?? 0) >= REPLAY_MAX_ATTEMPTS) return false // 耗尽 → 旧语义兜底
    replayAttempts.set(conversationId, (replayAttempts.get(conversationId) ?? 0) + 1)
    replayLastAttemptAt.set(conversationId, now)
    const afterSequence = runtime.pipeline.runId === runId ? runtime.pipeline.lastSequence : 0
    connect(conversationId, 'reconnect', undefined, runId, afterSequence)
    return true
  }

  const resetCompensatingReplay = (conversationId: string): void => {
    replayAttempts.delete(conversationId)
    replayLastAttemptAt.delete(conversationId)
  }

  /**
   * [P1 #5] 传输恢复(新事件送达):清除重连提示态与连续失败计数。
   */
  const markConnectionRestored = (conversationId: string): void => {
    if (!reconnectFailures.delete(conversationId)) return
    updateRuntime(conversationId, (runtimeValue) => ({ ...runtimeValue, reconnecting: false }))
  }

  const scheduleEnsureRetry = (delay = 5000): void => {
    if (ensureRetryTimer) return
    const generation = ensureGeneration
    ensureRetryTimer = setTimeout(() => {
      ensureRetryTimer = null
      if (generation === ensureGeneration) ensureContentConnection()
    }, delay)
  }

  const invalidateConnection = (): number => {
    invalidatePendingEnsure()
    const current = connection.value
    if (current) connectionControllers.get(current.connectionGeneration)?.abort()
    const nextGeneration = connectionGeneration.value + 1
    connection.value = null
    connectionGeneration.value = nextGeneration
    scheduleStatusPolling()
    return nextGeneration
  }

  const clearConnection = (generation: number): void => {
    const current = connection.value
    if (!current || current.connectionGeneration !== generation) return
    connection.value = null
    connectionGeneration.value = generation + 1
  }

  const clearPolling = (): void => {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
  }

  const pollingCandidates = (): AgentConversation[] => {
    const activeConversationId = connection.value?.conversationId
    return conversations.value.filter((conversation) => {
      if (conversation.conversationId === activeConversationId) return false
      if (conversation.conversationId === pendingEnsure?.conversationId) return false
      const runtime = conversationStates.value[conversation.conversationId]
      return statusIsRunning(runtime?.status ?? conversation.status)
    })
  }

  const applyPolledStatus = (
    conversationId: string,
    response: RunStatusResponse,
    requestGeneration: number,
    metadataGeneration: number,
    expectedRunId?: string,
  ): void => {
    if (requestGeneration !== lifecycleGeneration
      || !isCurrentMetadataRequest(conversationId, metadataGeneration)) return
    const nextStatus = statusFromPipeline(response.status)
    const terminal = !statusIsRunning(nextStatus)
    let applied = false
    const runtime = conversationStates.value[conversationId]
    // Background status polling queries discrete conversation pipeline status.
    // Do not overwrite metadata if a live SSE stream is active on this exact conversation.
    if (runtime
      && connection.value?.conversationId !== conversationId
      && isCurrentMetadataRequest(conversationId, metadataGeneration)) {
      if (!(expectedRunId
        && runtime.statusConfirmed
        && statusIsRunning(runtime.status)
        && runtime.knownRunId !== expectedRunId)) {
        // [DEF-06] 轮询判终态 + 本地 live 投影未见过根终态事件(断流窗口覆盖 run 终态)
        // → 先补偿回填 /events, 回填交付根终态后再由事件流终态化;
        //   不得据轮询结果把截断投影直接终态化。
        if (terminal && needsCompensatingReplay(conversationId)
          && beginCompensatingReplay(conversationId)) return
        const runChanged = !!runtime.knownRunId
          && !!response.runId
          && runtime.knownRunId !== response.runId
        const nextConversation = { ...runtime.conversation, status: nextStatus }
        applied = true
        conversations.value = conversations.value.map((item) => item.conversationId === conversationId
          ? nextConversation
          : item)
        updateRuntime(conversationId, () => ({
          ...runtime,
          conversation: nextConversation,
          status: nextStatus,
          statusConfirmed: true,
          knownRunId: response.runId || runtime.knownRunId,
          remoteLastSequence: response.lastSequence,
          connectionError: terminal ? undefined : runtime.connectionError,
          // [P1 #5] 服务端终态落地 → 重连提示态一并清除
          reconnecting: terminal ? false : runtime.reconnecting,
          // A background completion makes the persisted transcript stale,
          // but it still must not trigger a content request while closed.
          messagesLoaded: terminal || runChanged ? false : runtime.messagesLoaded,
          unread: terminal
            && (!open.value || selectedConversationId.value !== conversationId)
            ? true
            : runtime.unread,
        }))
      }
    }
    if (!applied) return

    if (terminal) {
      // [DEF-06] 兜底终态(补偿不可用/耗尽): 计数器复位, 截断投影交历史回放兜底
      resetCompensatingReplay(conversationId)
      loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId)
    }
  }

  const scheduleStatusPolling = (): void => {
    if (pollTimer || pollInFlightGeneration !== null || pollingCandidates().length === 0) return
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    // 如果有运行中的对话，页面可见时固定每隔 1 秒 (1000ms) 查询一次对话状态
    const baseDelay = hidden ? 5000 : 1000
    const backoff = Math.min(5000, baseDelay * (2 ** pollFailureCount))
    const delay = hidden ? Math.max(5000, backoff) : backoff
    pollTimer = setTimeout(() => {
      pollTimer = null
      void pollStatuses()
    }, delay)
  }

  const pollStatuses = async (): Promise<void> => {
    if (pollInFlightGeneration !== null) return
    const requestGeneration = lifecycleGeneration
    const candidates = pollingCandidates().map((conversation) => ({
      conversation,
      expectedRunId: conversationStates.value[conversation.conversationId]?.knownRunId,
      metadataGeneration: beginMetadataRequest(conversation.conversationId),
    }))
    if (candidates.length === 0) {
      clearPolling()
      return
    }

    pollInFlightGeneration = requestGeneration
    let failures = 0
    try {
      await Promise.all(candidates.map(async ({
        conversation,
        expectedRunId,
        metadataGeneration,
      }) => {
        try {
          const response = await getRunStatus({ conversationId: conversation.conversationId })
          applyPolledStatus(
            conversation.conversationId,
            response,
            requestGeneration,
            metadataGeneration,
            expectedRunId,
          )
        } catch {
          failures += 1
          // A transient metadata failure never becomes a Pipeline failure.
        }
      }))
    } finally {
      if (requestGeneration !== lifecycleGeneration
        || pollInFlightGeneration !== requestGeneration) return
      pollInFlightGeneration = null
      pollFailureCount = failures === candidates.length
        ? Math.min(pollFailureCount + 1, 4)
        : 0
      if (pollingCandidates().length > 0) scheduleStatusPolling()
      else clearPolling()
    }
  }

  const alignCursorWithRun = (conversationId: string, runId: string): number => {
    let afterSequence = 0
    const runtime = conversationStates.value[conversationId]
    if (runtime) {
      const sameRun = runtime.pipeline.runId === runId
      // Server status metadata never advances or rewinds the local replay cursor.
      afterSequence = sameRun ? runtime.pipeline.lastSequence : 0
      const cursorUnchanged = sameRun && afterSequence === runtime.pipeline.lastSequence
      if (!cursorUnchanged) {
        updateRuntime(conversationId, (current) => ({
          ...current,
          knownRunId: runId,
          pipeline: {
            ...current.pipeline,
            runId,
            conversationId,
            lastSequence: afterSequence,
            reasoningText: '',
            reasoningStartTime: undefined,
            reasoningDurationMs: undefined,
            error: undefined,
          },
        }))
      } else {
        updateRuntime(conversationId, (current) => ({ ...current, knownRunId: runId }))
      }
    }
    return afterSequence
  }

  const connect = (
    conversationId: string,
    connectionMode: AssistantConnectionMode,
    request?: AiChatReq,
    reconnectRunId?: string,
    reconnectAfterSequence = 0,
  ): void => {
    if (!open.value || selectedConversationId.value !== conversationId) return
    const runtime = conversationStates.value[conversationId]
    if (!runtime || !statusIsRunning(runtime.status)) return
    if (connection.value?.conversationId === conversationId) return
    if (connectionMode === 'reconnect' && !reconnectRunId) return

    const generation = invalidateConnection()
    invalidateMetadataRequests(conversationId)
    updateRuntime(conversationId, (runtimeValue) => ({
      ...runtimeValue,
      connectionError: undefined,
    }))
    const callbacks = {
      onEvent: (event: AiChatStreamEvent) => {
        const current = connection.value
        if (!current
          || current.connectionGeneration !== generation
          || current.conversationId !== conversationId) return
        if (current.runId && event.runId !== current.runId) return
        invalidateMetadataRequests(conversationId)

        const runKey = `${conversationId}:${event.runId}`
        const eventSet = eventKeysByRun.get(runKey) ?? new Set<string>()
        eventKeysByRun.set(runKey, eventSet)
        const eventKey = `${event.sequence}:${event.messageId ?? event.outputType}`
        if (eventSet.has(eventKey)) return
        eventSet.add(eventKey)

        const currentRuntime = conversationStates.value[conversationId]
        if (!currentRuntime
          || (currentRuntime.pipeline.runId && currentRuntime.pipeline.runId !== event.runId)
          || event.sequence <= currentRuntime.pipeline.lastSequence) return

        // [P1 #5] 有效事件送达 = 传输恢复:清除「连接中断,自动重连中…」提示态
        markConnectionRestored(conversationId)

        try {
          const nextPipeline = reduceAssistantEvent(currentRuntime.pipeline, event)
          const terminal = hasTerminal(event)
          const nextStatus = terminal
            ? terminalStatusForEvent(event)
            : currentRuntime.status === 'CANCEL_REQUESTED'
              ? 'CANCEL_REQUESTED'
              : event.outputType === 'USER_CONFIRMATION_REQUIRED'
                ? 'WAITING_CONFIRMATION'
                : event.outputType === 'EXTERNAL_EXECUTION_REQUIRED'
                  ? 'WAITING_EXTERNAL'
                  : 'running'
          if (event.outputType === 'TOOL_FINISHED' && event.toolName && event.toolStatus !== 'error') {
            // [adapt] 融光 pipeline store 的工具失效联动 → 可注入钩子
            assistantEventHooks.onToolFinished(event.toolName)
          } else if (terminal) {
            assistantEventHooks.onRunTerminal()
          }

          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            pipeline: {
              ...nextPipeline,
              runId: event.runId,
              conversationId,
              lastSequence: event.sequence,
            },
            status: nextStatus,
            statusConfirmed: true,
            knownRunId: event.runId,
            remoteLastSequence: Math.max(runtimeValue.remoteLastSequence ?? 0, event.sequence),
            connectionError: undefined,
            messagesLoaded: terminal ? false : runtimeValue.messagesLoaded,
            conversation: { ...runtimeValue.conversation, status: nextStatus },
            unread: terminal
              && (!open.value || selectedConversationId.value !== conversationId),
          }))
          // [DEF-06] 投影消费到根终态事件 → 补偿回填计数复位(含回填流自身的终态)
          if (terminal) resetCompensatingReplay(conversationId)
          const indexedConversation = conversations.value.find(
            (item) => item.conversationId === conversationId,
          )
          if (indexedConversation && indexedConversation.status !== nextStatus) {
            conversations.value = conversations.value.map((item) => item.conversationId === conversationId
              ? { ...item, status: nextStatus }
              : item)
          }
          if (connection.value?.connectionGeneration === generation) {
            connection.value = { ...connection.value, runId: event.runId }
          }
        } catch (error) {
          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            connectionError: error instanceof Error ? error.message : '无法处理助手事件',
          }))
        }
      },
      onError: (error: Error) => {
        const current = connection.value
        if (!current
          || current.connectionGeneration !== generation
          || current.conversationId !== conversationId) return
        const startRejected = current.connectionMode === 'start' && !current.runId
        if (startRejected) {
          // [P1 #5] 终态失败:服务端拒绝建流(模型未配置等),既有语义不变。
          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            reconnecting: false,
            connectionError: error.message,
            status: 'failed',
            statusConfirmed: true,
            conversation: { ...runtimeValue.conversation, status: 'failed' },
          }))
          conversations.value = conversations.value.map((conversation) =>
            conversation.conversationId === conversationId
              ? { ...conversation, status: 'failed' }
              : conversation)
          clearConnection(generation)
          return
        }
        // [P1 #5] 可自动恢复的传输错误:进入静默提示态(reconnecting),抑制
        // 阻断式 connectionError;仅连续失败耗尽(上限 5)才升级错误态并停止
        // 自动重试 —— 会话状态保留,由状态轮询按服务端事实收敛终态。
        const failures = (reconnectFailures.get(conversationId) ?? 0) + 1
        reconnectFailures.set(conversationId, failures)
        const exhausted = failures >= CONNECT_FAILURE_LIMIT
        updateRuntime(conversationId, (runtimeValue) => ({
          ...runtimeValue,
          reconnecting: !exhausted,
          connectionError: exhausted
            ? `连接中断，自动重连未成功：${error.message}`
            : undefined,
        }))
        clearConnection(generation)
        if (!exhausted) scheduleEnsureRetry()
        scheduleStatusPolling()
      },
      onComplete: () => {
        const current = connection.value
        if (!current
          || current.connectionGeneration !== generation
          || current.conversationId !== conversationId) return
        clearConnection(generation)
        const latestRuntime = conversationStates.value[conversationId]
        if (latestRuntime && !statusIsRunning(latestRuntime.status)) {
          loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId)
        }
        scheduleStatusPolling()
      },
    }

    let controller: AbortController
    try {
      if (connectionMode === 'start') {
        if (!request) throw new Error('缺少助手请求')
        controller = startRunStream(request, callbacks)
      } else {
        controller = reconnectRunStream(
          reconnectRunId ?? '',
          reconnectAfterSequence,
          callbacks,
        )
      }
    } catch (error) {
      updateRuntime(conversationId, (runtimeValue) => ({
        ...runtimeValue,
        connectionError: error instanceof Error ? error.message : '无法连接助手',
      }))
      scheduleEnsureRetry()
      scheduleStatusPolling()
      return
    }

    connectionControllers.set(generation, controller)
    connection.value = {
      conversationId,
      runId: reconnectRunId,
      connectionGeneration: generation,
      connectionMode,
    }
  }

  const confirmStatusAndReconnect = (conversationId: string): void => {
    if (pendingEnsure?.conversationId === conversationId) return
    const generation = ++ensureGeneration
    const requestConnectionGeneration = connectionGeneration.value
    const metadataGeneration = beginMetadataRequest(conversationId)
    pendingEnsure = { conversationId, generation }

    void getRunStatus({ conversationId })
      .then((response) => {
        if (generation !== ensureGeneration
          || connectionGeneration.value !== requestConnectionGeneration
          || !isCurrentMetadataRequest(conversationId, metadataGeneration)) return
        const nextStatus = statusFromPipeline(response.status)
        const runtime = conversationStates.value[conversationId]
        // [DEF-06] 确认即终态 + live 投影未收敛 → 先补偿回填(口径同 applyPolledStatus)
        if (runtime && !statusIsRunning(nextStatus)
          && needsCompensatingReplay(conversationId)
          && beginCompensatingReplay(conversationId)) {
          scheduleStatusPolling()
          return
        }
        if (runtime
          && connectionGeneration.value === requestConnectionGeneration
          && isCurrentMetadataRequest(conversationId, metadataGeneration)) {
          const nextConversation = { ...runtime.conversation, status: nextStatus }
          conversations.value = conversations.value.map((item) => item.conversationId === conversationId
            ? nextConversation
            : item)
          updateRuntime(conversationId, () => ({
            ...runtime,
            conversation: nextConversation,
            status: nextStatus,
            statusConfirmed: true,
            knownRunId: response.runId,
            remoteLastSequence: response.lastSequence,
            connectionError: statusIsRunning(nextStatus) ? runtime.connectionError : undefined,
            reconnecting: statusIsRunning(nextStatus) ? runtime.reconnecting : false,
            messagesLoaded: statusIsRunning(nextStatus) ? runtime.messagesLoaded : false,
          }))
        }

        if (!statusIsRunning(nextStatus)) {
          loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId)
          scheduleStatusPolling()
          return
        }
        if (!open.value
          || selectedConversationId.value !== conversationId
          || connection.value
          || !response.runId) {
          scheduleStatusPolling()
          return
        }

        const afterSequence = alignCursorWithRun(conversationId, response.runId)
        connect(conversationId, 'reconnect', undefined, response.runId, afterSequence)
      })
      .catch(() => {
        // Confirmation is metadata-only. Leave the run state untouched and
        // retry without letting the polling request mutate content state.
        if (generation === ensureGeneration) scheduleEnsureRetry()
        scheduleStatusPolling()
      })
      .finally(() => {
        if (pendingEnsure?.generation === generation) pendingEnsure = null
      })
  }

  const ensureContentConnection = (): void => {
    const conversationId = selectedConversationId.value
    if (!open.value || !conversationId) {
      scheduleStatusPolling()
      return
    }
    const runtime = conversationStates.value[conversationId]
    if (!runtime || !statusIsRunning(runtime.status)) {
      scheduleStatusPolling()
      return
    }
    if (connection.value?.conversationId === conversationId) return

    void loadMessagesIfNeeded(conversationId)
    if (!runtime.statusConfirmed || !runtime.knownRunId) {
      confirmStatusAndReconnect(conversationId)
      return
    }

    // [DEF-06] 轮询已判终态但 live 投影未收敛 → 补偿回填(冷却节流 + 次数上限)
    if (needsCompensatingReplay(conversationId)) {
      if (beginCompensatingReplay(conversationId)) return
      // 回填重试耗尽 → 停止重连循环, 交由状态轮询按旧语义终态化(历史回放兜底)
      scheduleStatusPolling()
      return
    }

    const afterSequence = alignCursorWithRun(conversationId, runtime.knownRunId)
    connect(conversationId, 'reconnect', undefined, runtime.knownRunId, afterSequence)
  }

  const resetCoordinator = (): void => {
    lifecycleGeneration += 1
    invalidateConnection()
    clearPolling()
    pollInFlightGeneration = null
    pollFailureCount = 0
    eventKeysByRun.clear()
    metadataGenerations.clear()
    replayAttempts.clear()
    replayLastAttemptAt.clear()
    reconnectFailures.clear()
  }

  // ============ 工具确认 (旧 respondToToolConfirmations) ============

  async function respondToToolConfirmations(target: ToolConfirmationDecisionTarget): Promise<void> {
    const conversationId = selectedConversationId.value
    if (!conversationId) {
      throw new Error('Tool confirmation requires a selected conversation')
    }
    const runtime = conversationStates.value[conversationId]
    if (!runtime) {
      throw new Error(`Missing assistant runtime for ${conversationId}`)
    }
    const pending = runtime.pipeline.pendingConfirmation
    if (!pending) {
      throw new Error(`Conversation ${conversationId} has no pending tool confirmation`)
    }
    if (pending.submitting) {
      throw new Error(`Conversation ${conversationId} is submitting tool decisions`)
    }
    const expiresAt = Date.parse(pending.expiresAt)
    if (!Number.isFinite(expiresAt)) {
      throw new Error('Tool confirmation expiry is invalid')
    }
    if (Date.now() >= expiresAt) {
      scheduleStatusPolling()
      return
    }
    const pendingToolCalls = pending.toolCalls ?? []
    const pendingIds = new Set(pendingToolCalls.map((toolCall) => toolCall.toolCallId))
    if (pendingIds.size !== pendingToolCalls.length) {
      throw new Error('Tool confirmation contains duplicate toolCallIds')
    }
    if (target.kind === 'single' && !pendingIds.has(target.toolCallId)) {
      throw new Error(`Tool confirmation does not contain ${target.toolCallId}`)
    }
    const existingDecisionIds = Object.keys(pending.decisions)
    if (existingDecisionIds.some((decisionId) =>
      !pendingIds.has(decisionId)
      || typeof pending.decisions[decisionId] !== 'boolean')) {
      throw new Error('Pending tool confirmation contains invalid local decisions')
    }
    const decisionUpdates: Record<string, boolean> = target.kind === 'all'
      ? Object.fromEntries(pendingToolCalls.map((toolCall) => [
          toolCall.toolCallId,
          target.approved,
        ]))
      : { [target.toolCallId]: target.approved }
    const decisions: Record<string, boolean> = {
      ...pending.decisions,
      ...decisionUpdates,
    }
    const submitting = Object.keys(decisions).length === pendingIds.size
    const decisionsToSubmit = submitting
      ? pendingToolCalls.map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          approved: decisions[toolCall.toolCallId] ?? false,
        }))
      : undefined
    const pendingSnapshot = pending
    updateRuntime(conversationId, (current) => {
      const currentPending = current.pipeline.pendingConfirmation
      if (currentPending !== pendingSnapshot) {
        throw new Error('Pending tool confirmation changed before submission')
      }
      return {
        ...current,
        connectionError: undefined,
        pipeline: {
          ...current.pipeline,
          pendingConfirmation: {
            ...currentPending,
            decisions,
            submitting,
          },
        },
      }
    })
    if (!decisionsToSubmit) return
    try {
      await confirmRunTools({
        runId: pending.runId,
        replyId: pending.replyId,
        decisions: decisionsToSubmit,
      })
      // The SSE request that delivered REQUIRE_USER_CONFIRM can remain open
      // while AgentScope is paused. It cannot be reused as the resumed run's
      // event cursor, so replace it with an explicit reconnect after the
      // atomic confirmation batch has been accepted.
      invalidateConnection()
      ensureContentConnection()
      scheduleStatusPolling()
    } catch (error) {
      const expired = Date.now() >= expiresAt
      updateRuntime(conversationId, (current) => {
        const currentPending = current.pipeline.pendingConfirmation
        if (!currentPending
          || currentPending.replyId !== pending.replyId
          || !currentPending.submitting) {
          throw new Error('Pending tool confirmation changed after submission failure')
        }
        return {
          ...current,
          connectionError: expired
            ? undefined
            : error instanceof Error ? error.message : String(error),
          pipeline: {
            ...current.pipeline,
            pendingConfirmation: {
              ...currentPending,
              submitting: false,
            },
          },
        }
      })
      if (expired) scheduleStatusPolling()
    }
  }

  // ============ actions ============

  function initializeForUser(userId: string | number): void {
    if (typeof userId !== 'number' && typeof userId !== 'string') return
    if (typeof userId === 'number' && (!Number.isSafeInteger(userId) || userId <= 0)) return
    if (typeof userId === 'string' && !userId.trim()) return
    if (initialized.value && hydratedUserId.value === userId) return

    if (hydratedUserId.value) commitAssistantPersist()
    resetCoordinator()
    clearAssistantPersistTimer()
    const persisted = defaultPersistedState(userId)
    const drafts = persisted.drafts
    const restoredSelectedConversationId = persisted.selectedConversationId
    hydratedUserId.value = userId
    initialized.value = true
    selectedConversationId.value = null
    selectedModelId.value = persisted.selectedModelId
    conversations.value = []
    conversationStates.value = {}
    newDraft.value = drafts[NEW_ASSISTANT_DRAFT_KEY] ?? ''
    newToolExecutionMode.value = persisted.newToolExecutionMode
    drawerOpen.value = false
    conversationsLoading.value = true
    conversationsError.value = undefined
    hasMoreConversations.value = false
    conversationPage.value = 0

    void listConversations({ pageNo: 1, pageSize: PAGE_SIZE, category: ASSISTANT_CATEGORY })
      .then((result) => {
        if (hydratedUserId.value !== userId) return
        const filtered = result.list.filter((conversation) =>
          !conversation.category || conversation.category === ASSISTANT_CATEGORY)
        const conversationStatesNext: Record<string, AssistantConversationRuntime> = {}
        for (const conversation of filtered) {
          conversationStatesNext[conversation.conversationId] = makeRuntime(
            conversation,
            drafts,
            persisted.runIds,
            initialConversationToolExecutionMode(
              persisted.toolExecutionModes,
              conversation.conversationId,
              persisted.newToolExecutionMode,
            ),
          )
        }
        const selected = restoredSelectedConversationId
          && conversationStatesNext[restoredSelectedConversationId]
          ? restoredSelectedConversationId
          : null
        conversations.value = filtered
        conversationStates.value = conversationStatesNext
        selectedConversationId.value = selected
        conversationsLoading.value = false
        conversationPage.value = 1
        hasMoreConversations.value = filtered.length < result.total
        conversationsError.value = undefined
        scheduleStatusPolling()
        const selectedId = selectedConversationId.value
        if (open.value && selectedId) {
          void loadMessagesIfNeeded(selectedId)
          ensureContentConnection()
        }
      })
      .catch((error: unknown) => {
        if (hydratedUserId.value !== userId) return
        conversationsLoading.value = false
        conversationsError.value = error instanceof Error ? error.message : '加载助手会话失败'
      })
  }

  function resetForUser(): void {
    if (hydratedUserId.value) commitAssistantPersist()
    resetCoordinator()
    clearAssistantPersistTimer()
    hydratedUserId.value = null
    initialized.value = false
    open.value = false
    selectedConversationId.value = null
    selectedModelId.value = null
    conversations.value = []
    conversationStates.value = {}
    newDraft.value = ''
    newToolExecutionMode.value = 'DEFAULT'
    drawerOpen.value = false
    conversationsLoading.value = false
    conversationsError.value = undefined
    hasMoreConversations.value = false
    conversationPage.value = 0
    connection.value = null
  }

  function loadMoreConversations(): void {
    if (conversationsLoading.value || !hasMoreConversations.value || !hydratedUserId.value) return
    const page = conversationPage.value + 1
    const userId = hydratedUserId.value
    conversationsLoading.value = true
    void listConversations({ pageNo: page, pageSize: PAGE_SIZE, category: ASSISTANT_CATEGORY })
      .then((result) => {
        if (hydratedUserId.value !== userId) return
        const filtered = result.list.filter((conversation) =>
          !conversation.category || conversation.category === ASSISTANT_CATEGORY)
        const merged = uniqueConversations(conversations.value, filtered)
        const persisted = defaultPersistedState(userId)
        const conversationStatesNext = { ...conversationStates.value }
        for (const conversation of filtered) {
          const existing = conversationStatesNext[conversation.conversationId]
          conversationStatesNext[conversation.conversationId] = existing
            ? {
                ...existing,
                conversation: { ...conversation, status: existing.status },
              }
            : makeRuntime(
                conversation,
                persisted.drafts,
                persisted.runIds,
                initialConversationToolExecutionMode(
                  persisted.toolExecutionModes,
                  conversation.conversationId,
                  persisted.newToolExecutionMode,
                ),
              )
        }
        conversations.value = merged
        conversationStates.value = conversationStatesNext
        conversationsLoading.value = false
        conversationPage.value = page
        hasMoreConversations.value = merged.length < result.total
        scheduleStatusPolling()
      })
      .catch((error: unknown) => {
        if (hydratedUserId.value !== userId) return
        conversationsLoading.value = false
        conversationsError.value = error instanceof Error ? error.message : '加载更多会话失败'
      })
  }

  function selectConversation(conversationId: string | null): void {
    if (conversationId && !conversationStates.value[conversationId]) {
      throw new Error(`Cannot select conversation without runtime: ${conversationId}`)
    }
    if (selectedConversationId.value !== conversationId) {
      invalidateConnection()
    }
    if (!conversationId) {
      selectedConversationId.value = null
      drawerOpen.value = false
    } else {
      const runtime = conversationStates.value[conversationId]
      if (!runtime) {
        throw new Error(`Conversation runtime disappeared during selection: ${conversationId}`)
      }
      selectedConversationId.value = conversationId
      drawerOpen.value = false
      updateRuntime(conversationId, (current) => ({ ...current, unread: false }))
    }
    persist()
    scheduleStatusPolling()
    if (conversationId && open.value) {
      void loadMessagesIfNeeded(conversationId)
      ensureContentConnection()
    }
  }

  function startNewConversation(): void {
    if (connection.value || selectedConversationId.value) invalidateConnection()
    selectedConversationId.value = null
    drawerOpen.value = false
    persist()
  }

  function setDraft(conversationId: string | null, draft: string): void {
    if (!conversationId) newDraft.value = draft
    else updateRuntime(conversationId, (runtime) => ({ ...runtime, draft }))
    persist()
  }

  function setSelectedModelId(modelId: number | null): void {
    selectedModelId.value = modelId
    persist()
  }

  function setToolExecutionMode(mode: ToolExecutionMode): void {
    const conversationId = selectedConversationId.value
    newToolExecutionMode.value = mode
    if (conversationId) {
      updateRuntime(conversationId, (runtime) => ({ ...runtime, toolExecutionMode: mode }))
    }
    persist()
  }

  async function sendMessage(
    message: string,
    modelId: number | null,
    reasoningEffort: string | null,
    projectId?: number | null,
    references?: AssistantMessageReferences,
  ): Promise<void> {
    const multimodalInputs = references?.multimodalInputs ?? []
    const content = message.trim() || (multimodalInputs.length ? '请分析这些附件。' : '')
    if (!content) return
    if (connection.value) throw new Error('当前会话仍在生成中')

    const previousSelectedId = selectedConversationId.value
    let conversationId = previousSelectedId
    const title = normalizeTitle(content)
    if (!conversationId) {
      conversationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const conversation: AgentConversation = {
        id: -Date.now(),
        conversationId,
        userId: 0,
        projectId: projectId ?? null,
        category: ASSISTANT_CATEGORY,
        title,
        messageCount: 0,
        status: 'completed',
      }
      const runtime = {
        ...makeRuntime(conversation, {}, {}, newToolExecutionMode.value),
        // The optimistic conversation has no server history yet. Treat its
        // empty local transcript as loaded so connection recovery cannot
        // race the create request with a history lookup that must 404.
        messagesLoaded: true,
      }
      conversations.value = [conversation, ...conversations.value]
      conversationStates.value = { ...conversationStates.value, [conversationId]: runtime }
      selectedConversationId.value = conversationId
      newDraft.value = ''
    }

    const knownRuntime = conversationStates.value[conversationId]
    if (!knownRuntime) throw new Error('会话尚未准备好')
    if (previousSelectedId && statusIsRunning(knownRuntime.status)) {
      throw new Error('当前会话仍在生成中')
    }
    const shouldSetTitle = !previousSelectedId || knownRuntime.conversation.title === '新对话'

    // A completed live run may have just projected its final message. Give
    // the history endpoint a chance to materialize it before starting the
    // next turn, while preserving the in-memory timeline as a fallback.
    let runtime = knownRuntime
    if (runtime.pipeline.timeline.length > 0 && !runtime.messagesLoaded) {
      await loadMessagesIfNeeded(conversationId)
      runtime = conversationStates.value[conversationId] ?? runtime
    }

    const conversationProjectId = projectId !== undefined
      ? projectId
      : runtime.conversation.projectId ?? null
    const activeContext: Record<string, unknown> = {
      // [adapt] 契约: 请求体增 context{page,object} (02-技术方案 §7.1)。
      // 宿主经 pageContext.setRunContext 注册; 未注册时字段缺省。
      ...getRunContext(),
    }
    if (references?.mcpTools.length) {
      activeContext.activeMcpReferences = references.mcpTools
        .map((tool) => `${tool.serverName}/${tool.toolName}`)
        .join('\n')
    }
    const serializedReferences = references
      && (conversationProjectId !== null
        || references.skills.length > 0
        || references.mcpTools.length > 0
        || multimodalInputs.length > 0)
      ? JSON.stringify({
          version: 2,
          projectId: conversationProjectId,
          project: references.project ?? null,
          skills: references.skills,
          mcpTools: references.mcpTools,
          attachments: multimodalInputs.map(({
            id,
            name,
            inputType,
            mimeType,
            transport,
            resourceUrl,
            size,
          }) => ({
            id,
            name,
            inputType,
            mimeType,
            transport,
            resourceUrl,
            size,
          })),
        })
      : undefined
    const optimisticMessage: AgentMessage = {
      id: -Date.now(),
      conversationId,
      role: 'user',
      content,
      referencesJson: serializedReferences,
      messageOrder: Math.max(0, ...runtime.messages.map((item) => item.messageOrder ?? 0)) + 1,
    }
    const pendingPipeline = {
      ...pendingPipelineForNextRun(conversationId),
      // Keep an already visible answer until the persisted projection is
      // available; new events append to this same reducer state.
      timeline: runtime.messagesLoaded ? [] : runtime.pipeline.timeline,
    }
    const conversationTitle = runtime.conversation.title === '新对话' ? title : runtime.conversation.title
    updateRuntime(conversationId, (current) => ({
      ...current,
      messages: [...current.messages, optimisticMessage],
      pipeline: pendingPipeline,
      status: 'running',
      statusConfirmed: true,
      knownRunId: undefined,
      remoteLastSequence: 0,
      messagesError: undefined,
      connectionError: undefined,
      reconnecting: false,
      conversation: {
        ...current.conversation,
        status: 'running',
        title: conversationTitle,
        projectId: conversationProjectId,
      },
    }))
    // [P1 #5] 新 run 起点:复位重连失败计数
    reconnectFailures.delete(conversationId)
    conversations.value = conversations.value.map((item) => item.conversationId === conversationId
      ? { ...item, status: 'running', title: conversationTitle, projectId: conversationProjectId }
      : item)
    persist()

    const request: AiChatReq = {
      message: content,
      conversationId,
      modelId: modelId ?? undefined,
      reasoningEffort: reasoningEffort ?? undefined,
      agentType: assistantAgentType(),
      category: ASSISTANT_CATEGORY,
      title: shouldSetTitle ? title : undefined,
      projectId: conversationProjectId ?? undefined,
      context: Object.keys(activeContext).length ? activeContext : undefined,
      autoReferences: buildAutoReferences(
        projectId,
        conversationProjectId,
      ),
      // [DEF-07] 空数组/未选择时不下发该字段(undefined → JSON 剔除): 服务端把
      // "enabledMcpTools":[] 视作「显式空白名单」过滤 → ia_tool_registry 注册
      // 工具在 UI 会话中全部不可达; 缺省(不传)才是「未指定 = 跟随授权目录」。
      // enabledSkills 同口径(服务端对 null/[] 语义一致, 见 resolveActiveSkills)。
      enabledSkills: references?.skills.length
        ? references.skills.map((skill) => skill.name)
        : undefined,
      enabledMcpTools: references?.mcpTools.length
        ? references.mcpTools.map((tool) => tool.toolName)
        : undefined,
      multimodalInputs,
      referencesJson: serializedReferences,
      toolExecutionMode: runtime.toolExecutionMode,
    }
    resetCompensatingReplay(conversationId) // [DEF-06] 新 run 起点复位补偿计数
    connect(conversationId, 'start', request)
    scheduleStatusPolling()
  }

  async function stopGeneration(): Promise<void> {
    const conversationId = selectedConversationId.value
    const runtime = conversationId ? conversationStates.value[conversationId] : undefined
    const connectionRunId = connection.value?.conversationId === conversationId
      ? connection.value.runId
      : undefined
    const runId = connectionRunId || runtime?.pipeline.runId || runtime?.knownRunId
    if (!conversationId || !runtime || runtime.status === 'CANCEL_REQUESTED') return
    const previousStatus = runtime.status
    const previousConversationStatus = runtime.conversation.status
    const previousPipelineStatus = runtime.pipeline.status
    const previousListStatus = conversations.value.find(
      (item) => item.conversationId === conversationId,
    )?.status
    updateRuntime(conversationId, (current) => ({
      ...current,
      status: 'CANCEL_REQUESTED',
      connectionError: undefined,
      reconnecting: false,
      pipeline: {
        ...current.pipeline,
        status: 'cancelling',
      },
      conversation: { ...current.conversation, status: 'CANCEL_REQUESTED' },
    }))
    conversations.value = conversations.value.map((item) => item.conversationId === conversationId
      ? { ...item, status: 'CANCEL_REQUESTED' }
      : item)
    try {
      await cancelRun(runId ? { runId } : { conversationId })
      scheduleStatusPolling()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      updateRuntime(conversationId, (current) => current.status === 'CANCEL_REQUESTED'
        ? {
            ...current,
            status: previousStatus,
            connectionError: `取消请求失败：${errorMessage}`,
            pipeline: {
              ...current.pipeline,
              status: previousPipelineStatus,
            },
            conversation: {
              ...current.conversation,
              status: previousConversationStatus,
            },
          }
        : current)
      conversations.value = conversations.value.map((item) =>
        item.conversationId === conversationId && item.status === 'CANCEL_REQUESTED'
          ? { ...item, status: previousListStatus ?? previousStatus }
          : item)
      throw error
    }
  }

  function respondToToolConfirmation(toolCallId: string, approved: boolean): Promise<void> {
    return respondToToolConfirmations({ kind: 'single', toolCallId, approved })
  }

  function respondToAllToolConfirmations(approved: boolean): Promise<void> {
    return respondToToolConfirmations({ kind: 'all', approved })
  }

  async function expireToolConfirmation(): Promise<void> {
    const conversationId = selectedConversationId.value
    if (!conversationId) return
    const pending = conversationStates.value[conversationId]?.pipeline.pendingConfirmation
    if (!pending) return
    const expiresAt = Date.parse(pending.expiresAt)
    if (!Number.isFinite(expiresAt)) {
      throw new Error('Tool confirmation expiry is invalid')
    }
    if (Date.now() < expiresAt) return

    const requestKey = `${pending.runId}:${pending.replyId}`
    if (expiringConfirmations.has(requestKey)) return
    expiringConfirmations.add(requestKey)
    try {
      await expireRunConfirmation({
        runId: pending.runId,
        replyId: pending.replyId,
      })
      invalidateConnection()
      ensureContentConnection()
    } catch (error) {
      console.warn('[Assistant] 审批超时状态同步失败', error)
    } finally {
      expiringConfirmations.delete(requestKey)
      scheduleStatusPolling()
    }
  }

  function markConversationRead(conversationId: string): void {
    updateRuntime(conversationId, (runtime) => ({ ...runtime, unread: false }))
  }

  async function deleteConversation(conversationId: string, id: number): Promise<void> {
    const runtime = conversationStates.value[conversationId]
    if (runtime && statusIsRunning(runtime.status)) throw new Error('运行中的会话不能删除')
    if (id < 0) {
      await deleteConversationByConversationId(conversationId)
    } else {
      await deleteConversationApi(id)
    }
    if (selectedConversationId.value === conversationId) invalidateConnection()
    const conversationStatesNext = { ...conversationStates.value }
    delete conversationStatesNext[conversationId]
    conversations.value = conversations.value.filter((item) => item.conversationId !== conversationId)
    conversationStates.value = conversationStatesNext
    if (selectedConversationId.value === conversationId) selectedConversationId.value = null
    persist()
  }

  /** 窗口开合 (旧 setMode collapsed 语义的等价接线; 由挂载页面/宿主布局驱动) */
  function setOpen(next: boolean): void {
    if (open.value === next) return
    open.value = next
    if (!next) {
      invalidateConnection()
      drawerOpen.value = false
      scheduleStatusPolling()
      return
    }
    drawerOpen.value = false
    const selectedId = selectedConversationId.value
    if (selectedId) {
      const runtime = conversationStates.value[selectedId]
      if (runtime?.unread) updateRuntime(selectedId, (current) => ({ ...current, unread: false }))
      void loadMessagesIfNeeded(selectedId)
      ensureContentConnection()
    }
  }

  function setDrawerOpen(next: boolean): void {
    drawerOpen.value = next
  }

  async function loadMessagesIfNeeded(conversationId: string): Promise<void> {
    if (!conversationId) return
    const userId = hydratedUserId.value
    const runtime = conversationStates.value[conversationId]
    if (!runtime || runtime.messagesLoaded || runtime.messagesLoading) return
    updateRuntime(conversationId, (current) => ({
      ...current,
      messagesLoading: true,
      messagesError: undefined,
    }))
    try {
      const incoming = await listMessages(conversationId)
      if (hydratedUserId.value !== userId) return
      const current = conversationStates.value[conversationId]
      if (!current) return
      const messages = mergeMessages(current.messages, incoming)
      const shouldBuildTimeline = !connection.value && !statusIsRunning(current.status)
      conversationStates.value = {
        ...conversationStates.value,
        [conversationId]: {
          ...current,
          messages,
          messagesLoaded: true,
          messagesLoading: false,
          messagesError: undefined,
          pipeline: shouldBuildTimeline
            ? {
                ...current.pipeline,
                timeline: timelineForMessages(messages),
                conversationId,
              }
            : current.pipeline,
        },
      }
    } catch (error: unknown) {
      updateRuntime(conversationId, (current) => ({
        ...current,
        messagesLoading: false,
        messagesError: error instanceof Error ? error.message : '加载消息失败',
      }))
    }
  }

  return {
    // state
    hydratedUserId,
    initialized,
    open,
    selectedConversationId,
    selectedModelId,
    conversations,
    conversationStates,
    newDraft,
    newToolExecutionMode,
    drawerOpen,
    conversationsLoading,
    conversationsError,
    hasMoreConversations,
    conversationPage,
    connection,
    connectionGeneration,

    // actions
    initializeForUser,
    resetForUser,
    loadMoreConversations,
    selectConversation,
    startNewConversation,
    setDraft,
    setSelectedModelId,
    setToolExecutionMode,
    sendMessage,
    stopGeneration,
    respondToToolConfirmation,
    respondToAllToolConfirmations,
    expireToolConfirmation,
    markConversationRead,
    deleteConversation,
    setOpen,
    setDrawerOpen,
    loadMessagesIfNeeded,
    ensureContentConnection,
  }
})
