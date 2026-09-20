/**
 * [new] P2-scope 任务 #15:约束范围(CONSTRAINT SCOPE)解析与提取。
 *
 * 契约(PRD §6.1.4「InnerAgent 传递与呈现 scope」+ 03-开发计划 P1 验收 6
 * 「SCOPE_RESOLVED 事件到达前端」):
 * - 服务端在确认等待事件(USER_CONFIRMATION_REQUIRED)的 pendingToolCalls 每项
 *   附可选 `scope: {resolved, degraded, summary?}`(wire 定义见 runs.ts ToolCallScope);
 * - 本模块是消费侧唯一入口:旧事件(无 scope 字段)必须兼容 —— 归一化为
 *   degraded(fail-closed)+ UI 弱提示,不视为协议错误;
 * - SCOPE_RESOLVED 是前端 CustomEvent 名(components 包 WC 根 dispatch),
 *   不是 SSE 事件名(事件协议稳定性优先,不新增 SSE 事件类型)。
 */
import type { PendingToolCallInfo, ToolCallScope } from './runs'

/** 归一化结果:resolved/degraded 恒有值,summary 仅在服务端提供时存在。 */
export type NormalizedToolCallScope = Required<
  Pick<ToolCallScope, 'resolved' | 'degraded'>
> & { summary?: string }

/** degraded 缺省形态(安全侧:旧事件 / 畸形字段 / 服务端缺省)。 */
export const DEGRADED_SCOPE: NormalizedToolCallScope = Object.freeze({
  resolved: false,
  degraded: true,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 归一化单个待确认工具的 scope。
 *
 * - `undefined`(旧事件)/类型畸形 → 按 degraded 处理(PRD §6.1.4 降级语义:
 *   无上下文提示 + 写操作一律确认;UI 呈现为弱提示,不阻塞确认流);
 * - 服务端 v1 不变式为 `degraded == !resolved`;凡 degraded===true、
 *   或 resolved/degraded 缺失非布尔、或矛盾形态(degraded=false 但 resolved=false)
 *   一律按 degraded(fail-closed);
 * - summary 仅在非空字符串时保留。
 */
export function normalizeToolCallScope(scope?: ToolCallScope): NormalizedToolCallScope {
  if (!isRecord(scope)) return { ...DEGRADED_SCOPE }
  const summary = typeof scope.summary === 'string' && scope.summary.trim()
    ? scope.summary
    : undefined
  const withSummary = (base: NormalizedToolCallScope): NormalizedToolCallScope =>
    summary ? { ...base, summary } : base
  if (scope.degraded !== false) {
    return withSummary({ resolved: false, degraded: true })
  }
  if (scope.resolved === true) {
    return withSummary({ resolved: true, degraded: false })
  }
  // 矛盾形态:degraded=false 但 resolved=false → 按 degraded(安全侧)
  return withSummary({ resolved: false, degraded: true })
}

/**
 * 提取一批待确认工具的约束范围摘要(确认条渲染输入):
 * 任一工具按 degraded 处理 → 整批按 degraded(fail-closed);全批 resolved
 * 才呈现 resolved 态(summary 可缺省 —— 服务端 resolved 形态允许省略);
 * summary 取首个非空摘要,degraded 摘要优先(当前平台 scope 为 run 级,批内一致)。
 * 空批次(无工具)按 degraded 缺省,避免渲染未经验证的 resolved 态。
 */
export function pendingScopeDigest(
  toolCalls?: PendingToolCallInfo[],
): NormalizedToolCallScope {
  let degraded = false
  let degradedSummary: string | undefined
  let resolvedSummary: string | undefined
  let count = 0
  for (const toolCall of toolCalls ?? []) {
    count++
    const scope = normalizeToolCallScope(toolCall?.scope)
    if (scope.degraded) {
      degraded = true
      degradedSummary = degradedSummary ?? scope.summary
    } else {
      resolvedSummary = resolvedSummary ?? scope.summary
    }
  }
  const summary = degradedSummary ?? resolvedSummary
  if (count === 0 || degraded) {
    return summary
      ? { resolved: false, degraded: true, summary }
      : { ...DEGRADED_SCOPE }
  }
  return summary
    ? { resolved: true, degraded: false, summary }
    : { resolved: true, degraded: false }
}
