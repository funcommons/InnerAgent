/**
 * [adapt] 展示名配置 — 源: $SRC/src/components/layout/notificationTaskDisplay.ts
 * (toolDisplayNames / subAgentToolNames)。
 *
 * 拆除业务依赖: 融光的业务工具显示名表 (get_project/save_script_episode/...)
 * 不作为 SDK 默认值携带 —— SDK 默认:
 * - 工具显示名 = 原始 toolName (宿主可用 setAssistantToolDisplayNames 注入本地化表)
 * - 子 Agent 工具名单 = 空集 (历史回放时子 Agent 结果的 JSON 解包关闭;
 *   宿主可用 setSubAgentToolNames 注入)
 * 事件协议层 (parentToolCallId) 不依赖该名单, 此名单仅影响展示。
 */

let toolDisplayNamesMap: Record<string, string> = {}
let subAgentToolNameList: string[] = []

/** 注入工具显示名表 (toolName → 展示名)。传 undefined 重置为原样展示。 */
export function setAssistantToolDisplayNames(map?: Record<string, string>): void {
  toolDisplayNamesMap = map ? { ...map } : {}
}

/** 读取工具显示名 (未注入时原样返回 toolName)。 */
export function getToolDisplayName(toolName: string): string {
  return toolDisplayNamesMap[toolName] ?? toolName
}

/** 注入子 Agent 工具名单 (影响历史回放时子 Agent 结果 JSON 的 result/error 解包)。 */
export function setSubAgentToolNames(names?: string[]): void {
  subAgentToolNameList = names ? [...names] : []
}

/** 读取子 Agent 工具名单。 */
export function subAgentToolNames(): string[] {
  return subAgentToolNameList
}

/** 测试隔离用: 清空全部展示配置 */
export function resetAssistantDisplayConfig(): void {
  toolDisplayNamesMap = {}
  subAgentToolNameList = []
}
