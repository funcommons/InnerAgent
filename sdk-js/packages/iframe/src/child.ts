/**
 * [new] iframe 桥 — child 侧 (被嵌页内运行; P4/W15)。
 *
 * `mountIframeAgent()` 在 iframe 页面里引导整套 SDK:
 * 1. 向宿主握手 (hello 重试 → ready, nonce+ack 防混淆/防重放);
 * 2. 用 ready 载荷里的引导配置 (appKey/agentType/baseURL/locale/theme)
 *    执行 init —— **tokenGetter 是桥接实现**: token 只经消息桥的 `token`
 *    消息进入本页, 永不经过 URL;
 * 3. 401 懒换跨桥: onUnauthorized 钩子失效本地 token 缓存并向宿主以
 *    reason:'refresh' 重取 (宿主 tokenGetter 重新签发);
 * 4. 注册 WC 并挂载, 向宿主外发状态/错误/运行终态事件。
 *
 * 安全: 入站消息必须来自 allowedParentOrigins (缺省同源), 其余一律丢弃;
 * 出站消息 targetOrigin 取 allowlist 首项 (宿主真实来源), 永不 '*';
 * ready.ack ≠ 最近 hello.nonce 的握手应答一律丢弃 (防旧消息冒充)。
 */
import {
  applyTheme,
  init,
  setAssistantEventHooks,
  setRunContext,
  type IaThemeTokens,
} from '@inneragent/sdk-core'
import { registerInnerAgentChat, setIaLocale } from '@inneragent/sdk-components'
import {
  createMessage,
  isBridgeEnvelope,
  IA_BRIDGE_VERSION,
  type BridgeEventPayload,
  type BridgeHelloPayload,
  type BridgeReadyPayload,
  type BridgeThemePayload,
  type BridgeTokenPayload,
  type BridgeTokenRequestPayload,
} from './protocol'
import { windowTransport, type BridgeTransport } from './transport'

export interface MountIframeAgentOptions {
  /** 允许的宿主来源 allowlist; 缺省 [location.origin] (同源宿主) */
  allowedParentOrigins?: string[]
  /** WC 挂载点 (元素或选择器), 缺省 document.body */
  target?: HTMLElement | string
  /** 本地覆盖 appKey (缺省以宿主 ready 载荷为准) */
  appKey?: string
  /** 握手超时 (ms, 缺省 15000); 超时后 ready reject 并外发 error 事件 */
  handshakeTimeoutMs?: number
  /** hello 重试间隔 (ms, 缺省 400; 宿主晚于 child 就绪时补握手) */
  helloRetryIntervalMs?: number
  /** token 请求 ack 超时 (ms, 缺省 10000; 超时按 null 处理, 下次再取) */
  tokenAckTimeoutMs?: number
  /**
   * 注入自定义通道 (测试); 缺省 window + window.parent。
   * 注入后不再要求运行于 iframe 内。
   */
  transport?: BridgeTransport
  /**
   * 注入挂载元素工厂 (测试/自定义宿主元素); 缺省注册并创建
   * `<inneragent-chat view="chat">`。
   */
  elementFactory?: () => HTMLElement
}

export interface IframeAgentHandle {
  /** 引导完成 (首个 token 就绪 + WC 已挂载) */
  readonly ready: Promise<void>
  /** 当前生命周期状态 */
  readonly status: 'handshaking' | 'ready' | 'failed' | 'destroyed'
  /** 因来源不符/nonce 不符被丢弃的消息计数 (诊断/测试) */
  readonly rejectedMessageCount: number
  /** 手动向宿主重取 token (reason:'refresh'; 一般由 401 懒换自动触发) */
  requestTokenRefresh(): Promise<string | null>
  destroy(): void
}

