/**
 * @inneragent/sdk-iframe 宿主侧产物类型声明 — 对应同目录 iframe-host.js(vendor 产物)。
 * 契约来源: InnerAgent sdk-js/packages/iframe(P4/W15 postMessage 桥)。
 * 产物自包含(无 bare import / 运行时依赖),postMessage 协议消息表见
 * examples/iframe-host/README.md。
 */

export interface IframeEmbedEvent {
  kind: 'status' | 'error' | 'run-terminal' | 'tool-finished'
  status?: string
  message?: string
  toolName?: string
}

export interface CreateIframeEmbedOptions {
  /** 被嵌页地址;不得携带 token 形 query(违者抛错) */
  src: string
  appKey: string
  agentType?: string
  baseURL?: string
  locale?: string
  theme?: Record<string, string>
  /** token 唯一合法通道:握手后的 postMessage 消息桥 */
  tokenGetter: () => Promise<string | null>
  container: HTMLElement
  /** 宿主来源 allowlist;缺省 new URL(src).origin */
  allowedOrigins?: string[]
  iframeAttrs?: Record<string, unknown>
  onEvent?: (event: IframeEmbedEvent) => void
}

export interface IframeEmbedHandle {
  ready: Promise<void>
  setPage: (page: { name?: string; title?: string } | Record<string, unknown>) => void
  setObject: (object: { type: string; id: number | string; name?: string }) => void
  clearContext: () => void
  refreshToken: () => Promise<void>
  destroy: () => void
}

export function createIframeEmbed(options: CreateIframeEmbedOptions): IframeEmbedHandle
