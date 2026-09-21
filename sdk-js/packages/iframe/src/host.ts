/**
 * [new] iframe 桥 — 宿主侧 (P4/W15)。
 *
 * `createIframeEmbed({ src, appKey, tokenGetter, ... })`:
 * - 创建被嵌 iframe (src 由宿主给出, **token 禁止出现在 src 中** —— 含
 *   token 形 query 参数的 src 直接抛错, 从 API 层守住「token 不入 URL」);
 * - 与 iframe 内的 SDK child 完成握手 (hello → ready, nonce+ack 防混淆);
 * - 按需供给 embed token (child 的 token-request / 宿主主动 refreshToken);
 *   token 只经本桥的 `token` 消息进入 iframe (显式 targetOrigin, allowlist);
 * - setPage/setObject 上下文同步; child 事件外发 (onEvent)。
 *
 * init({ mode: 'iframe' }) 是可选的宿主侧声明 (见 core/config.ts);
 * 本桥的 tokenGetter 选项是 token 通道唯一来源, 不读全局配置。
 */
import {
  createMessage,
  isBridgeEnvelope,
  IA_BRIDGE_VERSION,
  type BridgeContextPayload,
  type BridgeEnvelope,
  type BridgeEventPayload,
  type BridgeReadyPayload,
  type BridgeThemePayload,
  type BridgeTokenPayload,
  type BridgeTokenRequestPayload,
} from './protocol'
import { windowTransport, type BridgeTransport } from './transport'

/** token 形 query 参数名 (src 出现即拒绝 —— token 不入 URL 的 API 层防线) */
const TOKEN_PARAM_PATTERN = /(^|_)(token|access[-_]?token|refresh[-_]?token|id[-_]?token|jwt|api[-_]?key|secret|authorization|credential)(_|$)/i

export interface IframeEmbedOptions {
  /** 被嵌页地址 (token 禁止出现在 URL 任何位置) */
  src: string
  /** 宿主应用标识 (经 ready 消息下发 child 端 init) */
  appKey: string
  /**
   * embed token 回调 —— token 通道唯一来源。child 每次请求 (初次/401 失效后)
   * 都会调用它, 语义与 wc 模式的过期懒换一致。
   */
  tokenGetter: () => Promise<string | null>
  /** 允许的 iframe 来源 allowlist; 缺省 [new URL(src).origin] */
  allowedOrigins?: string[]
  /** iframe 挂载容器, 缺省 document.body (注入 transport 时不创建 iframe) */
  container?: HTMLElement
  /** 透传到 iframe 元素上的属性 (sandbox/title/allow/style 等) */
  iframeAttrs?: Record<string, string>
  /** child 引导配置透传 (经 ready 消息) */
  agentType?: string
  baseURL?: string
  locale?: 'zh-CN' | 'en-US'
  theme?: Record<string, string>
  /** 握手超时 (ms, 缺省 15000); 超时 ready reject */
  handshakeTimeoutMs?: number
  /** 单条消息 ack 等待 (ms, 缺省 5000), 超时重发一次 */
  ackTimeoutMs?: number
  /** child 事件外发 (状态/错误/运行终态/工具完成) */
  onEvent?: (event: BridgeEventPayload, meta: { origin: string }) => void
  /** 注入自定义通道 (测试/非 iframe 复用); 缺省 iframe.contentWindow + window */
  transport?: BridgeTransport
  /** 注入 iframe 元素工厂 (测试); 缺省 document.createElement('iframe') */
  createElement?: () => HTMLIFrameElement
}

export interface IframeEmbed {
  readonly iframe: HTMLIFrameElement | null
  /** 握手完成 (首个合法 hello 已应答); 超时/destroy 时 reject */
  readonly ready: Promise<void>
  /** 锁定的对端 origin (发送 targetOrigin 与入站校验都基于它) */
  readonly handshakeOrigin: string
  /** 因来源不符被丢弃的消息计数 (诊断/测试) */
  readonly rejectedMessageCount: number
  /** 页面上下文同步 (经消息桥, 对应 child 端 setRunContext) */
  setPage(page: unknown): void
  setObject(object: unknown): void
  clearContext(): void
  /** 主题令牌同步 (child 端 applyTheme) */
  setTheme(tokens: Record<string, string>): void
  /** 宿主主动重取 token 并推送 (embed token 续签; 401 懒换的宿主侧入口) */
  refreshToken(): Promise<void>
  destroy(): void
}

