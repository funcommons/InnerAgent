/**
 * [new] windowTransport 适配器测试 (真实 jsdom postMessage)。
 * - 协议层不直接依赖 jsdom 消息时序 (全栈测试走内存对), 这里证明适配器
 *   与真实 DOM postMessage/addEventListener 接线正确
 * - targetOrigin '*' 被实现层拒绝 (显式 origin 校验, token 安全约定)
 */
import { describe, expect, it, vi } from 'vitest'
import { createMessage } from '../protocol'
import { windowTransport } from '../transport'

describe('windowTransport (真实 postMessage 接线)', () => {
  it('post → message 事件回环 (同窗口自环), data/nonce 透传', async () => {
    const handler = vi.fn()
    const transport = windowTransport({ win: window, remote: window })
    const off = transport.onMessage(handler)

    const message = createMessage('hello', { protocolVersion: 1 })
    transport.post(message, window.location.origin)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(handler).toHaveBeenCalledTimes(1)
    // jsdom 对 postMessage 的 event.origin 实现为空串 (已知限制), 真实浏览器
    // 会填源 origin —— origin 校验语义由内存对全栈测试覆盖, 这里验证接线
    const incoming = handler.mock.calls[0]![0] as { origin: string; data: typeof message; source: unknown }
    expect(typeof incoming.origin).toBe('string')
    expect(incoming.data.type).toBe('hello')
    expect(incoming.data.nonce).toBe(message.nonce)
    off()
  })

  it('取消监听后不再接收', async () => {
    const handler = vi.fn()
    const transport = windowTransport({ win: window, remote: window })
    const off = transport.onMessage(handler)
    off()

    transport.post(createMessage('hello'), window.location.origin)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(handler).not.toHaveBeenCalled()
  })

  it('targetOrigin "*" 被拒绝 (显式 origin 校验)', () => {
    const transport = windowTransport({ win: window, remote: window })
    expect(() => transport.post(createMessage('hello'), '*')).toThrow(/\*/)
  })
})
