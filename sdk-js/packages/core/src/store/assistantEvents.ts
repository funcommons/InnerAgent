/**
 * [new] 助手事件外泄钩子 — 替代源实现对融光 '@/store/pipeline' 任务卡片 store 的
 * 直接依赖 (triggerToolInvalidation / usePipelineStore().triggerInvalidation)。
 *
 * SDK 默认 no-op; 宿主 (或 components 包) 可注入回调做联动刷新。
 * 可用于: 工具完成后刷新宿主页面数据、run 终态后同步宿主任务列表等。
 */

export interface AssistantEventHooks {
  /** 工具成功完成 (TOOL_FINISHED 且 toolStatus !== 'error') 时触发。 */
  onToolFinished?: (toolName: string) => void
  /** Run 到达根终态 (DONE/ERROR/CANCELLED) 时触发。 */
  onRunTerminal?: () => void
}

const noopHooks: AssistantEventHooks = {}

let hooks: AssistantEventHooks = noopHooks

/** 注入事件钩子; 传 undefined 重置为 no-op。 */
export function setAssistantEventHooks(next?: AssistantEventHooks): void {
  hooks = next ?? noopHooks
}

/** 内部: store 调用入口 (永不抛错, 钩子异常不影响助手链路)。 */
export const assistantEventHooks = {
  onToolFinished(toolName: string): void {
    try { hooks.onToolFinished?.(toolName) } catch { /* 钩子异常不阻断事件流 */ }
  },
  onRunTerminal(): void {
    try { hooks.onRunTerminal?.() } catch { /* 钩子异常不阻断事件流 */ }
  },
}