/** 解析 src (相对地址按当前页解析); 拒绝 token 形 query 参数 */
function resolveSrc(src: string): URL {
  let url: URL
  try {
    url = new URL(src, typeof location !== 'undefined' ? location.href : 'https://localhost/')
  } catch {
    throw new Error(`inneragent iframe embed: invalid src "${src}"`)
  }
  for (const name of url.searchParams.keys()) {
    if (TOKEN_PARAM_PATTERN.test(name)) {
      throw new Error(
        `inneragent iframe embed: src query 参数 "${name}" 疑似携带凭证 — token 不入 URL ` +
        '(02-技术方案 §7.3); token 经 postMessage 桥 (tokenGetter) 传递',
      )
    }
  }
  return url
}

export function createIframeEmbed(options: IframeEmbedOptions): IframeEmbed {
  if (!options.src) throw new Error('inneragent iframe embed: src is required')
  if (!options.appKey) throw new Error('inneragent iframe embed: appKey is required')
  if (typeof options.tokenGetter !== 'function') {
    throw new Error('inneragent iframe embed: tokenGetter is required')
  }

  const srcUrl = resolveSrc(options.src)
  const childOrigin = srcUrl.origin
  const allowedOrigins = new Set(options.allowedOrigins ?? [childOrigin])
  if (!allowedOrigins.has(childOrigin)) {
    throw new Error(`inneragent iframe embed: child origin ${childOrigin} 不在 allowedOrigins 内`)
  }

  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 15_000
  const ackTimeoutMs = options.ackTimeoutMs ?? 5_000
  const onEvent = options.onEvent

  // ---- 通道: 注入 transport (headless/测试) 或真实 iframe 窗口对 ----
  let iframe: HTMLIFrameElement | null = null
  let transport: BridgeTransport
  if (options.transport) {
    transport = options.transport
  } else {
    const container = options.container ?? (typeof document !== 'undefined' ? document.body : undefined)
    if (!container) throw new Error('inneragent iframe embed: container is required (no document.body)')
    const factory = options.createElement ?? (() => document.createElement('iframe'))
    iframe = factory()
    if (options.iframeAttrs) {
      for (const [name, value] of Object.entries(options.iframeAttrs)) {
        iframe.setAttribute(name, value)
      }
    }
    // 先挂载 (contentWindow 就绪) 再建通道、最后才触发加载 —— child 启动即发
    // hello, 监听必须先于 src 生效
    container.appendChild(iframe)
    transport = windowTransport({ win: window, remote: () => iframe?.contentWindow ?? null })
    iframe.setAttribute('src', options.src)
  }

  // ---- 状态 ----
  let destroyed = false
  let handshakeDone = false
  let rejectedCount = 0
  const pendingAcks = new Map<string, () => void>()
  const queued: BridgeEnvelope[] = []
  const currentPage: { value?: unknown } = {}
  const currentObject: { value?: unknown } = {}

  let resolveReady!: () => void
  let rejectReady!: (reason: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // destroy/超时 reject 时等待方可能尚未 await — 挂 no-op catch 抑制
  // unhandled rejection (await ready 的调用方仍正常收到 rejection)
  void ready.catch(() => {})
  const handshakeTimer = setTimeout(() => {
    if (!handshakeDone && !destroyed) {
      rejectReady(new Error('inneragent iframe embed: handshake timeout (child 未在时限内发起 hello)'))
    }
  }, handshakeTimeoutMs)

  function post(message: BridgeEnvelope): void {
    transport.post(message, childOrigin)
  }

  /** 发送并等待对端 ack (超时重发一次; 都失败则 reject) */
  function sendWithAck(message: BridgeEnvelope): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attempt = (remaining: number): void => {
        if (destroyed) {
          reject(new Error('inneragent iframe embed: destroyed'))
          return
        }
        const timer = setTimeout(() => {
          pendingAcks.delete(message.nonce)
          if (remaining > 0) {
            attempt(remaining - 1)
          } else {
            reject(new Error(`inneragent iframe embed: ack timeout for ${message.type}`))
          }
        }, ackTimeoutMs)
        pendingAcks.set(message.nonce, () => {
          clearTimeout(timer)
          pendingAcks.delete(message.nonce)
          resolve()
        })
        post(message)
      }
      attempt(1)
    })
  }

  function ackMessage(nonce: string): void {
    post(createMessage('ack', undefined, nonce))
  }

  function flushQueued(): void {
    while (queued.length > 0) {
      const message = queued.shift()!
      post(message)
    }
  }

  function buildReadyPayload(): BridgeReadyPayload {
    const payload: BridgeReadyPayload = {
      protocolVersion: IA_BRIDGE_VERSION,
      appKey: options.appKey,
    }
    if (options.agentType !== undefined) payload.agentType = options.agentType
    if (options.baseURL !== undefined) payload.baseURL = options.baseURL
    if (options.locale !== undefined) payload.locale = options.locale
    if (options.theme !== undefined) payload.theme = options.theme
    return payload
  }

  async function serveTokenRequest(request: BridgeEnvelope<BridgeTokenRequestPayload>): Promise<void> {
    try {
      const token = await options.tokenGetter()
      if (destroyed) return
      const reply = createMessage<BridgeTokenPayload>('token', {
        token,
        reason: request.payload?.reason ?? 'refresh',
      }, request.nonce)
      await sendWithAck(reply)
    } catch (error) {
      onEvent?.({
        kind: 'error',
        code: 'token-getter-failed',
        message: error instanceof Error ? error.message : String(error),
      }, { origin: childOrigin })
    }
  }

  const offMessage = transport.onMessage((incoming) => {
    if (destroyed) return
    if (!isBridgeEnvelope(incoming.data)) return
    if (!allowedOrigins.has(incoming.origin)) {
      rejectedCount += 1
      return
    }
    // host 侧真实 iframe 场景: 来源窗口必须就是本 iframe (注入通道 source 为 null, 跳过)
    if (incoming.source && iframe?.contentWindow && incoming.source !== iframe.contentWindow) {
      rejectedCount += 1
      return
    }
    const message = incoming.data
    switch (message.type) {
      case 'hello': {
        // 每个 hello 都幂等应答 (child 以最新 nonce 判定, 旧 ready 会被丢弃)
        post(createMessage<BridgeReadyPayload>('ready', buildReadyPayload(), message.nonce))
        if (!handshakeDone) {
          handshakeDone = true
          clearTimeout(handshakeTimer)
          flushQueued()
          resolveReady()
        }
        break
      }
      case 'token-request':
        void serveTokenRequest(message as BridgeEnvelope<BridgeTokenRequestPayload>)
        break
      case 'event':
        // 先确认再外发 (child 侧等待 ack 重发会造成重复事件)
        ackMessage(message.nonce)
        onEvent?.(message.payload as BridgeEventPayload, { origin: incoming.origin })
        break
      case 'ack': {
        if (message.ack) {
          const resolver = pendingAcks.get(message.ack)
          if (resolver) resolver()
        }
        break
      }
      default:
        // hello/ready/token/context/set-theme 不是 host 侧消费的类型; 未知类型静默忽略 (向前兼容)
        break
    }
  })

  function pushContext(): void {
    const payload: BridgeContextPayload = {}
    if ('value' in currentPage && currentPage.value !== undefined) payload.page = currentPage.value
    if ('value' in currentObject && currentObject.value !== undefined) payload.object = currentObject.value
    const message = createMessage<BridgeContextPayload>('context', payload)
    if (handshakeDone) post(message)
    else queued.push(message)
  }

  return {
    iframe,
    ready,
    handshakeOrigin: childOrigin,
    get rejectedMessageCount(): number {
      return rejectedCount
    },
    setPage(page) {
      currentPage.value = page
      pushContext()
    },
    setObject(object) {
      currentObject.value = object
      pushContext()
    },
    clearContext() {
      delete currentPage.value
      delete currentObject.value
      pushContext()
    },
    setTheme(tokens) {
      const message = createMessage<BridgeThemePayload>('set-theme', { tokens })
      if (handshakeDone) post(message)
      else queued.push(message)
    },
    async refreshToken() {
      const token = await options.tokenGetter()
      const reply = createMessage<BridgeTokenPayload>('token', { token, reason: 'refresh' })
      await sendWithAck(reply)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(handshakeTimer)
      for (const resolver of pendingAcks.values()) resolver()
      pendingAcks.clear()
      offMessage()
      if (!handshakeDone) {
        rejectReady(new Error('inneragent iframe embed: destroyed before handshake'))
      }
      iframe?.remove()
      iframe = null
    },
  }
}
