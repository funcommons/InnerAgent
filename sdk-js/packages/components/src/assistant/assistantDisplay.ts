/**
 * [adapt] assistantDisplay — 源: $SRC/src/components/assistant/assistantDisplay.ts。
 * 会话导航/消息列表展示纯逻辑 1:1; import 重锚到 @inneragent/sdk-core。
 */
/**
 * 融光助手展示纯逻辑 (会话导航 / 消息列表).
 *
 * 来源对照 (旧 ai-fusion-video-web/components/dashboard/assistant):
 * - conversation-navigation.tsx → relativeTime/statusLabel (文案改走 i18n key)
 * - message-list.tsx → buildSegments (用户气泡 + 助手 timeline 分段;
 *   活动 run 的已投影行由 live reducer 渲染, 历史不再重复渲染)
 * - assistant-runtime.ts → statusIsRunning 复用 store/assistantTimeline
 */
import type { AgentMessage, TimelineItem } from '@inneragent/sdk-core'
import { statusIsRunning } from '@inneragent/sdk-core'
import type { AssistantMessageAttachmentView } from './assistantMessageAttachments'

/** 会话行状态 → i18n key (旧 statusLabel) */
export function conversationStatusKey(status?: string): string {
  if (status === 'CANCEL_REQUESTED') return 'assistant.status-cancelling'
  if (status === 'WAITING_CONFIRMATION') return 'assistant.status-waiting-confirm'
  if (status === 'WAITING_EXTERNAL') return 'assistant.status-waiting-external'
  if (statusIsRunning(status)) return 'assistant.status-running'
  if (status === 'failed' || status === 'error') return 'assistant.status-failed'
  if (status === 'cancelled') return 'assistant.status-cancelled'
  return 'assistant.status-completed'
}

/** 会话行状态图标语义 */
export type ConversationStatusTone =
  | 'running' | 'waiting' | 'failed' | 'cancelled' | 'unread' | 'done'

export function conversationStatusTone(status: string | undefined, unread: boolean): ConversationStatusTone {
  if (status === 'CANCEL_REQUESTED') return 'running'
  if (status === 'WAITING_CONFIRMATION' || status === 'WAITING_EXTERNAL') return 'waiting'
  if (statusIsRunning(status)) return 'running'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (unread) return 'unread'
  return 'done'
}

/** 相对时间 → i18n 参数 (旧 relativeTime; 文案 i18n 化) */
export function relativeTimeParts(value: string | undefined, now = Date.now()): { key: string; n?: number } {
  if (!value) return { key: 'assistant.time-now' }
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return { key: 'assistant.time-now' }
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return { key: 'assistant.time-now' }
  if (seconds < 3600) return { key: 'assistant.time-minutes-ago', n: Math.floor(seconds / 60) }
  if (seconds < 86400) return { key: 'assistant.time-hours-ago', n: Math.floor(seconds / 3600) }
  if (seconds < 604800) return { key: 'assistant.time-days-ago', n: Math.floor(seconds / 86400) }
  return { key: 'assistant.time-days-ago', n: Math.floor(seconds / 86400) }
}

export interface MessageSegment {
  key: string
  user?: AgentMessage
  assistant: AgentMessage[]
}

/** 用户消息与助手投影分段; 活动 run 的行交给 live timeline 渲染 */
export function buildSegments(messages: AgentMessage[], activeRunId?: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let current: MessageSegment = { key: 'prelude', assistant: [] }

  const pushCurrent = () => {
    if (current.user || current.assistant.length > 0) segments.push(current)
  }

  for (const message of messages) {
    if (message.role === 'user') {
      pushCurrent()
      current = {
        key: `segment-${message.id}-${message.messageOrder}`,
        user: message,
        assistant: [],
      }
      continue
    }
    // The live reducer is the authoritative view of the selected active run.
    // Do not render its projected rows a second time from the history API.
    if (activeRunId && message.runId === activeRunId) continue
    current.assistant.push(message)
  }
  pushCurrent()
  return segments
}

export interface RenderableMessageSegment extends MessageSegment {
  timeline: TimelineItem[]
  /** [P2 #14] 用户消息附件视图(image 缩略图 / file 文件卡, 消息区渲染输入) */
  attachments?: AssistantMessageAttachmentView[]
}

/** 批量确认条上已勾选数量/统一决定 (旧 tool-confirmation-batch-bar 内部逻辑) */
export function selectedBatchDecision(
  toolCallIds: string[],
  decisions: Readonly<Record<string, boolean>>,
): boolean | undefined {
  if (toolCallIds.some((toolCallId) =>
    !Object.prototype.hasOwnProperty.call(decisions, toolCallId))) {
    return undefined
  }
  const firstDecision = decisions[toolCallIds[0] ?? '']
  return toolCallIds.every((toolCallId) => decisions[toolCallId] === firstDecision)
    ? firstDecision
    : undefined
}
