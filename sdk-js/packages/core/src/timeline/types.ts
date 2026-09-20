/**
 * [port] Timeline 类型 — 自 $SRC/src/store/pipeline.ts「Timeline 类型」段 1:1 复制
 * (SDK 不移植 pipeline 任务卡片 store, 仅取其纯类型; 语义见源文件)。
 */

export type ToolTimelineStatus =
  | 'preparing'
  | 'calling'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'done'
  | 'error'
  | 'cancelled'

export type SubTimelineItem =
  | {
      type: 'tool'
      id: string
      name: string
      arguments: string
      batchId?: string
      status: ToolTimelineStatus
      result?: string | null
      plan?: import('../runs').PendingToolCallPlan
    }
  | { type: 'content'; text: string }
  | {
      type: 'reasoning'
      text: string
      startedAtMs?: number
      durationMs?: number
    }

export type TimelineItem =
  | {
      type: 'tool'
      id: string
      name: string
      arguments: string
      batchId?: string
      status: ToolTimelineStatus
      result?: string | null
      agentName?: string
      children?: SubTimelineItem[]
      plan?: import('../runs').PendingToolCallPlan
    }
  | {
      type: 'reasoning'
      text: string
      startedAtMs?: number
      durationMs?: number
    }
  | { type: 'content'; text: string }
