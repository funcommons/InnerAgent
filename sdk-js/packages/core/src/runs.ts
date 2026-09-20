/**
 * [adapt] Durable Run API — 源: $SRC/src/api/ai-pipeline.ts (587 行)。
 *
 * 事件协议 (SSE runId:seq、outputType 全集、schemaVersion 1) **不变**, 直接复用:
 * 原生 fetch + ReadableStream 手写解析 (后端要求 Authorization 头, EventSource 不可用)。
 * 传输层结束永远不等于业务完成 —— 必须等到根终态 journal 事件 (DONE/ERROR/CANCELLED)。
 *
 * API 重映射 (02-技术方案 §7.1 ADR-T4, 任务 P1-T3a 契约):
 * | 融光旧路由                                  | InnerAgent 路由                          |
 * | POST /api/ai/pipeline/run                  | POST {base}/runs                        |
 * | POST /api/ai/pipeline/continue?conversationId | POST {base}/runs/{runId}/continue    |
 * | GET  /api/ai/pipeline/reconnect            | GET  {base}/runs/{runId}/events (Last-Event-ID) |
 * | POST /api/ai/pipeline/cancel               | POST {base}/runs/{runId}/cancel         |
 * | POST /api/ai/pipeline/confirm              | POST {base}/runs/{runId}/confirm        |
 * | POST /api/ai/pipeline/confirm/expire       | POST {base}/runs/{runId}/confirm/expire |
 * | GET  /api/ai/pipeline/status               | GET  {base}/runs/{runId}                |
 * | GET  /api/ai/pipeline/running              | GET  {base}/runs/running                |
 *
 * 适配差异:
 * - 请求体增 context{page,object} (契约): AiChatReq.context 由调用方注入,
 *   store 发送时合并 pageContext.getRunContext() (见 store/assistant.ts)。
 * - status-by-conversationId: 新契约无该端点 → GET /runs/running (500ms 微缓存)
 *   按 conversationId 匹配; 不在运行列表 → 合成 COMPLETED 终态 (run 列表即运行中集合)。
 * - cancel 仅 runId 在契约内; 乐观会话 (尚无 runId) 保留 conversationId 查询参数
 *   兜底 POST /runs/cancel?conversationId=..., 服务端若未实现将 404 → UI 取消失败 (偏差已记录)。
 * - 拆除业务依赖: PIPELINE_AGENT_TYPES (融光 Pipeline 任务类型表) 不移植。
 */

import { getBaseURL } from './config'
import { http } from './client'
import { authenticatedFetch } from './sseAuth'

// ========== 基础类型 ([port] 照搬源共享定义) ==========

export type AiMultimodalInputType = 'image' | 'video' | 'audio' | 'file'
export type AiMultimodalInputTransport = 'url' | 'base64'

export type ToolExecutionMode =
  | 'DEFAULT'
  | 'ALWAYS_ASK'
  | 'ALWAYS_ALLOW'
  | 'FULL_ACCESS'

export interface AiMultimodalInput {
  id: string
  name: string
  inputType: AiMultimodalInputType
  mimeType: string
  transport: AiMultimodalInputTransport
  url?: string
  data?: string
  /** 应用存储中的持久化地址，用于用户消息回显，不发送给模型。 */
  resourceUrl?: string
  size: number
}

/** Run 的请求消息体 (源 AiChatReq; context 契约扩展见文件头) */
export interface AiChatReq {
  message?: string
  conversationId?: string
  modelId?: number
  reasoningEffort?: string
  agentType?: string
  category?: string
  /** 自定义对话标题（不传则使用消息前50字） */
  title?: string
  projectId?: number
  /** 当前页面/业务上下文; InnerAgent 契约含 page/object 键 (02-技术方案 §7.1) */
  context?: Record<string, unknown>
  systemPrompt?: string
  instruction?: string
  enabledTools?: string[]
  /** 用户在输入区显式激活的 Skill 名称。 */
  enabledSkills?: string[]
  enabledMcpTools?: string[]
  multimodalInputs?: AiMultimodalInput[]
  enableParallelTools?: boolean
  toolExecutionMode: ToolExecutionMode
  referencesJson?: string
  /** 当前页面上下文引用（type + id），用于模板变量替换 */
  autoReferences?: Array<{ type: string; id: number }>
}

