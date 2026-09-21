/**
 * [new] SDK 运行时配置 — 契约入口 `init({ appKey, tokenGetter, theme?, mode? })`。
 *
 * 依据 02-技术方案 §8.1 / 任务 P1-T3a 契约:
 * - mode: 'wc' (默认, 本页直接挂 WC) | 'iframe' (P4/W15 起)。
 *   mode 'iframe' 是**宿主侧声明** (API 调用发生在被嵌 iframe 内的 WC,
 *   token 经 postMessage 桥传入, 不落 URL); 实际桥接由 @inneragent/sdk-iframe
 *   的 `createIframeEmbed({ src, tokenGetter, ... })` 承载 —— 该处的 tokenGetter
 *   选项是桥的 token 通道唯一来源, init 的 tokenGetter 在 iframe 模式下仅为
 *   契约完整性保留 (普通 'wc' 模式仍是 API 层 token 来源)。
 * - tokenGetter: 宿主回调, 返回 Promise<string|null> (embed token);
 *   SDK 注入 `Authorization: Bearer <token>`, 收到 401 时**再次调用** tokenGetter
 *   (过期懒换, 单飞并发合并) 并重试一次。
 * - baseURL 默认 '/ia/api/v1', 可配置。
 * - theme: CSS 变量主题令牌 (--ia-primary 等, 02-技术方案 §8.1 12 令牌)。
 */

/** 主题令牌名 (--ia-* 12 个, 值为任意 CSS 颜色/尺寸) */
export const IA_THEME_TOKENS = [
  '--ia-primary',
  '--ia-primary-contrast',
  '--ia-bg',
  '--ia-bg-card',
  '--ia-bg-muted',
  '--ia-text',
  '--ia-text-secondary',
  '--ia-text-tertiary',
  '--ia-separator',
  '--ia-danger',
  '--ia-warning',
  '--ia-success',
] as const

export type IaThemeTokens = Partial<Record<(typeof IA_THEME_TOKENS)[number], string>>

export type TokenGetter = () => Promise<string | null>

export type SdkMode = 'wc' | 'iframe'

export interface SdkInitOptions {
  /** 宿主应用标识 (app 级隔离 + 本地持久化命名空间)。 */
  appKey: string
  /** 宿主 embed token 回调; SDK 每次请求前/401 重试时调用 (过期懒换)。 */
  tokenGetter: TokenGetter
  /** API 基础路径, 默认 '/ia/api/v1'。 */
  baseURL?: string
  /** 主题令牌 (--ia-*), init 时写入 document root。 */
  theme?: IaThemeTokens
  /** 接入模式: 'wc' (默认) | 'iframe' (P4/W15 占位)。 */
  mode?: SdkMode
  /** 助手对话使用的 Agent 类型 (默认沿用融光 'ai_media', 宿主可覆盖)。 */
  agentType?: string
  /** 页面标题命名空间外的本地存储前缀覆盖 (测试/多实例隔离用)。 */
  storagePrefix?: string
}

export interface SdkRuntimeConfig {
  appKey: string
  baseURL: string
  mode: SdkMode
  agentType: string
  storagePrefix: string
  tokenGetter: TokenGetter
}

const DEFAULT_BASE_URL = '/ia/api/v1'
const DEFAULT_AGENT_TYPE = 'ai_media'
const DEFAULT_STORAGE_PREFIX = 'inneragent-assistant'

let runtime: SdkRuntimeConfig | null = null

/** 写入运行时配置; 重复 init 覆盖前值 (宿主热更新语义)。 */
export function init(options: SdkInitOptions): SdkRuntimeConfig {
  if (!options.appKey || !options.appKey.trim()) {
    throw new Error('@inneragent/sdk init: appKey is required')
  }
  if (typeof options.tokenGetter !== 'function') {
    throw new Error('@inneragent/sdk init: tokenGetter is required')
  }
  runtime = {
    appKey: options.appKey,
    baseURL: (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    mode: options.mode ?? 'wc',
    agentType: options.agentType ?? DEFAULT_AGENT_TYPE,
    storagePrefix: options.storagePrefix ?? DEFAULT_STORAGE_PREFIX,
    tokenGetter: options.tokenGetter,
  }
  if (options.theme) applyTheme(options.theme)
  return runtime
}

/** 测试/卸载用: 清空运行时配置。 */
export function resetSdkConfig(): void {
  runtime = null
}

export function getSdkConfig(): SdkRuntimeConfig {
  if (!runtime) {
    throw new Error('@inneragent/sdk is not initialized; call init({ appKey, tokenGetter }) first')
  }
  return runtime
}

/** 未初始化时给只读调用方一个兜底 baseURL (避免硬崩); 正式链路仍要求先 init。 */
export function getBaseURL(): string {
  return runtime?.baseURL ?? DEFAULT_BASE_URL
}

/** 主题令牌 → document root CSS 变量 (WC 内部再把 --ia-* 映射到组件消费的 --app-*)。 */
export function applyTheme(theme: IaThemeTokens): void {
  if (typeof document === 'undefined') return
  for (const token of IA_THEME_TOKENS) {
    const value = theme[token]
    if (value) document.documentElement.style.setProperty(token, value)
  }
}
