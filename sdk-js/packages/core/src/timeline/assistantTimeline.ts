/**
 * [port] 融光助手纯事件 reducer + 历史消息回放。
 * 源: $SRC/src/store/assistantTimeline.ts (1273 行) — reducer 逻辑 1:1 保留。
 *
 * 来源对照 (ai-fusion-video-web):
 * - components/dashboard/agent-pipeline/state.ts → reducePipelineEvent /
 *   createInitialPipelineState / createPendingPipelineState (含工具确认三态:
 *   USER_CONFIRMATION_REQUIRED / USER_CONFIRM_RESULT / CONFIRMATION_EXPIRED)
 * - lib/store/pipeline-timeline.ts → persistedToolTimelineStatus
 * - lib/store/assistant-runtime.ts → 状态映射 / 标题规整 / 消息合并 / 会话去重
 * - components/dashboard/notification-panel/history.ts → messagesToTimeline
 *
 * 定向适配 (改动类型 [adapt]):
 * - import 重锚: '@/api/ai-pipeline'→'../runs'、'@/api/assistant'→'../conversations'、
 *   '@/store/pipeline' 类型→'./types'
 * - subAgentToolNames: 融光业务名单 → displayNames.ts 可注入配置 (默认空集)
 */

import type {
  AiChatStreamEvent,
  PendingToolCallPlan,
} from '../runs'
import type { AgentConversation, AgentMessage } from '../conversations'
import type { SubTimelineItem, TimelineItem, ToolTimelineStatus } from './types'
import { subAgentToolNames } from '../displayNames'

// ========== Pipeline 状态 (旧 agent-pipeline/types.ts AgentPipelineState) ==========

export interface AssistantPendingConfirmation {
  runId: string
  replyId: string
  parentToolCallId?: string
  toolCalls: AiChatStreamEvent['pendingToolCalls']
  expiresAt: string
  decisions: Record<string, boolean>
  submitting: boolean
}

export interface AgentPipelineState {
  status: 'idle' | 'reasoning' | 'running' | 'cancelling' | 'done' | 'error' | 'cancelled'
  reasoningText: string
  reasoningStartTime?: number
  reasoningDurationMs?: number
  timeline: TimelineItem[]
  runId?: string
  lastSequence: number
  conversationId?: string
  error?: string
  pendingConfirmation?: AssistantPendingConfirmation
}

export function createInitialPipelineState(): AgentPipelineState {
  return {
    status: 'idle',
    reasoningText: '',
    timeline: [],
    lastSequence: 0,
  }
}

export function createPendingPipelineState(): AgentPipelineState {
  return {
    status: 'reasoning',
    reasoningText: '',
    timeline: [],
    lastSequence: 0,
  }
}

export function pendingPipelineForNextRun(conversationId: string): AgentPipelineState {
  return {
    ...createPendingPipelineState(),
    conversationId,
    lastSequence: 0,
  }
}

// ========== 状态映射 (旧 assistant-runtime.ts) ==========

export function statusIsRunning(status: string | undefined): boolean {
  return status === 'running'
    || status === 'pending'
    || status === 'RUNNING'
    || status === 'WAITING_CONFIRMATION'
    || status === 'WAITING_EXTERNAL'
    || status === 'CANCEL_REQUESTED'
}

export function statusFromPipeline(status: PipelineStatus): string {
  switch (status) {
    case 'COMPLETED': return 'completed'
    case 'FAILED': return 'failed'
    case 'CANCELLED': return 'cancelled'
    case 'CANCEL_REQUESTED': return 'CANCEL_REQUESTED'
    case 'WAITING_CONFIRMATION': return 'WAITING_CONFIRMATION'
    case 'WAITING_EXTERNAL': return 'WAITING_EXTERNAL'
    case 'ERROR': return 'failed'
    default: return 'running'
  }
}

type PipelineStatus = import('../runs').RunStatus | string

export function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.slice(0, 50) || '新对话'
}

export function hasTerminal(event: AiChatStreamEvent): boolean {
  return !event.parentToolCallId
    && !event.agentName
    && (event.outputType === 'DONE' || event.outputType === 'ERROR' || event.outputType === 'CANCELLED')
}

export function terminalStatusForEvent(
  event: AiChatStreamEvent,
): 'completed' | 'failed' | 'cancelled' {
  if (event.outputType === 'DONE') return 'completed'
  if (event.outputType === 'ERROR') return 'failed'
  return 'cancelled'
}

export interface HasPipelineRuntime {
  pipeline: AgentPipelineState
}

export function hasLiveTranscript(runtime: HasPipelineRuntime): boolean {
  return runtime.pipeline.timeline.length > 0
    || runtime.pipeline.reasoningText.trim().length > 0
}

// ========== 持久化工具状态 (旧 pipeline-timeline.ts) ==========

function finishedToolTimelineStatus(
  status: string | undefined,
): Extract<ToolTimelineStatus, 'done' | 'error' | 'cancelled'> {
  if (status === 'success' || status === 'done') return 'done'
  if (status === 'error') return 'error'
  if (status === 'cancelled') return 'cancelled'
  throw new Error(`Unsupported finished tool status: ${String(status)}`)
}

