/**
 * [adapt] 页面上下文注册表 — 源: $SRC/src/store/assistantPageContext.ts。
 *
 * 源语义 (1:1 保留): 页面可注册"当前正在编辑的对象"引用, 发送助手消息时
 * 汇总为 AiChatReq.autoReferences (type + id), 供后端做模板变量替换与上下文挂载。
 *
 * InnerAgent 契约扩展 (02-技术方案 §7.1: 请求体增 context{page,object}):
 * - setRunContext({page, object}) 注册结构化页面/对象上下文;
 * - sendMessage 时合并进请求体 context 字段 (store/assistant.ts)。
 */

export interface AssistantPageContextRef {
  type: string
  id: number
  /**
   * 实体展示名 (源队列 #41: 页面在数据加载后随注册回填)。
   * 供助手 @ 候选做名称优先展示/匹配; autoReferences 契约仍只消费 type + id。
   */
  name?: string
}

/** InnerAgent 契约: 请求体 context 的 page/object 结构化上下文 */
export interface AssistantRunContext {
  /** 当前页面标识 (如 'project-detail'、'home'), 由宿主自定义 */
  page?: unknown
  /** 当前业务对象 (如 {type:'script', id:7}), 由宿主自定义 */
  object?: unknown
}

let currentContext: AssistantPageContextRef[] = []
let currentRunContext: AssistantRunContext = {}

/** 页面注册/更新当前上下文引用 (通常在 onMounted/watch 中调用) */
export function setAssistantPageContext(refs: AssistantPageContextRef[]): void {
  currentContext = refs
}

/** 页面卸载时清理 */
export function clearAssistantPageContext(): void {
  currentContext = []
}

/** 读取当前页面上下文引用 (未注册时返回空数组) */
export function getAssistantPageContext(): AssistantPageContextRef[] {
  return currentContext
}

/** 注册请求体 context{page,object} (宿主经 SDK 实例调用) */
export function setRunContext(context: AssistantRunContext): void {
  currentRunContext = { ...context }
}

/** 清空请求体 context */
export function clearRunContext(): void {
  currentRunContext = {}
}

/** 读取当前请求体 context (未注册时返回 {}) */
export function getRunContext(): AssistantRunContext {
  return currentRunContext
}
