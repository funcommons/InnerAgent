import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { playgroundApi, PlaygroundApiError } from '@/api/playground'

/** fetch 打桩(体验台客户端为独立 fetch 直连,不经 axios) */
const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('api/playground(体验台公开端点客户端)', () => {
  it('login:POST /api/demo/login,body 为 {username},解 R 信封取 data', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0, msg: 'success',
      data: { token: 'session-1', username: 'alice', userId: 10086 },
    }))
    const session = await playgroundApi.login('alice')
    expect(session).toEqual({ token: 'session-1', username: 'alice', userId: 10086 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/demo/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ username: 'alice' })
  })

  it('embedToken:GET /api/ia/embed-token,显式携带 Bearer 会话 token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0, msg: 'success',
      data: { token: 'aaa.bbb.ccc', expiresIn: 43200, appKey: 'acme-demo' },
    }))
    const token = await playgroundApi.embedToken('session-1')
    expect(token.token).toBe('aaa.bbb.ccc')
    expect(token.appKey).toBe('acme-demo')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ia/embed-token')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-1')
  })

  it('503(未配置私钥)→ PlaygroundApiError status=503', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 503, msg: '签名私钥未配置' }, 503))
    const err = await playgroundApi.embedToken('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlaygroundApiError)
    expect((err as PlaygroundApiError).status).toBe(503)
    expect((err as PlaygroundApiError).message).toContain('私钥')
  })

  it('401(会话无效)→ status=401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 401, msg: '未登录或演示会话无效' }, 401))
    const err = await playgroundApi.embedToken('bad').catch((e: unknown) => e)
    expect((err as PlaygroundApiError).status).toBe(401)
  })

  it('HTTP 200 但信封 code!==0 也按错误抛出(只认 code===0)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 10002, msg: '服务不可用' }, 200))
    const err = await playgroundApi.login('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlaygroundApiError)
    expect((err as PlaygroundApiError).code).toBe(10002)
  })

  it('网络错误(fetch reject)→ status=0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const err = await playgroundApi.login('x').catch((e: unknown) => e)
    expect((err as PlaygroundApiError).status).toBe(0)
  })

  it('非 JSON 响应体 → status 透传的错误', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }))
    const err = await playgroundApi.embedToken('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlaygroundApiError)
    expect((err as PlaygroundApiError).status).toBe(504)
  })
})