export function persistedToolTimelineStatus(status?: string): ToolTimelineStatus {
  if (status === 'running') return 'calling'
  if (status === 'rejected') return 'rejected'
  if (status === 'expired') return 'expired'
  return finishedToolTimelineStatus(status)
}

// ========== Timeline 纯操作 (旧 agent-pipeline/state.ts 内部函数) ==========

function appendReasoningToSubTimeline(
  children: SubTimelineItem[],
  reasoningContent: string,
  startedAtMs?: number,
): SubTimelineItem[] {
  const last = children[children.length - 1]
  if (last && last.type === 'reasoning') {
    return [
      ...children.slice(0, -1),
      {
        ...last,
        text: last.text + reasoningContent,
        startedAtMs: last.startedAtMs ?? startedAtMs,
      },
    ]
  }
  return [
    ...children,
    {
      type: 'reasoning',
      text: reasoningContent,
      ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    },
  ]
}

function updateLastSubTimelineReasoningDuration(
  children: SubTimelineItem[],
  durationMs: number,
): SubTimelineItem[] {
  for (let index = children.length - 1; index >= 0; index--) {
    const item = children[index]
    if (item === undefined) continue
    if (item.type === 'reasoning') {
      return children.map((child, childIndex) =>
        childIndex === index && child.type === 'reasoning'
          ? { ...child, durationMs }
          : child,
      )
    }
  }
  return children
}

function appendReasoningToTimeline(
  timeline: TimelineItem[],
  reasoningContent: string,
  startedAtMs?: number,
): TimelineItem[] {
  const last = timeline[timeline.length - 1]
  if (last && last.type === 'reasoning') {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        text: last.text + reasoningContent,
        startedAtMs: last.startedAtMs ?? startedAtMs,
      },
    ]
  }
  return [
    ...timeline,
    {
      type: 'reasoning',
      text: reasoningContent,
      ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    },
  ]
}

function updateLastTimelineReasoningDuration(
  timeline: TimelineItem[],
  durationMs: number,
): TimelineItem[] {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index]
    if (item === undefined) continue
    if (item.type === 'reasoning') {
      return timeline.map((timelineItem, timelineIndex) =>
        timelineIndex === index && timelineItem.type === 'reasoning'
          ? { ...timelineItem, durationMs }
          : timelineItem,
      )
    }
  }
  return timeline
}

function updateToolStatus(
  timeline: TimelineItem[],
  toolCallId: string,
  status: ToolTimelineStatus,
): TimelineItem[] {
  return timeline.map((item) =>
    item.type === 'tool' && item.id === toolCallId
      ? { ...item, status }
      : item,
  )
}

/** 取消仍处于进行中的工具节点 (旧 pipeline-timeline cancelCallingTimelineTools) */
function isInProgressToolStatus(status: ToolTimelineStatus): boolean {
  return status === 'preparing'
    || status === 'calling'
    || status === 'awaiting_approval'
    || status === 'approved'
}

function cancelCallingSubTimelineTools(children: SubTimelineItem[]): SubTimelineItem[] {
  let changed = false
  const next = children.map((child) => {
    if (child.type !== 'tool' || !isInProgressToolStatus(child.status)) return child
    changed = true
    return { ...child, status: 'cancelled' as const }
  })
  return changed ? next : children
}

export function cancelCallingTimelineTools(timeline: TimelineItem[]): TimelineItem[] {
  let changed = false
  const next = timeline.map((item) => {
    if (item.type !== 'tool') return item
    const children = item.children
      ? cancelCallingSubTimelineTools(item.children)
      : item.children
    const status = isInProgressToolStatus(item.status) ? 'cancelled' as const : item.status
    if (status === item.status && children === item.children) return item
    changed = true
    return { ...item, status, children }
  })
  return changed ? next : timeline
}

type ToolStatusUpdate = {
  status: ToolTimelineStatus
  expectedStatus: ToolTimelineStatus
  expectedName?: string
  plan?: PendingToolCallPlan
}

