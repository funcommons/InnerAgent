/**
 * [new] InnerAgent iframe 桥 — postMessage 协议定义 (P4/W15; 02-技术方案 §8.1
 * 「iframe 模式: 同源策略受限宿主用 postMessage 协议桥接」+ §7.3 验收 5
 * 「iframe 模式在严格 CSP demo 宿主可用; token 不入 URL」)。
 *
 * 安全决策 (报告口径, 亦是 README 协议小节的契约):
 * 1. **token 只走本协议的 `token` 消息**: 宿主 tokenGetter 的结果经
 *    postMessage 送达 iframe 内 WC; **禁止**把 token 放进 iframe URL / query /
 *    hash / 其他通道。host.ts 对 `src` 中的 token 形 query 参数直接拒绝。
 * 2. **origin allowlist**: 双侧各持 allowlist, 来源不符的消息一律丢弃
 *    (host 校验 iframe 来源, child 校验 parent 来源); 发送必带显式
 *    targetOrigin, 永不使用 '*'。
 * 3. **nonce + ack**: 每条消息带唯一 nonce; 应答/确认消息以 `ack` 字段回指
 *    被应答消息的 nonce —— 过期/伪造/串线的旧消息无法冒充当前握手
 *    (ready.ack ≠ 最近 hello.nonce 的消息被丢弃)。
 * 4. **严格 CSP 可用**: 产物不含 eval / new Function / 内联脚本
 *    (csp.spec.ts 静态自检), 无第三方运行时依赖 (child 产物自包含)。
 *
 * 消息类型表 (type / 方向 / payload / ack 语义):
 * | type          | 方向        | payload                                   | ack                        |
 * |---------------|-------------|-------------------------------------------|----------------------------|
 * | hello         | child→host  | { protocolVersion }                       | 由 ready 应答              |
 * | ready         | host→child  | { protocolVersion, appKey, agentType?, baseURL?, locale?, theme? } | ack=hello.nonce |
 * | token-request | child→host  | { reason: 'initial'|'refresh' }           | 由 token 应答              |
 * | token         | host→child  | { token: string|null, reason }            | ack=token-request.nonce    |
 * | context       | host→child  | { page?, object? }                        | child 自动 ack             |
 * | set-theme     | host→child  | { tokens }                                | child 自动 ack             |
 * | event         | child→host  | { kind: 'status'|'error'|'run-terminal'|'tool-finished', ... } | host 自动 ack |
 * | ack           | 双向        | 无                                        | ack=被确认消息 nonce       |
 */

/** 消息命名空间 (异源页面上其他 postMessage 流量的隔离标识) */
export const IA_BRIDGE_NAMESPACE = 'inneragent.bridge'

/** 协议版本 (不兼容变更时递增; 版本不符的消息按外来的垃圾流量丢弃) */
export const IA_BRIDGE_VERSION = 1

export type BridgeMessageType =
  | 'hello'
  | 'ready'
  | 'token'
  | 'token-request'
  | 'context'
  | 'set-theme'
  | 'event'
  | 'ack'

/** child → host: 握手请求 */
export interface BridgeHelloPayload {
  protocolVersion: number
}

/** host → child: 握手应答 + 会话引导配置 (child 端 init 的参数来源) */
export interface BridgeReadyPayload {
  protocolVersion: number
  appKey: string
  agentType?: string
  baseURL?: string
  locale?: 'zh-CN' | 'en-US'
  theme?: Record<string, string>
}

/** child → host: 请求 embed token */
export interface BridgeTokenRequestPayload {
  reason: 'initial' | 'refresh'
}

/**
 * host → child: embed token。**token 走 postMessage 的唯一合法形态**;
 * reason='refresh' 表示宿主 tokenGetter 重新签发 (过期懒换跨消息桥语义)。
 */
export interface BridgeTokenPayload {
  token: string | null
  reason: 'initial' | 'refresh'
}

/** host → child: 页面上下文同步 (对应 SDK setRunContext {page, object}) */
export interface BridgeContextPayload {
  page?: unknown
  object?: unknown
}

/** host → child: 主题令牌 (--ia-* 子集) */
export interface BridgeThemePayload {
  tokens: Record<string, string>
}

/** child → host: 状态/错误外发 */
export type BridgeEventPayload =
  | { kind: 'status'; status: 'handshaking' | 'ready' }
  | { kind: 'error'; code?: string; message: string; fatal?: boolean }
  | { kind: 'run-terminal' }
  | { kind: 'tool-finished'; toolName: string }

/** 协议信封 — 所有跨窗口消息的统一外壳 */
export interface BridgeEnvelope<T = unknown> {
  ns: typeof IA_BRIDGE_NAMESPACE
  v: number
  type: BridgeMessageType
  /** 消息唯一标识; 应答方以 ack 回指 */
  nonce: string
  /** 被应答/确认消息的 nonce */
  ack?: string
  payload?: T
}

const BRIDGE_NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 生成协议 nonce (crypto 随机, 降级 Math.random —— 仅用于混淆防护, 非安全边界) */
export function createNonce(): string {
  let nonce = ''
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) nonce += BRIDGE_NONCE_ALPHABET[byte % BRIDGE_NONCE_ALPHABET.length]
    return nonce
  }
  for (let i = 0; i < 16; i += 1) {
    nonce += BRIDGE_NONCE_ALPHABET[Math.floor(Math.random() * BRIDGE_NONCE_ALPHABET.length)]
  }
  return nonce
}

/** 构造协议消息 */
export function createMessage<T>(
  type: BridgeMessageType,
  payload?: T,
  ack?: string,
): BridgeEnvelope<T> {
  const message: BridgeEnvelope<T> = {
    ns: IA_BRIDGE_NAMESPACE,
    v: IA_BRIDGE_VERSION,
    type,
    nonce: createNonce(),
  }
  if (ack !== undefined) message.ack = ack
  if (payload !== undefined) message.payload = payload
  return message
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>([
  'hello', 'ready', 'token', 'token-request', 'context', 'set-theme', 'event', 'ack',
])

/**
 * 信封形状校验 (ns/版本/type/nonce)。
 * 目标: 异源页面上的其他 postMessage 流量、协议版本不符的消息、伪造的垃圾
 * 消息一律在此挡下, 不进入任何状态机。
 */
export function isBridgeEnvelope(data: unknown): data is BridgeEnvelope {
  if (data === null || typeof data !== 'object') return false
  const candidate = data as Partial<BridgeEnvelope>
  if (candidate.ns !== IA_BRIDGE_NAMESPACE) return false
  if (candidate.v !== IA_BRIDGE_VERSION) return false
  if (typeof candidate.type !== 'string' || !KNOWN_TYPES.has(candidate.type)) return false
  if (typeof candidate.nonce !== 'string' || candidate.nonce.length === 0) return false
  if (candidate.ack !== undefined && typeof candidate.ack !== 'string') return false
  return true
}