interface PendingToken {
  resolve: (token: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

/** 单页面单实例 (桥接管全局 SDK 配置与事件钩子; 重复调用抛错, destroy 后可重挂) */
let active: IframeAgentHandle | null = null

/** 供测试隔离: 强制清除单实例守卫 (正常无需调用) */
export function __resetIframeAgentForTests(): void {
  active = null
}

export function mountIframeAgent(options: MountIframeAgentOptions = {}): IframeAgentHandle {
  if (active) {
    throw new Error('inneragent iframe child: mountIframeAgent already called (destroy 后可重挂)')
  }

  const allowedOrigins = new Set(
    options.allowedParentOrigins
    ?? (typeof location !== 'undefined' && location.origin ? [location.origin] : []),
  )
  const outboundOrigin = options.allowedParentOrigins?.[0]
    ?? (typeof location !== 'undefined' && location.origin ? location.origin : '')
  if (allowedOrigins.size === 0 || !outboundOrigin) {
    throw new Error('inneragent iframe child: 无法确定宿主来源 (请配置 allowedParentOrigins)')
  }

  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 15_000
  const helloRetryIntervalMs = options.helloRetryIntervalMs ?? 400
  const tokenAckTimeoutMs = options.tokenAckTimeoutMs ?? 10_000

  let destroyed = false
  let status: IframeAgentHandle['status'] = 'handshaking'
  let rejectedCount = 0
  let lastHelloNonce: string | null = null
  let initialized = false
  /** undefined = 尚无 token (getter 需向宿主要); null = 宿主明确无 token (匿名联调) */
  let tokenCache: string | null | undefined = undefined
  const pendingTokens = new Set<PendingToken>()

  const transport: BridgeTransport = options.transport
    ?? windowTransport({ win: window, remote: window.parent })

  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // destroy/超时 reject 时等待方可能尚未 await — 挂 no-op catch 抑制
  // unhandled rejection (await ready 的调用方仍正常收到 rejection)
  void ready.catch(() => {})

  function emit(event: BridgeEventPayload): void {
    if (destroyed) return
    try {
      transport.post(createMessage('event', event), outboundOrigin)
    } catch {
      // 宿主不可达 (窗口销毁等) — 事件外发尽力而为
    }
  }

  // ---- token 通道 (token 不入 URL 的落点) ----

  function settlePendingTokens(token: string | null): void {
    for (const pending of pendingTokens) {
      clearTimeout(pending.timer)
      pending.resolve(token)
    }
    pendingTokens.clear()
    tokenCache = token
  }

  function requestToken(reason: 'initial' | 'refresh'): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      if (destroyed) {
        resolve(null)
        return
      }
      const pending: PendingToken = {
        resolve,
        timer: setTimeout(() => {
          pendingTokens.delete(pending)
          resolve(null)
        }, tokenAckTimeoutMs),
      }
      pendingTokens.add(pending)
      transport.post(
        createMessage<BridgeTokenRequestPayload>('token-request', { reason }),
        outboundOrigin,
      )
    })
  }

  /** SDK init 的 tokenGetter: 命中缓存直返; 失效/首次经消息桥向宿主要 */
  async function bridgeTokenGetter(): Promise<string | null> {
    if (tokenCache !== undefined) return tokenCache
    return requestToken('initial')
  }

  /** 主动刷新: 失效缓存 → 经桥以 reason:'refresh' 向宿主重取 */
  function requestTokenRefresh(): Promise<string | null> {
    tokenCache = undefined
    return requestToken('refresh')
  }

  // ---- 握手 (hello 重试: 宿主可能晚于 child 就绪) ----

  function sendHello(): void {
    if (destroyed || status !== 'handshaking') return
    const hello = createMessage<BridgeHelloPayload>('hello', { protocolVersion: IA_BRIDGE_VERSION })
    lastHelloNonce = hello.nonce
    transport.post(hello, outboundOrigin)
  }

  const handshakeTimer = setTimeout(() => {
    if (status === 'handshaking' && !destroyed) {
      status = 'failed'
      emit({ kind: 'error', code: 'handshake-timeout', message: 'handshake timeout', fatal: true })
      rejectReady(new Error('inneragent iframe child: handshake timeout (宿主未应答 hello)'))
    }
  }, handshakeTimeoutMs)

  const helloTimer = setInterval(sendHello, helloRetryIntervalMs)

  function resolveTarget(): HTMLElement {
    if (options.target === undefined) {
      if (typeof document === 'undefined' || !document.body) {
        throw new Error('inneragent iframe child: target is required (no document.body)')
      }
      return document.body
    }
    if (typeof options.target === 'string') {
      const found = document.querySelector<HTMLElement>(options.target)
      if (!found) throw new Error(`inneragent iframe child: target "${options.target}" not found`)
      return found
    }
    return options.target
  }

  function mountElement(target: HTMLElement): void {
    if (options.elementFactory) {
      target.appendChild(options.elementFactory())
      return
    }
    registerInnerAgentChat()
    const element = document.createElement('inneragent-chat')
    element.setAttribute('view', 'chat')
    target.appendChild(element)
  }

  async function bootstrap(payload: BridgeReadyPayload): Promise<void> {
    initialized = true
    const appKey = options.appKey ?? payload.appKey
    if (!appKey) {
      throw new Error('inneragent iframe child: appKey missing (宿主 ready 载荷或 options.appKey 必须提供)')
    }
    if (payload.theme) applyTheme(payload.theme as IaThemeTokens)
    if (payload.locale) setIaLocale(payload.locale)
    init({
      appKey,
      tokenGetter: bridgeTokenGetter,
      ...(payload.agentType !== undefined ? { agentType: payload.agentType } : {}),
      ...(payload.baseURL !== undefined ? { baseURL: payload.baseURL } : {}),
    })
    // 事件外发 (运行终态/工具完成) + 401 懒换跨桥
    setAssistantEventHooks({
      onRunTerminal: () => emit({ kind: 'run-terminal' }),
      onToolFinished: (toolName) => emit({ kind: 'tool-finished', toolName }),
      onUnauthorized: () => {
        tokenCache = undefined
        void requestToken('refresh')
      },
    })
    // 首个 token 就绪后再挂载 (避免挂载后的初始化请求无 token 裸奔)
    await requestToken('initial')
    if (destroyed) return
    mountElement(resolveTarget())
    status = 'ready'
    emit({ kind: 'status', status: 'ready' })
    resolveReady()
  }

  function ackMessage(nonce: string): void {
    transport.post(createMessage('ack', undefined, nonce), outboundOrigin)
  }

  const offMessage = transport.onMessage((incoming) => {
    if (destroyed) return
    if (!isBridgeEnvelope(incoming.data)) return
    if (!allowedOrigins.has(incoming.origin)) {
      rejectedCount += 1
      return
    }
    const message = incoming.data
    switch (message.type) {
      case 'ready': {
        if (lastHelloNonce === null || message.ack !== lastHelloNonce) {
          rejectedCount += 1
          return
        }
        if (status !== 'handshaking') return
        clearInterval(helloTimer)
        clearTimeout(handshakeTimer)
        void bootstrap(message.payload as BridgeReadyPayload).catch((error: unknown) => {
          status = 'failed'
          emit({
            kind: 'error',
            code: 'bootstrap-failed',
            message: error instanceof Error ? error.message : String(error),
            fatal: true,
          })
          rejectReady(error instanceof Error ? error : new Error(String(error)))
        })
        break
      }
      case 'token': {
        const payload = message.payload as BridgeTokenPayload
        settlePendingTokens(payload.token)
        ackMessage(message.nonce)
        break
      }
      case 'context': {
        const payload = (message.payload ?? {}) as { page?: unknown; object?: unknown }
        setRunContext({ page: payload.page, object: payload.object })
        ackMessage(message.nonce)
        break
      }
      case 'set-theme': {
        const payload = (message.payload ?? {}) as BridgeThemePayload
        applyTheme((payload.tokens ?? {}) as IaThemeTokens)
        ackMessage(message.nonce)
        break
      }
      case 'ack':
      case 'hello':
      default:
        // child 不消费 ack/hello; 未知类型静默忽略 (向前兼容)
        break
    }
  })

  const handle: IframeAgentHandle = {
    ready,
    get status() {
      return status
    },
    get rejectedMessageCount() {
      return rejectedCount
    },
    requestTokenRefresh,
    destroy() {
      if (destroyed) return
      destroyed = true
      status = 'destroyed'
      clearInterval(helloTimer)
      clearTimeout(handshakeTimer)
      for (const pending of pendingTokens) clearTimeout(pending.timer)
      pendingTokens.clear()
      offMessage()
      // ready 已 settle 时 reject 为 no-op; 未 settle 时让等待方退出
      rejectReady(new Error('inneragent iframe child: destroyed'))
      if (initialized) {
        setAssistantEventHooks(undefined)
      }
      if (active === handle) {
        active = null
      }
    },
  }

  active = handle
  sendHello()
  return handle
}
