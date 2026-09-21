import { describe, it, expect, vi } from 'vitest'
import {
  INNERAGENT_DEFAULT_APP_KEY,
  createEmbedTokenGetter,
  isTokenExpiring,
  parseJwtExp,
  resolveInnerAgentAppKey,
} from '@/ia/innerAgentBridge'

/** 构造三段式 JWT(未签名,payload base64url;仅取 exp 用) */
function makeToken(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

describe('resolveInnerAgentAppKey', () => {
  it('缺省回退 acme-demo', () => {
    expect(resolveInnerAgentAppKey(undefined)).toBe(INNERAGENT_DEFAULT_APP_KEY)
    expect(resolveInnerAgentAppKey('')).toBe('acme-demo')
    expect(resolveInnerAgentAppKey('   ')).toBe('acme-demo')
  })

  it('env 值优先并去除空白', () => {
    expect(resolveInnerAgentAppKey(' my-app ')).toBe('my-app')
  })
})

describe('parseJwtExp(接入指南 §2-⑤ tokenGetter 三要点)', () => {
  it('解析 base64url payload 的 exp', () => {
    expect(parseJwtExp(makeToken({ exp: 1893456000 }))).toBe(1893456000)
  })

  it('非三段式 / 无 exp / 非数字 exp → null(交由 SDK 401 懒换兜底)', () => {
    expect(parseJwtExp('only-two')).toBeNull()
    expect(parseJwtExp(makeToken({ sub: '1' }))).toBeNull()
    expect(parseJwtExp(makeToken({ exp: 'tomorrow' }))).toBeNull()
    expect(parseJwtExp('a.%%%not-base64.b')).toBeNull()
  })
})

describe('isTokenExpiring', () => {
  const NOW = 1_800_000_000_000

  it('token 缺失 → true(必须重取)', () => {
    expect(isTokenExpiring(null, NOW)).toBe(true)
    expect(isTokenExpiring('', NOW)).toBe(true)
  })

  it('距 exp 不足 5 分钟 → true;充裕 → false', () => {
    expect(isTokenExpiring(makeToken({ exp: NOW / 1000 + 60 }), NOW)).toBe(true)
    expect(isTokenExpiring(makeToken({ exp: NOW / 1000 + 3600 }), NOW)).toBe(false)
  })

  it('exp 已过 → true;exp 解析失败 → false(信任缓存,由 SDK 401 兜底)', () => {
    expect(isTokenExpiring(makeToken({ exp: NOW / 1000 - 10 }), NOW)).toBe(true)
    expect(isTokenExpiring('broken.token', NOW)).toBe(false)
  })
})

describe('createEmbedTokenGetter(缓存 + 临期重签 + 失败退缓存/null)', () => {
  const FRESH = makeToken({ exp: Date.now() / 1000 + 3600 })

  it('缓存未临期 → 不打宿主端点', async () => {
    const fetchToken = vi.fn().mockResolvedValue(FRESH)
    const getter = createEmbedTokenGetter(fetchToken)
    const first = await getter()
    expect(first).toBe(FRESH)
    const second = await getter()
    expect(second).toBe(FRESH)
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('无缓存且端点失败 → null(SDK 契约:明确无 token,按 401 抛错不重试)', async () => {
    const getter = createEmbedTokenGetter(vi.fn().mockRejectedValue(new Error('network')))
    await expect(getter()).resolves.toBeNull()
  })

  it('无缓存且端点返回 null → null', async () => {
    const getter = createEmbedTokenGetter(vi.fn().mockResolvedValue(null))
    await expect(getter()).resolves.toBeNull()
  })

  it('重签失败但有旧 token → 返回旧值(SDK 401 会再次回调)', async () => {
    const stale = makeToken({ exp: Math.floor(Date.now() / 1000) - 1 })
    const fetchToken = vi.fn()
      .mockResolvedValueOnce(stale)
      .mockRejectedValueOnce(new Error('network'))
    const getter = createEmbedTokenGetter(fetchToken)
    await expect(getter()).resolves.toBe(stale)
    await expect(getter()).resolves.toBe(stale)
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('临期后重取并更新缓存', async () => {
    const old = makeToken({ exp: Math.floor(Date.now() / 1000) - 1 })
    const newer = makeToken({ exp: Math.floor(Date.now() / 1000) + 7200 })
    const fetchToken = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(newer)
    const getter = createEmbedTokenGetter(fetchToken)
    await expect(getter()).resolves.toBe(old)
    await expect(getter()).resolves.toBe(newer)
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })
})
