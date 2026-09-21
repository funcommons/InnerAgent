import { describe, it, expect } from 'vitest'
import { base64UrlDecode, decodeJwt, remainingSeconds, formatCountdown, formatEpoch } from '@/site/jwt'

function b64url(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeJwt(header: object, payload: object, signature = 'sig'): string {
  return `${b64url(header)}.${b64url(payload)}.${signature}`
}

describe('site/jwt(体验台 JWT 解码与倒计时)', () => {
  it('解码三段式:header/payload 对象 + 原样 signature', () => {
    const token = makeJwt({ alg: 'RS256', typ: 'JWT' }, { iss: 'acme-demo', sub: '10086', exp: 4102444800 })
    const decoded = decodeJwt(token)
    expect(decoded.header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decoded.payload.iss).toBe('acme-demo')
    expect(decoded.payload.sub).toBe('10086')
    expect(decoded.signature).toBe('sig')
  })

  it('UTF-8 payload(多字节字符)正确解码', () => {
    const token = makeJwt({ alg: 'RS256' }, { name: '演示用户-中文', nested: { ok: true } })
    const decoded = decodeJwt(token)
    expect(decoded.payload.name).toBe('演示用户-中文')
    expect((decoded.payload.nested as { ok: boolean }).ok).toBe(true)
  })

  it('malformed 输入抛错(非三段/空段/非 JSON/段非对象)', () => {
    expect(() => decodeJwt('abc')).toThrow()
    expect(() => decodeJwt('a.b')).toThrow()
    expect(() => decodeJwt('a..c')).toThrow()
    expect(() => decodeJwt(`${btoa('not-json')}.${btoa('1')}.s`)).toThrow()
    expect(() => decodeJwt(`${btoa('123')}.${btoa('"str"')}.s`)).toThrow()
  })

  it('base64UrlDecode 处理 padding 与 url-safe 字符', () => {
    expect(base64UrlDecode('YQ')).toBe('a')   // 需补 padding
    expect(base64UrlDecode('w7s=')).toBe('û') // UTF-8 多字节 + 显式 padding
  })

  it('remainingSeconds:剩余为正向下取整,过期归零不为负', () => {
    const now = 1_700_000_000_000
    expect(remainingSeconds(1700000010, now)).toBe(10)
    expect(remainingSeconds(1700000000, now)).toBe(0)
    expect(remainingSeconds(1699999000, now)).toBe(0)
  })

  it('formatCountdown:hh:mm:ss 补零', () => {
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(59)).toBe('00:00:59')
    expect(formatCountdown(3600)).toBe('01:00:00')
    expect(formatCountdown(12 * 3600 + 34 * 60 + 5)).toBe('12:34:05')
  })

  it('formatEpoch:epoch 秒转本地时间文本(非空)', () => {
    expect(formatEpoch(1700000000)).toBeTruthy()
  })
})