export type OutputType =
  | 'REASONING'
  | 'CONTENT'
  | 'TOOL_CALL_STARTED'
  | 'TOOL_CALL'
  | 'TOOL_FINISHED'
  | 'SUB_AGENT_STARTED'
  | 'SUB_AGENT_FINISHED'
  | 'USER_CONFIRMATION_REQUIRED'
  | 'EXTERNAL_EXECUTION_REQUIRED'
  | 'USER_CONFIRM_RESULT'
  | 'EXTERNAL_EXECUTION_RESULT'
  | 'DONE'
  | 'ERROR'
  | 'CANCELLED'

export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
}

export interface ToolConfirmationDecision {
  toolCallId: string
  approved: boolean
}

/** 基础流事件 ([port] durable 字段在 Pipeline v2 事件上才出现) */
export interface BaseAiChatStreamEvent {
  schemaVersion?: number
  runId?: string
  sequence?: number
  messageId?: string
  conversationId?: string
  outputType: OutputType
  content?: string
  reasoningContent?: string
  reasoningStartTime?: number | null
  reasoningDurationMs?: number | null
  toolCalls?: ToolCallInfo[]
  toolCallId?: string
  toolName?: string
  toolResult?: string | null
  toolStatus?: string
  finished?: boolean
  error?: string
  /** 子 Agent 事件关联的父级工具调用 ID */
  parentToolCallId?: string
  /** 事件来源 Agent 名称（null 表示主 Agent） */
  agentName?: string
  source?: string
  replyId?: string
  blockId?: string
  rawEventId?: string
  rawEventType?: string
  createdAt?: string
  controlType?: string
  pendingToolCalls?: Array<{
    toolCallId: string
    toolName: string
    argumentsPreview: string
    plan?: {
      summary: string
      changes: Array<{ field: string; before: string; after: string }>
    }
    scope?: ToolCallScope
  }>
  decisions?: ToolConfirmationDecision[]
  expiresAt?: string
  cancellationReason?: string
}

export interface PendingToolCallPlanFieldChange {
  field: string
  before: string
  after: string
}

export interface PendingToolCallPlan {
  summary: string
  changes: PendingToolCallPlanFieldChange[]
}

/**
 * [adapt] P2-scope 任务 #15:确认等待事件的约束范围标记(PRD §6.1.4「InnerAgent
 * 传递与呈现 scope」)。
 *
 * - `resolved`:本次运行持有约束范围上下文(宿主实现 resolve_scope 反查);
 * - `degraded`:PRD §6.1.4 降级 —— 无上下文提示 + 写操作一律逐次确认;
 * - `summary`:可选人读摘要(降级时服务端携带稳定原因,resolved 形态可缺省)。
 *
 * 兼容:字段可选 —— 旧服务端事件无 `scope`,消费侧经 `normalizeToolCallScope`
 * 归一化为 degraded(fail-closed)+ UI 弱提示,不视为协议错误。
 */
export interface ToolCallScope {
  resolved: boolean
  degraded: boolean
  summary?: string
}

export interface PendingToolCallInfo {
  toolCallId: string
  toolName: string
  argumentsPreview: string
  plan?: PendingToolCallPlan
  scope?: ToolCallScope
}

/** 来自 durable run journal 的严格标识事件 */
export interface AiChatStreamEvent extends BaseAiChatStreamEvent {
  schemaVersion: 1
  runId: string
  sequence: number
  source?: string
  replyId?: string
  blockId?: string
  rawEventId?: string
  rawEventType?: string
  createdAt?: string
  controlType?: string
  pendingToolCalls?: PendingToolCallInfo[]
  decisions?: ToolConfirmationDecision[]
  expiresAt?: string
  cancellationReason?: string
}

