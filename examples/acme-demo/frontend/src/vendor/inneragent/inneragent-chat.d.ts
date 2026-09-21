/**
 * <inneragent-chat> SDK 产物类型声明 — 对应同目录 inneragent-chat.js (vendor 产物)。
 *
 * 契约来源: InnerAgent sdk-js/packages/components/src/inneragent-chat.ts 与
 * packages/core/src/{config,pageContext}.ts。产物为 WC 单文件 bundle,
 * bare specifier 外置 vue/pinia —— 由宿主(本 DEMO 前端)的 node_modules
 * 解析为同一 Vue/Pinia 实例, 不会双框架。
 *
 * 升级方式: 在 InnerAgent 仓库 `cd sdk-js && pnpm build`, 用新 dist 覆盖本目录
 * inneragent-chat.js 并同步本声明。
 */

/** 宿主 embed token 回调; SDK 每次请求前/401 重试时调用 (过期懒换)。返回 null = 无 token。 */
export type TokenGetter = () => Promise<string | null>

/** 主题令牌名 (--ia-*), 值为任意 CSS 颜色/尺寸 */
export type IaThemeTokens = Partial<Record<string, string>>

export interface SdkInitOptions {
  /** 宿主应用标识 (与管理面注册的 appKey 一致; 本地持久化命名空间) */
  appKey: string
  tokenGetter: TokenGetter
  /** API 基础路径, 默认 '/ia/api/v1' */
  baseURL?: string
  theme?: IaThemeTokens
  /** 'wc' (默认) | 'iframe' (本 DEMO 的 iframe 模式走 public/ia/iframe-host.js, 不经 init) */
  mode?: 'wc' | 'iframe'
  /** 对话使用的 Agent 类型 (随 POST /runs 请求体发送) */
  agentType?: string
  storagePrefix?: string
}

/** SDK 请求体 context{page,object} 结构化上下文 */
export interface AssistantRunContext {
  /** 当前页面标识, 由宿主自定义 */
  page?: unknown
  /** 当前业务对象 (如 {type:'ticket', id:'T-1001'}), 由宿主自定义 */
  object?: unknown
}

/** SDK autoReferences/@ 候选的页面上下文引用 */
export interface AssistantPageContextRef {
  type: string
  id: number | string
  name?: string
}

export type IaLocale = 'zh-CN' | 'en-US'

/** 初始化 SDK 运行时配置 (重复 init 覆盖前值) */
export function init(options: SdkInitOptions): unknown
/** 注册 <inneragent-chat> 自定义元素 (幂等; 非 browser 环境抛错) */
export function registerInnerAgentChat(tagName?: string): void
/** 清空 SDK 运行时配置 (测试/卸载用) */
export function resetSdkConfig(): void
/** 注册请求体 context{page,object} (setPage/setObject 上下文) */
export function setRunContext(context: AssistantRunContext): void
export function clearRunContext(): void
/** 注册页面上下文引用 (autoReferences / @ 候选) */
export function setAssistantPageContext(refs: AssistantPageContextRef[]): void
export function clearAssistantPageContext(): void
/** 切换 SDK 内置文案语言 */
export function setIaLocale(locale: IaLocale): void
/** 主题令牌 → document root CSS 变量 */
export function applyTheme(theme: IaThemeTokens): void
export const IA_THEME_TOKENS: readonly string[]
export class IframeModeNotImplementedError extends Error {}
export const InnerAgentChatElement: unknown
export const InnerAgentChatComponent: unknown
export function setAssistantToolDisplayNames(names: Record<string, string>): void
export function setSubAgentToolNames(names: string[]): void
export function setAssistantEventHooks(hooks: unknown): void
export function setAssistantReferenceProjectsProvider(provider: unknown): void
export function resetAssistantReferenceCaches(): void