function updateConfirmationToolStatuses(
  timeline: TimelineItem[],
  parentToolCallId: string | undefined,
  updates: ReadonlyMap<string, ToolStatusUpdate>,
): TimelineItem[] {
  if (updates.size === 0) {
    throw new Error('Tool confirmation must contain at least one decision')
  }

  const updateChildren = (children: SubTimelineItem[]): SubTimelineItem[] => {
    for (const [toolCallId, update] of updates) {
      const matches = children.filter(
        (child) => child.type === 'tool' && child.id === toolCallId,
      )
      if (matches.length !== 1) {
        throw new Error(`Expected one child tool call for confirmation: ${toolCallId}`)
      }
      const match = matches[0]
      if (match?.type !== 'tool') {
        throw new Error(`Invalid confirmation state for child tool call: ${toolCallId}`)
      }
      if (update.expectedName !== undefined && match.name !== update.expectedName) {
        throw new Error(`Confirmation tool name mismatch: ${toolCallId}`)
      }
    }
    return children.map((child) => {
      if (child.type !== 'tool') return child
      const update = updates.get(child.id)
      if (!update) return child
      return update.plan
        ? { ...child, status: update.status, plan: update.plan }
        : { ...child, status: update.status }
    })
  }

  if (parentToolCallId) {
    const parents = timeline.filter(
      (item) => item.type === 'tool' && item.id === parentToolCallId,
    )
    if (parents.length !== 1 || parents[0]?.type !== 'tool' || !parents[0].children) {
      throw new Error(`Confirmation parent tool call is missing: ${parentToolCallId}`)
    }
    return timeline.map((item) => item.type === 'tool' && item.id === parentToolCallId
      ? { ...item, children: updateChildren(item.children ?? []) }
      : item)
  }

  for (const [toolCallId, update] of updates) {
    const matches = timeline.filter(
      (item) => item.type === 'tool' && item.id === toolCallId,
    )
    const match = matches[0]
    if (matches.length !== 1 || match?.type !== 'tool') {
      throw new Error(`Expected one tool call for confirmation: ${toolCallId}`)
    }
    if (match.status !== update.expectedStatus) {
      throw new Error(`Invalid confirmation state for tool call: ${toolCallId}`)
    }
    if (update.expectedName !== undefined && match.name !== update.expectedName) {
      throw new Error(`Confirmation tool name mismatch: ${toolCallId}`)
    }
  }
  return timeline.map((item) => {
    if (item.type !== 'tool') return item
    const update = updates.get(item.id)
    if (!update) return item
    return update.plan
      ? { ...item, status: update.status, plan: update.plan }
      : { ...item, status: update.status }
  })
}

function requireConfirmationDecisions(
  event: AiChatStreamEvent,
  pending: AssistantPendingConfirmation,
): Map<string, boolean> {
  if (!event.replyId || event.replyId !== pending.replyId) {
    throw new Error('USER_CONFIRM_RESULT replyId does not match the pending confirmation')
  }
  if (event.parentToolCallId !== pending.parentToolCallId) {
    throw new Error('USER_CONFIRM_RESULT parent tool identity does not match')
  }
  if (!event.decisions?.length) {
    throw new Error('USER_CONFIRM_RESULT has no decisions')
  }
  const decisions = new Map<string, boolean>()
  for (const decision of event.decisions) {
    if (!decision.toolCallId || typeof decision.approved !== 'boolean') {
      throw new Error('USER_CONFIRM_RESULT contains an invalid decision')
    }
    if (decisions.has(decision.toolCallId)) {
      throw new Error(`USER_CONFIRM_RESULT contains a duplicate decision: ${decision.toolCallId}`)
    }
    decisions.set(decision.toolCallId, decision.approved)
  }
  const pendingIds = new Set(
    (pending.toolCalls ?? []).map((toolCall) => toolCall.toolCallId),
  )
  if (
    pendingIds.size !== (pending.toolCalls ?? []).length
    || decisions.size !== pendingIds.size
    || [...decisions.keys()].some((toolCallId) => !pendingIds.has(toolCallId))
  ) {
    throw new Error('USER_CONFIRM_RESULT decisions do not match the pending tool calls')
  }
  return decisions
}

function finishToolCall(
  timeline: TimelineItem[],
  parentToolCallId: string | undefined,
  toolCallId: string,
  status: Extract<ToolTimelineStatus, 'done' | 'error' | 'cancelled'>,
  result: string | null | undefined,
): TimelineItem[] {
  const validPreviousStatus = (value: ToolTimelineStatus) =>
    value === 'calling' || value === 'approved'

  if (parentToolCallId) {
    const parents = timeline.filter(
      (item) => item.type === 'tool' && item.id === parentToolCallId,
    )
    const parent = parents[0]
    if (parents.length !== 1 || parent?.type !== 'tool' || !parent.children) {
      throw new Error(`Finished tool parent is missing: ${parentToolCallId}`)
    }
    const children = parent.children
    const matches = children.filter(
      (child) => child.type === 'tool' && child.id === toolCallId,
    )
    const match = matches[0]
    if (
      matches.length !== 1
      || match?.type !== 'tool'
      || !validPreviousStatus(match.status)
    ) {
      throw new Error(`Finished child tool has no valid in-progress call: ${toolCallId}`)
    }
    return timeline.map((item) => item.type === 'tool' && item.id === parentToolCallId
      ? {
          ...item,
          children: (item.children ?? []).map((child) =>
            child.type === 'tool' && child.id === toolCallId
              ? { ...child, status, result }
              : child),
        }
      : item)
  }

  const matches = timeline.filter(
    (item) => item.type === 'tool' && item.id === toolCallId,
  )
  const match = matches[0]
  if (
    matches.length !== 1
    || match?.type !== 'tool'
    || !validPreviousStatus(match.status)
  ) {
    throw new Error(`Finished tool has no valid in-progress call: ${toolCallId}`)
  }
  return timeline.map((item) => item.type === 'tool' && item.id === toolCallId
    ? { ...item, status, result }
    : item)
}

