/**
 * [new] postMessage 协议信封测试 (P4/W15)。
 * - nonce 唯一性 (防混淆的基础)
 * - isBridgeEnvelope 校验矩阵: 命名空间/版本/类型/nonce —— 异源页面上的
 *   其他 postMessage 流量与伪造/过期消息在进入状态机前被挡下
 */
import { describe, expect, it } from 'vitest'
import {
  createMessage,
  createNonce,
  isBridgeEnvelope,
  IA_BRIDGE_NAMESPACE,
  IA_BRIDGE_VERSION,
} from '../protocol'

describe('protocol (信封与 nonce)', () => {
  it('createMessage: 命名空间/版本/nonce 齐备, payload/ack 可选', () => {
    const message = createMessage('hello', { protocolVersion: IA_BRIDGE_VERSION })
    expect(message.ns).toBe(IA_BRIDGE_NAMESPACE)
    expect(message.v).toBe(IA_BRIDGE_VERSION)
    expect(message.type).toBe('hello')
    expect(message.nonce).toBeTruthy()
    expect(message.payload).toEqual({ protocolVersion: IA_BRIDGE_VERSION })
    expect(message.ack).toBeUndefined()

    const acked = createMessage('ack', undefined, 'target-nonce')
    expect(acked.ack).toBe('target-nonce')
    expect(acked.payload).toBeUndefined()
  })

  it('nonce: 连续生成不重复 (16 次以上)', () => {
    const nonces = new Set(Array.from({ length: 64 }, () => createNonce()))
    expect(nonces.size).toBe(64)
    for (const nonce of nonces) {
      expect(nonce).toHaveLength(16)
    }
  })

  it('isBridgeEnvelope: 合法信封通过', () => {
    expect(isBridgeEnvelope(createMessage('token', { token: 't', reason: 'initial' }))).toBe(true)
  })

  it('isBridgeEnvelope: 拒绝矩阵 (null/标量/错 ns/错版本/未知 type/坏 nonce/坏 ack)', () => {
    expect(isBridgeEnvelope(null)).toBe(false)
    expect(isBridgeEnvelope(undefined)).toBe(false)
    expect(isBridgeEnvelope('hello')).toBe(false)
    expect(isBridgeEnvelope(42)).toBe(false)

    expect(isBridgeEnvelope({ ...createMessage('hello'), ns: 'other.app' })).toBe(false)
    expect(isBridgeEnvelope({ ...createMessage('hello'), v: IA_BRIDGE_VERSION + 1 })).toBe(false)
    expect(isBridgeEnvelope({ ...createMessage('hello'), type: 'secrets' })).toBe(false)
    expect(isBridgeEnvelope({ ...createMessage('hello'), nonce: '' })).toBe(false)
    const { nonce, ...missingNonce } = createMessage('hello')
    void nonce
    expect(isBridgeEnvelope(missingNonce)).toBe(false)
    expect(isBridgeEnvelope({ ...createMessage('hello'), ack: 42 })).toBe(false)
  })
})
