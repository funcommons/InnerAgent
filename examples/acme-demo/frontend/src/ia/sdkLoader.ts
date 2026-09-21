/**
 * SDK 产物加载器(动态 import 包装;独立成模块以便测试 mock):
 *
 * - loadInnerAgentSdk(): 懒加载 vendor 产物(仅 WC 模式进入;默认构建零引入,
 *   单独成 chunk);
 * - loadIframeEmbed(): 加载 public/ia/iframe-host.js(postMessage 桥宿主侧,
 *   自包含产物,放 public 由浏览器直取,不经 Vite 预打包)。
 */

export type InnerAgentSdkModule = typeof import('@/vendor/inneragent/inneragent-chat.js')

export interface IFrameEmbedHandle {
  ready: Promise<void>
  setPage: (page: { name?: string; title?: string } | Record<string, unknown>) => void
  setObject: (object: { type: string; id: number | string; name?: string }) => void
  clearContext: () => void
  refreshToken: () => Promise<void>
  destroy: () => void
}

export interface IFrameEmbedOptions {
  src: string
  appKey: string
  agentType?: string
  tokenGetter: () => Promise<string | null>
  container: HTMLElement
  allowedOrigins?: string[]
  iframeAttrs?: Record<string, unknown>
  onEvent?: (event: { kind: string; status?: string; message?: string; toolName?: string }) => void
}

interface IFrameHostModule {
  createIframeEmbed(options: IFrameEmbedOptions): IFrameEmbedHandle
}

export async function loadInnerAgentSdk(): Promise<InnerAgentSdkModule> {
  return import('@/vendor/inneragent/inneragent-chat.js')
}

export async function loadIframeEmbed(): Promise<IFrameHostModule> {
  return import('@/vendor/inneragent/iframe-host.js')
}