function appendToToolChildren(
  timeline: TimelineItem[],
  parentToolCallId: string,
  updater: (children: SubTimelineItem[]) => SubTimelineItem[],
): TimelineItem[] {
  return timeline.map((item) =>
    item.type === 'tool' && item.id === parentToolCallId
      ? { ...item, children: updater(item.children ?? []) }
      : item,
  )
}

function appendContentToSubTimeline(children: SubTimelineItem[], content: string): SubTimelineItem[] {
  const updated = [...children]
  const last = updated[updated.length - 1]
  if (last && last.type === 'content') {
    return [
      ...updated.slice(0, -1),
      { ...last, text: last.text + content },
    ]
  }
  return [...updated, { type: 'content', text: content }]
}

function appendContentToTimeline(timeline: TimelineItem[], content: string): TimelineItem[] {
  const last = timeline[timeline.length - 1]
  if (last && last.type === 'content') {
    return [
      ...timeline.slice(0, -1),
      { ...last, text: last.text + content },
    ]
  }
  return [...timeline, { type: 'content', text: content }]
}

function validTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function validDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

// ========== 核心 reducer (旧 agent-pipeline/state.ts reducePipelineEvent) ==========

export function reducePipelineEvent(
  prev: AgentPipelineState,
  event: AiChatStreamEvent,
): AgentPipelineState {
  if (prev.runId && prev.runId !== event.runId) {
    throw new Error('Pipeline event belongs to a different run')
  }
  if (event.sequence <= prev.lastSequence) {
    return prev
  }
  const next: AgentPipelineState = {
    ...prev,
    timeline: [...prev.timeline],
    runId: event.runId,
    lastSequence: event.sequence,
    error: undefined,
  }

  if (event.conversationId) {
    next.conversationId = event.conversationId
  }

  const isSubAgent = !!event.parentToolCallId
  const eventReasoningDurationMs = validDuration(event.reasoningDurationMs)

  if (eventReasoningDurationMs !== undefined) {
    if (isSubAgent) {
      next.timeline = appendToToolChildren(
        next.timeline,
        event.parentToolCallId ?? '',
        (children) =>
          updateLastSubTimelineReasoningDuration(children, eventReasoningDurationMs),
      )
    } else {
      next.reasoningDurationMs = eventReasoningDurationMs
      next.timeline = updateLastTimelineReasoningDuration(next.timeline, eventReasoningDurationMs)
    }
  }

  switch (event.outputType) {
    case 'REASONING':
      if (event.reasoningContent) {
        const reasoningStartTime = validTimestamp(event.reasoningStartTime)
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? '',
            (children) =>
              appendReasoningToSubTimeline(children, event.reasoningContent ?? '', reasoningStartTime),
          )
        } else {
          next.status = prev.status === 'cancelling' ? 'cancelling' : 'reasoning'
          const last = next.timeline[next.timeline.length - 1]
          if (!last || last.type !== 'reasoning') {
            next.reasoningText = ''
            next.reasoningDurationMs = undefined
            next.reasoningStartTime = reasoningStartTime
          } else if (next.reasoningStartTime === undefined) {
            next.reasoningStartTime = reasoningStartTime
          }
          next.reasoningText += event.reasoningContent
          next.timeline = appendReasoningToTimeline(
            next.timeline,
            event.reasoningContent,
            reasoningStartTime,
          )
        }
      }
      return next

    case 'CONTENT':
      next.status = prev.status === 'cancelling' ? 'cancelling' : 'running'
      if (event.content) {
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? '',
            (children) => appendContentToSubTimeline(children, event.content ?? ''),
          )
        } else {
          next.timeline = appendContentToTimeline(next.timeline, event.content)
        }
      }
      return next

    case 'TOOL_CALL_STARTED':
      next.status = prev.status === 'cancelling' ? 'cancelling' : 'running'
      if (!event.replyId || !event.toolCalls?.length) {
        throw new Error('TOOL_CALL_STARTED event has no replyId or tool calls')
      }
      for (const toolCall of event.toolCalls) {
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? '',
            (children) => {
              if (children.some((child) => child.type === 'tool' && child.id === toolCall.id)) {
                throw new Error(`Tool call already started: ${toolCall.id}`)
              }
              return [
                ...children,
                {
                  type: 'tool' as const,
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: '',
                  batchId: event.replyId,
                  status: 'preparing' as const,
                },
              ]
            },
          )
        } else {
          if (next.timeline.some((item) => item.type === 'tool' && item.id === toolCall.id)) {
            throw new Error(`Tool call already started: ${toolCall.id}`)
          }
          next.timeline.push({
            type: 'tool',
            id: toolCall.id,
            name: toolCall.name,
            arguments: '',
            batchId: event.replyId,
            status: 'preparing',
            agentName: event.agentName,
          })
        }
      }
      return next

    case 'TOOL_CALL':
      next.status = prev.status === 'cancelling' ? 'cancelling' : 'running'
      if (!event.replyId || !event.toolCalls?.length) {
        throw new Error('TOOL_CALL event has no replyId or tool calls')
      }
      {
        for (const toolCall of event.toolCalls) {
          if (isSubAgent) {
            next.timeline = appendToToolChildren(
              next.timeline,
              event.parentToolCallId ?? '',
              (children) => {
                const existing = children.find(
                  (child) => child.type === 'tool' && child.id === toolCall.id,
                )
                if (existing?.type === 'tool') {
                  if (existing.status !== 'preparing' || existing.name !== toolCall.name) {
                    throw new Error(`Invalid completed tool call definition: ${toolCall.id}`)
                  }
                  return children.map((child) => child.type === 'tool' && child.id === toolCall.id
                    ? {
                        ...child,
                        arguments: toolCall.arguments,
                        batchId: event.replyId,
                        status: 'calling' as const,
                      }
                    : child)
                }
                return [
                  ...children,
                  {
                    type: 'tool' as const,
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    batchId: event.replyId,
                    status: 'calling' as const,
                  },
                ]
              },
            )
          } else {
            const existing = next.timeline.find(
              (item) => item.type === 'tool' && item.id === toolCall.id,
            )
            if (existing?.type === 'tool') {
              if (existing.status !== 'preparing' || existing.name !== toolCall.name) {
                throw new Error(`Invalid completed tool call definition: ${toolCall.id}`)
              }
              next.timeline = next.timeline.map((item) => item.type === 'tool' && item.id === toolCall.id
                ? {
                    ...item,
                    arguments: toolCall.arguments,
                    batchId: event.replyId,
                    status: 'calling' as const,
                  }
                : item)
            } else {
              next.timeline.push({
                type: 'tool',
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                batchId: event.replyId,
                status: 'calling',
                agentName: event.agentName,
              })
            }
          }
        }
      }
      return next

    case 'TOOL_FINISHED':
      if (!event.toolCallId) {
        throw new Error('TOOL_FINISHED event has no toolCallId')
      }
      next.timeline = finishToolCall(
        next.timeline,
        event.parentToolCallId,
        event.toolCallId,
        finishedToolTimelineStatus(event.toolStatus),
        event.toolResult,
      )
      return next

    case 'SUB_AGENT_FINISHED':
      if (isSubAgent) {
        next.timeline = updateToolStatus(
          next.timeline,
          event.parentToolCallId ?? '',
          'done',
        )
      }
      return next

    case 'USER_CONFIRMATION_REQUIRED':
      if (!event.replyId || !event.pendingToolCalls?.length || !event.expiresAt) {
        throw new Error('Invalid USER_CONFIRMATION_REQUIRED event')
      }
      {
        const existing = prev.pendingConfirmation
        if (existing && (
          existing.runId !== event.runId
          || existing.replyId !== event.replyId
          || existing.parentToolCallId !== event.parentToolCallId
          || existing.expiresAt !== event.expiresAt
        )) {
          throw new Error('Concurrent tool confirmation batches have different identities')
        }
        const existingToolCalls = new Map(
          (existing?.toolCalls ?? []).map((toolCall) => [toolCall.toolCallId, toolCall]),
        )
        const updates = new Map<string, ToolStatusUpdate>()
        const appendedToolCalls: NonNullable<AiChatStreamEvent['pendingToolCalls']> = []
        for (const toolCall of event.pendingToolCalls) {
          if (updates.has(toolCall.toolCallId)) {
            throw new Error(`Duplicate pending tool call: ${toolCall.toolCallId}`)
          }
          const existingToolCall = existingToolCalls.get(toolCall.toolCallId)
          if (existingToolCall && (
            existingToolCall.toolName !== toolCall.toolName
            || existingToolCall.argumentsPreview !== toolCall.argumentsPreview
          )) {
            throw new Error(`Pending tool call changed within its batch: ${toolCall.toolCallId}`)
          }
          updates.set(toolCall.toolCallId, {
            status: 'awaiting_approval',
            expectedStatus: existingToolCall ? 'awaiting_approval' : 'calling',
            expectedName: toolCall.toolName,
            ...(toolCall.plan ? { plan: toolCall.plan } : {}),
          })
          if (!existingToolCall) appendedToolCalls.push(toolCall)
        }
        if (existing
          && (existing.submitting || Object.keys(existing.decisions).length > 0)
          && appendedToolCalls.length > 0) {
          throw new Error('Tool confirmation batch changed after a decision was submitted')
        }
        next.timeline = updateConfirmationToolStatuses(
          next.timeline,
          event.parentToolCallId,
          updates,
        )
        next.pendingConfirmation = existing
          ? {
              ...existing,
              toolCalls: [...(existing.toolCalls ?? []), ...appendedToolCalls],
            }
          : {
              runId: event.runId,
              replyId: event.replyId,
              ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
              toolCalls: event.pendingToolCalls,
              expiresAt: event.expiresAt,
              decisions: {},
              submitting: false,
            }
      }
      next.status = prev.status === 'cancelling' ? 'cancelling' : 'running'
      return next

    case 'USER_CONFIRM_RESULT':
      if (!prev.pendingConfirmation) {
        throw new Error('USER_CONFIRM_RESULT has no pending confirmation')
      }
      {
        const decisions = requireConfirmationDecisions(event, prev.pendingConfirmation)
        const updates = new Map<string, ToolStatusUpdate>()
        for (const [toolCallId, approved] of decisions) {
          updates.set(toolCallId, {
            status: approved ? 'approved' : 'rejected',
            expectedStatus: 'awaiting_approval',
          })
        }
        next.timeline = updateConfirmationToolStatuses(
          next.timeline,
          event.parentToolCallId,
          updates,
        )
      }
      next.pendingConfirmation = undefined
      next.status = prev.status === 'cancelling' ? 'cancelling' : 'running'
      return next

    case 'DONE':
      if (event.parentToolCallId || event.agentName) return next
      next.status = 'done'
      next.pendingConfirmation = undefined
      if (event.content) {
        next.timeline = appendContentToTimeline(next.timeline, event.content)
      }
      return next

    case 'ERROR':
      if (isSubAgent) {
        next.timeline = updateToolStatus(
          next.timeline,
          event.parentToolCallId ?? '',
          'error',
        )
        next.timeline = appendToToolChildren(
          next.timeline,
          event.parentToolCallId ?? '',
          (children) => [
            ...children,
            {
              type: 'content',
              text: `❌ ${event.agentName || '子Agent'} 出错: ${event.error || '未知错误'}`,
            },
          ],
        )
      } else {
        next.status = 'error'
        next.pendingConfirmation = undefined
        next.error = event.error || '未知错误'
      }
      return next

    case 'CANCELLED':
      if (!event.parentToolCallId && !event.agentName) {
        next.status = 'cancelled'
        if (
          event.cancellationReason === 'CONFIRMATION_EXPIRED'
          && prev.pendingConfirmation
        ) {
          const updates = new Map<string, ToolStatusUpdate>()
          for (const toolCall of prev.pendingConfirmation.toolCalls ?? []) {
            updates.set(toolCall.toolCallId, {
              status: 'expired',
              expectedStatus: 'awaiting_approval',
              expectedName: toolCall.toolName,
            })
          }
          next.timeline = updateConfirmationToolStatuses(
            next.timeline,
            prev.pendingConfirmation.parentToolCallId,
            updates,
          )
        } else {
          next.timeline = cancelCallingTimelineTools(next.timeline)
        }
        next.pendingConfirmation = undefined
        if (event.content) {
          next.timeline = appendContentToTimeline(next.timeline, event.content)
        }
      }
      return next

    default:
      return next
  }
}