export interface StreamCallbacks {
  onEvent: (event: AiChatStreamEvent) => void
  onError?: (error: Error) => void
  /** 仅在流交付了根终态事件之后调用。 */
  onComplete?: () => void
}

export type RunStatus =
  | 'RUNNING'
  | 'WAITING_CONFIRMATION'
  | 'WAITING_EXTERNAL'
  | 'CANCEL_REQUESTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export interface RunStatusResponse {
  runId: string
  status: RunStatus
  lastSequence: number
  waitingReplyId?: string
  terminalEvent?: AiChatStreamEvent
}

export interface RunningRun {
  runId: string
  conversationId: string
  projectId: number
  title: string
  category: string
  status: Exclude<RunStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>
  lastSequence: number
  waitingReplyId?: string
  startedAt: string
}

export type RunTarget =
  | { runId: string; conversationId?: never }
  | { conversationId: string; runId?: never }

interface StreamCursor {
  runId?: string
  lastSequence: number
  terminalSeen: boolean
}

// ========== SSE 解析 ([port] 照搬源实现, 协议不变) ==========

const OUTPUT_TYPES = new Set([
  'REASONING',
  'CONTENT',
  'TOOL_CALL_STARTED',
  'TOOL_CALL',
  'TOOL_FINISHED',
  'SUB_AGENT_STARTED',
  'SUB_AGENT_FINISHED',
  'USER_CONFIRMATION_REQUIRED',
  'EXTERNAL_EXECUTION_REQUIRED',
  'USER_CONFIRM_RESULT',
  'EXTERNAL_EXECUTION_RESULT',
  'DONE',
  'ERROR',
  'CANCELLED',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 CommonResult 信封里取 msg (旧后端用 msg; 兼容新信封的 message 字段) */
function getApiPayloadMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const message = payload.msg ?? payload.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

/** 源 api-error.readApiResponseError 的等价实现: 读非 2xx 响应体里的业务文案 */
async function readApiResponseError(response: Response): Promise<string> {
  try {
    const body = await response.text()
    if (body.trim()) {
      try {
        const message = getApiPayloadMessage(JSON.parse(body))
        if (message) return message
      } catch {
        // 错误响应必须是 CommonResult 结构。
      }
    }
  } catch {
    // 响应体不可读也走下面的兜底文案。
  }
  return '请求失败'
}

function parseEventId(value: string): { runId: string; sequence: number } {
  const separator = value.lastIndexOf(':')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('Pipeline SSE id is invalid')
  }
  const runId = value.slice(0, separator)
  const encodedSequence = value.slice(separator + 1)
  if (!/^\d+$/.test(encodedSequence)) {
    throw new Error('Pipeline SSE id sequence is invalid')
  }
  const sequence = Number(encodedSequence)
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('Pipeline SSE id sequence is outside the safe range')
  }
  return { runId, sequence }
}

function parsePipelineEvent(jsonText: string): AiChatStreamEvent {
  let value: unknown
  try {
    value = JSON.parse(jsonText)
  } catch {
    // 项目 lib 未启用 ErrorOptions, 旧实现的 { cause } 载荷在此省略
    throw new Error('Pipeline SSE data is not valid JSON')
  }
  if (!isRecord(value)) {
    throw new Error('Pipeline SSE data must be an object')
  }
  if (value.schemaVersion !== 1) {
    throw new Error('Unsupported Pipeline SSE schema version')
  }
  if (typeof value.runId !== 'string' || value.runId.trim() !== value.runId || !value.runId) {
    throw new Error('Pipeline SSE runId is invalid')
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) <= 0) {
    throw new Error('Pipeline SSE sequence is invalid')
  }
  if (typeof value.outputType !== 'string' || !OUTPUT_TYPES.has(value.outputType)) {
    throw new Error('Pipeline SSE outputType is invalid')
  }
  return value as unknown as AiChatStreamEvent
}

function isRootTerminalEvent(event: AiChatStreamEvent): boolean {
  return (
    !event.parentToolCallId &&
    !event.agentName &&
    (event.outputType === 'DONE' ||
      event.outputType === 'ERROR' ||
      event.outputType === 'CANCELLED')
  )
}

