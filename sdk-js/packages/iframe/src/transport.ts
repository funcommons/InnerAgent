/**
 * [new] iframe 桥 — 传输层抽象 (P4/W15)。
 *
 * 协议逻辑 (握手/nonce/ack/状态机) 与真实 postMessage 解耦:
 * - windowTransport: 真实窗口对 (child: win+window.parent / host: win+iframe.contentWindow);
 * - createMemoryTransportPair: 同步内存对 —— 单测/宿主自测用, 确定性回环,
 *   并带 inject 钩子模拟任意来源的伪造消息 (origin 拒绝矩阵测试)。
 *
 * 安全约定: post() 的 targetOrigin 由调用方显式给出, 实现层**禁止 '*'**。
 */

import type { BridgeEnvelope } from './protocol'

/** 入站消息 (origin 必须由协议层校验) */
export interface BridgeIncomingMessage {
  origin: string
  data: unknown
  /** 发送方窗口引用 (host 侧用于确认来源是自己的 iframe) */
  source: unknown | null
}

export interface BridgeTransport {
  /** 向对端发送; targetOrigin 显式传入, 不允许 '*' */
  post(message: BridgeEnvelope, targetOrigin: string): void
  /** 监听入站消息; 返回取消监听函数 */
  onMessage(handler: (message: BridgeIncomingMessage) => void): () => void
}

/**
 * 真实窗口传输适配器。
 * - child 端: windowTransport({ win: window, remote: window.parent })
 * - host 端: windowTransport({ win: window, remote: () => iframe.contentWindow })
 *   (host 的 remote 用惰性取值 —— iframe 刚创建时 contentWindow 尚为 null)
 */
export function windowTransport(options: {
  win: Window
  remote: Window | (() => Window | null)
}): BridgeTransport {
  const { win } = options
  const resolveRemote = (): Window => {
    const remote = typeof options.remote === 'function' ? options.remote() : options.remote
    if (!remote) throw new Error('inneragent bridge: remote window is not available yet')
    return remote
  }
  return {
    post(message, targetOrigin) {
      if (targetOrigin === '*') {
        throw new Error('inneragent bridge: targetOrigin "*" is forbidden (token 安全: 显式 origin 校验)')
      }
      resolveRemote().postMessage(message, targetOrigin)
    },
    onMessage(handler) {
      const listener = (event: MessageEvent): void => {
        handler({ origin: event.origin, data: event.data, source: event.source ?? null })
      }
      win.addEventListener('message', listener)
      return () => win.removeEventListener('message', listener)
    },
  }
}

export interface MemoryTransportPair {
  /** A 端 (测试中通常作 host 侧视角: 对端 origin = originB) */
  a: BridgeTransport
  /** B 端 (通常作 child 侧视角: 对端 origin = originA) */
  b: BridgeTransport
  /** 测试钩子: 模拟任意来源向某端注入一条消息 (origin 伪造矩阵用) */
  inject(side: 'a' | 'b', data: unknown, origin: string): void
  /** 测试钩子: 全部已投递消息日志 (from → to) */
  log(): Array<{ from: 'a' | 'b'; to: 'a' | 'b'; message: BridgeEnvelope }>
}

/**
 * 同步内存传输对 — post 即同步投递到对端 listener (确定性, 无宏任务),
 * 单测里宿主/child 全栈直连; 未注册 listener 时消息进 log 但不投递。
 */
export function createMemoryTransportPair(
  originA = 'https://host.example',
  originB = 'https://frame.example',
): MemoryTransportPair {
  type Handler = (message: BridgeIncomingMessage) => void
  const listeners: Record<'a' | 'b', Set<Handler>> = { a: new Set(), b: new Set() }
  const delivered: Array<{ from: 'a' | 'b'; to: 'a' | 'b'; message: BridgeEnvelope }> = []

  function makeTransport(self: 'a' | 'b'): BridgeTransport {
    const peer: 'a' | 'b' = self === 'a' ? 'b' : 'a'
    // 投递到对端的消息 origin = 发送方自己的 origin (postMessage 语义)
    const selfOrigin = self === 'a' ? originA : originB
    return {
      post(message) {
        delivered.push({ from: self, to: peer, message })
        for (const handler of listeners[peer]) {
          handler({ origin: selfOrigin, data: structuredCloneSafe(message), source: null })
        }
      },
      onMessage(handler) {
        listeners[self].add(handler)
        return () => listeners[self].delete(handler)
      },
    }
  }

  return {
    a: makeTransport('a'),
    b: makeTransport('b'),
    inject(side, data, origin) {
      for (const handler of listeners[side]) {
        handler({ origin, data, source: null })
      }
    },
    log: () => delivered.map((entry) => ({ ...entry })),
  }
}

/** 结构化克隆语义的近似 (postMessage 会克隆; 测试内存对用深拷贝防引用共享) */
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