/** 助手事件包装: cancelling 状态下保持, 直到根终态 (旧 assistant-runtime.reduceAssistantEvent) */
export function reduceAssistantEvent(
  pipeline: AgentPipelineState,
  event: AiChatStreamEvent,
): AgentPipelineState {
  const next = reducePipelineEvent(pipeline, event)
  return pipeline.status === 'cancelling' && next.status === 'cancelling'
    ? { ...next, timeline: cancelCallingTimelineTools(next.timeline) }
    : next
}

// ========== 历史消息回放 (旧 notification-panel/history.ts) ==========

function isSubAgentTool(name: string): boolean {
  return subAgentToolNames().includes(name)
}

function normalizeToolResult(toolName: string | undefined, content: string | undefined): string | undefined {
  if (!content || !toolName || !isSubAgentTool(toolName)) {
    return content
  }
  try {
    const value: unknown = JSON.parse(content)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return content
    }
    const result = (value as Record<string, unknown>).result
    if (typeof result === 'string' && result.trim()) {
      return result
    }
    const error = (value as Record<string, unknown>).error
    if (typeof error === 'string' && error.trim()) {
      return error
    }
  } catch {
    // 非 JSON 的子 Agent 结果直接按原文本展示。
  }
  return content
}

type PersistedToolItem = Extract<TimelineItem | SubTimelineItem, { type: 'tool' }>

