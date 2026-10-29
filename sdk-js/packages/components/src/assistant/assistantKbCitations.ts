/**
 * [new] P4-W14 mini KB 引用溯源 — assistant 消息「引用资料」视图纯逻辑。
 *
 * 契约 (PRD M5「回答须可溯源, 展示来源」; 服务端 AgentRunQueryService §kbCitations):
 * - 到达形态 KbCitationVO{chunkId,documentId,documentTitle,anchor,seq} —— content
 *   仅存在于服务端 KbHit, 不上网; 前端如收到 content 仅作条目 title 属性 tooltip
 *   截断保留 (≤120 字符), 不进正文;
 * - 引用只经 live SSE 根终态 DONE 到达 (GET /conversations/{id}/messages 无引用列,
 *   历史回放消息不带), 终态重拉 mergeMessages 以 incoming 覆盖 current → 渲染时
 *   消息自带优先, 否则回退 pipeline state 捕获 (segmentKbCitations);
 * - 畸形 / 半缺输入一律安全回退: 非数组 / 非对象项 / 无 documentTitle 项跳过,
 *   缺省段 (anchor/seq/content) 省略, 渲染不崩。
 */
import type { AgentMessage } from '@inneragent/sdk-core'

export interface AssistantKbCitationView {
  chunkId?: number
  documentId?: number
  documentTitle: string
  anchor?: string
  seq?: number
  /** 服务端 KbHit content 的截断保留 (不进正文, 仅 tooltip) */
  content?: string
}

/** content tooltip 截断上限 (字符) */
const CONTENT_PREVIEW_LIMIT = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function citationView(raw: unknown): AssistantKbCitationView | undefined {
  if (!isRecord(raw)) return undefined
  const documentTitle = typeof raw.documentTitle === 'string' && raw.documentTitle.trim()
    ? raw.documentTitle
    : ''
  // 无 title 项跳过 (title 优先; 无法落锚的引用不渲染)
  if (!documentTitle) return undefined
  const chunkId = finiteNumber(raw.chunkId)
  const documentId = finiteNumber(raw.documentId)
  const anchor = typeof raw.anchor === 'string' && raw.anchor.trim() ? raw.anchor : undefined
  const seq = finiteNumber(raw.seq)
  const content = typeof raw.content === 'string' && raw.content.trim()
    ? raw.content.slice(0, CONTENT_PREVIEW_LIMIT)
    : undefined
  return {
    documentTitle,
    ...(chunkId !== undefined ? { chunkId } : {}),
    ...(documentId !== undefined ? { documentId } : {}),
    ...(anchor ? { anchor } : {}),
    ...(seq !== undefined ? { seq } : {}),
    ...(content ? { content } : {}),
  }
}

function kbCitationViews(raw: unknown): AssistantKbCitationView[] {
  if (!Array.isArray(raw)) return []
  const views: AssistantKbCitationView[] = []
  for (const item of raw) {
    const view = citationView(item)
    if (view) views.push(view)
  }
  return views
}

/** 解析 assistant 消息关联的引用视图 (live 到达与终态回退共用同一入口)。 */
export function messageKbCitations(message: AgentMessage | undefined): AssistantKbCitationView[] {
  return kbCitationViews(message?.kbCitations)
}

/**
 * 分段引用视图 (渲染入口): 分段内消息自带优先 (从末条向前取), 否则回退 pipeline
 * state 捕获 —— 仅挂在传入分段 (调用方只对「当前最新 assistant 消息」所在末段
 * 传入), 避免 merge 重拉冲掉瞬时引用后引用区消失。
 */
export function segmentKbCitations(
  assistantMessages: AgentMessage[],
  pipelineCitations?: unknown,
): AssistantKbCitationView[] {
  for (let index = assistantMessages.length - 1; index >= 0; index--) {
    const views = messageKbCitations(assistantMessages[index])
    if (views.length > 0) return views
  }
  return kbCitationViews(pipelineCitations)
}