function parseSseEventBlock(
  eventBlock: string,
  callbacks: StreamCallbacks,
  cursor: StreamCursor,
) {
  const dataLines: string[] = []
  const idLines: string[] = []

  for (const rawLine of eventBlock.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    } else if (line.startsWith('id:')) {
      idLines.push(line.slice(3).trimStart())
    }
  }

  const jsonText = dataLines.join('\n').trim()
  if (!jsonText) return
  const idLine = idLines[0]
  if (idLines.length !== 1 || idLine === undefined) {
    throw new Error('Pipeline SSE event must contain exactly one id field')
  }

  const eventId = parseEventId(idLine)
  const event = parsePipelineEvent(jsonText)
  if (event.runId !== eventId.runId || event.sequence !== eventId.sequence) {
    throw new Error('Pipeline SSE id does not match its data identity')
  }
  if (cursor.runId && event.runId !== cursor.runId) {
    throw new Error('Pipeline SSE switched to a different run')
  }
  if (event.sequence <= cursor.lastSequence) {
    return
  }

  callbacks.onEvent(event)
  cursor.runId = event.runId
  cursor.lastSequence = event.sequence
  if (isRootTerminalEvent(event)) {
    cursor.terminalSeen = true
  }
}

function consumeSseBuffer(
  buffer: string,
  callbacks: StreamCallbacks,
  cursor: StreamCursor,
) {
  const normalizedBuffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const eventBlocks = normalizedBuffer.split('\n\n')
  const remaining = eventBlocks.pop() || ''

  for (const eventBlock of eventBlocks) {
    parseSseEventBlock(eventBlock, callbacks, cursor)
  }
  return remaining
}

async function consumeRunResponse(
  response: Response,
  callbacks: StreamCallbacks,
  cursor: StreamCursor,
) {
  if (!response.ok) {
    throw new Error(await readApiResponseError(response))
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('无法获取 Pipeline 响应流')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeSseBuffer(buffer, callbacks, cursor)
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    parseSseEventBlock(buffer.replace(/\r\n/g, '\n'), callbacks, cursor)
  }
  if (!cursor.terminalSeen) {
    throw new Error('Pipeline SSE ended before a terminal journal event')
  }
  callbacks.onComplete?.()
}