function requireToolMessageIdentity(message: AgentMessage): { toolCallId: string; toolName: string } {
  if (!message.toolCallId) {
    throw new Error(`Persisted tool message ${message.id} has no toolCallId`)
  }
  if (!message.toolName) {
    throw new Error(`Persisted tool message ${message.id} has no toolName`)
  }
  return { toolCallId: message.toolCallId, toolName: message.toolName }
}

function fillPersistedToolArguments(
  item: PersistedToolItem,
  toolCallId: string,
  toolName: string,
  toolArguments: string,
  child: boolean,
): void {
  if (item.name !== toolName) {
    throw new Error(`Persisted ${child ? 'child ' : ''}tool name changed: ${toolCallId}`)
  }
  if (item.status === 'calling') {
    throw new Error(`Persisted ${child ? 'child ' : ''}tool call is duplicated: ${toolCallId}`)
  }
  item.arguments = toolArguments
}

function createPersistedSettledTool(
  toolCallId: string,
  toolName: string,
  toolStatus: string | undefined,
  content: string | undefined,
  child: boolean,
): PersistedToolItem {
  const status = persistedToolTimelineStatus(toolStatus)
  if (status === 'cancelled') {
    if (typeof content !== 'string') {
      throw new Error(`Persisted cancelled ${child ? 'child ' : ''}tool ${toolCallId} has no arguments`)
    }
    return {
      type: 'tool',
      id: toolCallId,
      name: toolName,
      arguments: content,
      status,
    }
  }
  return {
    type: 'tool',
    id: toolCallId,
    name: toolName,
    arguments: '',
    status,
    result: normalizeToolResult(toolName, content),
  }
}

