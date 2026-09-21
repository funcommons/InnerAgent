/**
 * iframe 模式接入辅助(P4/W15 postMessage 桥;接入指南对应原 §3.3.4 演示位)。
 *
 * 纯函数面(便于单测):被 {@code EmbedChat.vue} 调用,产出
 * {@code createIframeEmbed}(public/ia/iframe-host.js)所需的 options。
 *
 * 安全红线(见 InnerAgent examples/iframe-host/README.md):
 * - token 不入 URL:src 只给被嵌页地址;SDK 对 token 形 query 参数直接抛错;
 * - token 唯一合法通道是握手后的 postMessage 消息桥(tokenGetter 下发);
 * - 双侧 origin allowlist,发送必带显式 targetOrigin(永不 '*')。
 */

import type { IFrameEmbedOptions } from '@/ia/sdkLoader'

export const IA_FRAME_PATH = '/ia/frame.html'

/**
 * 归一被嵌页地址:相对路径按当前 origin 解析(createIframeEmbed 需要绝对
 * origin 做 allowlist 缺省)。
 */
export function resolveFrameSrc(framePath = IA_FRAME_PATH, origin = window.location.origin): string {
  if (!framePath) throw new Error('frame src 不能为空')
  if (/^https?:\/\//i.test(framePath)) return framePath
  const normalized = framePath.startsWith('/') ? framePath : `/${framePath}`
  return `${origin.replace(/\/$/, '')}${normalized}`
}

/** 组装宿主侧 embed handle 的 options(tokenGetter 由调用方注入,本函数不触网)。 */
export function buildIframeEmbedOptions(params: {
  framePath?: string
  origin?: string
  appKey: string
  agentType?: string
  tokenGetter: () => Promise<string | null>
  container: HTMLElement
  onEvent?: IFrameEmbedOptions['onEvent']
}): IFrameEmbedOptions {
  const src = resolveFrameSrc(params.framePath ?? IA_FRAME_PATH, params.origin)
  assertNoTokenInSrc(src)
  const options: IFrameEmbedOptions = {
    src,
    appKey: params.appKey,
    agentType: params.agentType,
    tokenGetter: params.tokenGetter,
    container: params.container,
    iframeAttrs: {
      // 同源服务时 allow-same-origin 是最低集(child 为第一方 SDK 代码);
      // 生产建议显式 sandbox 并按部署域配 allowedOrigins
      allow: 'clipboard-write',
    },
    onEvent: params.onEvent,
  }
  return options
}

/**
 * token 不入 URL 的本地防线:createIframeEmbed 自身会抛错,这里提前拦截并
 * 给出可读信息(测试断言错误卡路径)。
 */
export function assertNoTokenInSrc(src: string): void {
  if (/(^|&|\?)(access[-_]?token|token)=/i.test(src)) {
    throw new Error('iframe src 不得携带 token(query 参数泄漏面大):token 只经 postMessage 消息桥下发')
  }
}

/** 事件 → 演示日志行(EmbedChat 页握手/事件日志复用)。 */
export function describeEmbedEvent(event: { kind: string; status?: string; message?: string; toolName?: string }): string {
  return [
    event.kind,
    event.status,
    event.toolName,
    event.message,
  ]
    .filter((part): part is string => !!part)
    .join(':')
}