function runStreamRequest(
  request: () => Promise<Response>,
  callbacks: StreamCallbacks,
  cursor: StreamCursor,
  controller: AbortController,
) {
  void (async () => {
    try {
      await consumeRunResponse(await request(), callbacks, cursor)
    } catch (error) {
      if (controller.signal.aborted) return
      callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  })()
}

// ========== SSE API ([adapt] 端点重映射) ==========

/** 发起新 Run (源 pipelineStream): POST {base}/runs (SSE) */
export function startRunStream(
  req: AiChatReq,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController()
  const cursor: StreamCursor = { lastSequence: 0, terminalSeen: false }
  runStreamRequest(
    () =>
      authenticatedFetch(`${getBaseURL()}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      }),
    callbacks,
    cursor,
    controller,
  )
  return controller
}

/** 按 run 续跑 (源 continuePipelineStream): POST {base}/runs/{runId}/continue (SSE) */
export function continueRunStream(
  runId: string,
  callbacks: StreamCallbacks,
): AbortController {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId) {
    throw new Error('runId is required for Run continuation')
  }
  const controller = new AbortController()
  const cursor: StreamCursor = { lastSequence: 0, terminalSeen: false }
  runStreamRequest(
    () => authenticatedFetch(
      `${getBaseURL()}/runs/${encodeURIComponent(normalizedRunId)}/continue`,
      { method: 'POST', signal: controller.signal },
    ),
    callbacks,
    cursor,
    controller,
  )
  return controller
}

/**
 * 断点续传 (源 reconnectPipelineStream): GET {base}/runs/{runId}/events。
 * Last-Event-ID 语义不变 (id = `runId:sequence`), 服务端从该 cursor 之后重放。
 */
export function reconnectRunStream(
  runId: string,
  afterSequence: number,
  callbacks: StreamCallbacks,
): AbortController {
  if (!runId || runId.trim() !== runId) {
    throw new Error('runId is required for Run reconnect')
  }
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error('afterSequence must be a non-negative safe integer')
  }

  const controller = new AbortController()
  const cursor: StreamCursor = {
    runId,
    lastSequence: afterSequence,
    terminalSeen: false,
  }
  const eventId = `${runId}:${afterSequence}`
  runStreamRequest(
    () =>
      authenticatedFetch(
        `${getBaseURL()}/runs/${encodeURIComponent(runId)}/events`,
        {
          method: 'GET',
          headers: { 'Last-Event-ID': eventId },
          signal: controller.signal,
        },
      ),
    callbacks,
    cursor,
    controller,
  )
  return controller
}

// ========== Query API ([adapt] 走 http 实例: 信封解包/401 懒换由 client 统一处理) ==========

/**
 * 请求取消 (源 cancelPipeline)。
 * runId → POST /runs/{runId}/cancel (契约端点);
 * 仅 conversationId (乐观会话) → POST /runs/cancel?conversationId=... (兼容兜底, 见文件头偏差)。
 */
export async function cancelRun(target: RunTarget): Promise<void> {
  if (target.runId) {
    await http.post(`${getBaseURL()}/runs/${encodeURIComponent(target.runId)}/cancel`)
    return
  }
  const conversationId = target.conversationId
  if (!conversationId) {
    throw new Error('cancelRun requires runId or conversationId')
  }
  const query = new URLSearchParams({ conversationId })
  await http.post(`${getBaseURL()}/runs/cancel?${query.toString()}`)
}

/** 工具调用人工确认: POST /runs/{runId}/confirm */
export async function confirmRunTools(request: {
  runId: string
  replyId: string
  decisions: ToolConfirmationDecision[]
}): Promise<void> {
  const { runId, ...body } = request
  await http.post(`${getBaseURL()}/runs/${encodeURIComponent(runId)}/confirm`, body)
}

/** 确认过期: POST /runs/{runId}/confirm/expire */
export async function expireRunConfirmation(request: {
  runId: string
  replyId: string
}): Promise<void> {
  const { runId, ...body } = request
  await http.post(`${getBaseURL()}/runs/${encodeURIComponent(runId)}/confirm/expire`, body)
}

// ---- status: runId 直查; conversationId 经 /runs/running 匹配 (见文件头) ----

const RUNNING_LIST_CACHE_TTL_MS = 500
let runningListCache: { at: number; promise: Promise<RunningRun[]> } | null = null

/** 测试隔离用: 清空 /runs/running 微缓存 */
export function resetRunningListCache(): void {
  runningListCache = null
}

function fetchRunningList(): Promise<RunningRun[]> {
  if (runningListCache && Date.now() - runningListCache.at < RUNNING_LIST_CACHE_TTL_MS) {
    return runningListCache.promise
  }
  const promise = http.get<RunningRun[]>(`${getBaseURL()}/runs/running`)
  runningListCache = { at: Date.now(), promise }
  promise.catch(() => { runningListCache = null })
  return promise
}

export async function getRunStatus(target: RunTarget): Promise<RunStatusResponse> {
  if (target.runId) {
    return http.get<RunStatusResponse>(
      `${getBaseURL()}/runs/${encodeURIComponent(target.runId)}`,
    )
  }
  const running = await fetchRunningList()
  const match = running.find((item) => item.conversationId === target.conversationId)
  if (match) {
    return {
      runId: match.runId,
      status: match.status,
      lastSequence: match.lastSequence,
      waitingReplyId: match.waitingReplyId,
    }
  }
  // 不在运行列表 = 已到终态 (running 列表即运行中集合); 具体终态由事件/历史投影回填。
  return { runId: '', status: 'COMPLETED', lastSequence: 0 }
}

/** 列出运行中的 runs: GET /runs/running */
export async function listRunningRuns(): Promise<RunningRun[]> {
  return http.get<RunningRun[]>(`${getBaseURL()}/runs/running`)
}