function pushReasoningToTimeline(timeline: TimelineItem[], text: string, durationMs?: number): void {
  const last = timeline[timeline.length - 1]
  if (last && last.type === 'reasoning') {
    last.text += text
    if (durationMs !== undefined) {
      last.durationMs = durationMs
    }
    return
  }
  timeline.push({
    type: 'reasoning',
    text,
    ...(durationMs !== undefined ? { durationMs } : {}),
  })
}

function pushContentToTimeline(timeline: TimelineItem[], text: string): void {
  const last = timeline[timeline.length - 1]
  if (last && last.type === 'content') {
    last.text = last.text.endsWith('\n\n')
      ? last.text + text
      : last.text.endsWith('\n')
        ? `${last.text}\n${text}`
        : `${last.text}\n\n${text}`
    return
  }
  timeline.push({ type: 'content', text })
}

function updateLastReasoningDurationInList(
  items: Array<Extract<TimelineItem | SubTimelineItem, { type: 'reasoning' } | { type: 'content' }> | TimelineItem | SubTimelineItem>,
  durationMs: number,
): void {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item && item.type === 'reasoning') {
      ;(item as { durationMs?: number }).durationMs = durationMs
      return
    }
  }
}

/** 历史消息 → timeline (服务端已投影的行; role=user 由调用方过滤) */
export function messagesToTimeline(messages: AgentMessage[]): TimelineItem[] {
  const timeline: TimelineItem[] = []
  const toolIndexMap = new Map<string, number>()
  const pendingParentUpdates = new Map<string, Array<(children: SubTimelineItem[]) => void>>()

  const registerTool = (toolCallId: string, index: number) => {
    toolIndexMap.set(toolCallId, index)
    const pendingUpdates = pendingParentUpdates.get(toolCallId)
    if (!pendingUpdates?.length) return
    const parentItem = timeline[index]
    if (parentItem?.type !== 'tool') return
    if (!parentItem.children) {
      parentItem.children = []
    }
    for (const update of pendingUpdates) {
      update(parentItem.children)
    }
    pendingParentUpdates.delete(toolCallId)
  }

  const appendToParentChildren = (
    parentToolCallId: string,
    updater: (children: SubTimelineItem[]) => void,
  ) => {
    const parentIdx = toolIndexMap.get(parentToolCallId)
    if (parentIdx === undefined) {
      const pendingUpdates = pendingParentUpdates.get(parentToolCallId) ?? []
      pendingUpdates.push(updater)
      pendingParentUpdates.set(parentToolCallId, pendingUpdates)
      return
    }
    const parentItem = timeline[parentIdx]
    if (parentItem?.type !== 'tool') return
    if (!parentItem.children) {
      parentItem.children = []
    }
    updater(parentItem.children)
  }

  for (const msg of messages) {
    const reasoningDurationMs = validDuration(msg.reasoningDurationMs ?? undefined)
    if (msg.role === 'tool') {
      const { toolCallId, toolName } = requireToolMessageIdentity(msg)

      if (msg.parentToolCallId) {
        appendToParentChildren(msg.parentToolCallId, (children) => {
          if (msg.toolStatus === 'running') {
            if (typeof msg.content !== 'string') {
              throw new Error(`Persisted tool call ${toolCallId} has no arguments`)
            }
            const existingChild = children.find(
              (child) => child.type === 'tool' && child.id === toolCallId,
            )
            if (existingChild?.type === 'tool') {
              fillPersistedToolArguments(existingChild, toolCallId, toolName, msg.content, true)
              return
            }
            children.push({
              type: 'tool',
              id: toolCallId,
              name: toolName,
              arguments: msg.content,
              status: 'calling',
            })
            return
          }

          const existingChild = children.find(
            (child) => child.type === 'tool' && child.id === toolCallId,
          )
          if (existingChild && existingChild.type === 'tool') {
            if (existingChild.name !== toolName) {
              throw new Error(`Persisted child tool name changed: ${toolCallId}`)
            }
            existingChild.status = persistedToolTimelineStatus(msg.toolStatus)
            existingChild.result = normalizeToolResult(toolName, msg.content)
            return
          }
          children.push(createPersistedSettledTool(toolCallId, toolName, msg.toolStatus, msg.content, true) as SubTimelineItem)
        })
        continue
      }

      const existingIdx = toolIndexMap.get(toolCallId)
      if (msg.toolStatus === 'running') {
        if (typeof msg.content !== 'string') {
          throw new Error(`Persisted tool call ${toolCallId} has no arguments`)
        }
        if (existingIdx !== undefined) {
          const existingItem = timeline[existingIdx]
          if (existingItem?.type === 'tool') {
            fillPersistedToolArguments(existingItem, toolCallId, toolName, msg.content, false)
          }
          continue
        }
        const idx = timeline.length
        timeline.push({
          type: 'tool',
          id: toolCallId,
          name: toolName,
          arguments: msg.content,
          status: 'calling',
        })
        registerTool(toolCallId, idx)
        continue
      }

      if (existingIdx !== undefined) {
        const existingItem = timeline[existingIdx]
        if (existingItem?.type === 'tool') {
          if (existingItem.name !== toolName) {
            throw new Error(`Persisted tool name changed: ${toolCallId}`)
          }
          existingItem.status = persistedToolTimelineStatus(msg.toolStatus)
          existingItem.result = normalizeToolResult(toolName, msg.content)
        }
        continue
      }
      const idx = timeline.length
      timeline.push(createPersistedSettledTool(toolCallId, toolName, msg.toolStatus, msg.content, false))
      registerTool(toolCallId, idx)
      continue
    }

    if (msg.parentToolCallId) {
      appendToParentChildren(msg.parentToolCallId, (children) => {
        if (msg.reasoningContent) {
          pushReasoningToSubTimelineList(children, msg.reasoningContent, reasoningDurationMs)
        } else if (reasoningDurationMs !== undefined) {
          updateLastReasoningDurationInList(children, reasoningDurationMs)
        }
        if (msg.content) {
          if (reasoningDurationMs !== undefined) {
            updateLastReasoningDurationInList(children, reasoningDurationMs)
          }
          pushContentToSubTimelineList(children, msg.content)
        }
      })
      continue
    }

    if (msg.reasoningContent) {
      pushReasoningToTimeline(timeline, msg.reasoningContent, reasoningDurationMs)
    } else if (reasoningDurationMs !== undefined) {
      updateLastTimelineReasoningDuration(timeline, reasoningDurationMs)
    }

    if (msg.content) {
      if (reasoningDurationMs !== undefined) {
        updateLastTimelineReasoningDuration(timeline, reasoningDurationMs)
      }
      pushContentToTimeline(timeline, msg.content)
    }
  }

  return timeline
}

function pushReasoningToSubTimelineList(
  children: SubTimelineItem[],
  text: string,
  durationMs?: number,
): void {
  const last = children[children.length - 1]
  if (last && last.type === 'reasoning') {
    last.text += text
    if (durationMs !== undefined) {
      last.durationMs = durationMs
    }
    return
  }
  children.push({
    type: 'reasoning',
    text,
    ...(durationMs !== undefined ? { durationMs } : {}),
  })
}

function pushContentToSubTimelineList(children: SubTimelineItem[], text: string): void {
  const last = children[children.length - 1]
  if (last && last.type === 'content') {
    last.text = last.text.endsWith('\n\n')
      ? last.text + text
      : last.text.endsWith('\n')
        ? `${last.text}\n${text}`
        : `${last.text}\n\n${text}`
    return
  }
  children.push({ type: 'content', text })
}

/** 助手会话失败时取最后一条非用户消息作为错误文案 (旧 resolveHistoryErrorMessage) */
export function resolveHistoryErrorMessage(
  conversation: AgentConversation,
  messages: AgentMessage[],
): string | undefined {
  const isErrorConversation =
    conversation.status === 'error' || conversation.status === 'failed'
  if (!isErrorConversation) {
    return undefined
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const content = message?.content?.trim()
    if (!content || message?.role === 'user') {
      continue
    }
    return content
  }
  return '任务执行失败'
}

// ========== 消息合并 / 会话去重 (旧 assistant-runtime.ts) ==========

export function messageKey(message: AgentMessage): string {
  if (message.role === 'user' && message.messageOrder > 0) {
    return `user:${message.conversationId}:${message.messageOrder}:${message.content ?? ''}`
  }
  if (message.id > 0) return `id:${message.id}`
  if (message.runId && message.projectionKey) return `projection:${message.runId}:${message.projectionKey}`
  return [message.role, message.messageOrder, message.content ?? '', message.toolCallId ?? ''].join(':')
}

export function mergeMessages(current: AgentMessage[], incoming: AgentMessage[]): AgentMessage[] {
  const merged = new Map<string, AgentMessage>()
  for (const message of [...current, ...incoming]) merged.set(messageKey(message), message)
  return [...merged.values()].sort((a, b) => (a.messageOrder ?? 0) - (b.messageOrder ?? 0))
}

/** 历史消息 → timeline (过滤用户消息; 用户气泡由消息列表单独渲染) */
export function timelineForMessages(messages: AgentMessage[]): TimelineItem[] {
  return messagesToTimeline(messages.filter((message) => message.role !== 'user'))
}

export function uniqueConversations(
  current: AgentConversation[],
  incoming: AgentConversation[],
): AgentConversation[] {
  const byId = new Map(current.map((conversation) => [conversation.conversationId, conversation]))
  for (const conversation of incoming) byId.set(conversation.conversationId, conversation)
  return [...byId.values()].sort((a, b) => {
    const left = new Date(a.lastMessageTime ?? a.createTime ?? 0).getTime()
    const right = new Date(b.lastMessageTime ?? b.createTime ?? 0).getTime()
    return right - left
  })
}
