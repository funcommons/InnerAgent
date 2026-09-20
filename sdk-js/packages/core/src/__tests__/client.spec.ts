/**
 * [new] HTTP client 测试 — tokenGetter 懒换 (任务 P1-T3a 验收点 4):
 * - Bearer 注入: tokenGetter 返回值 → Authorization 头; null → 不带头
 * - 过期懒换: 401 → **再次调用 tokenGetter** → 用新 token 重试一次
 * - 单飞: 并发 401 只调用一次 tokenGetter
 * - 宿主返回 null: 不重试, 按 401 抛错
 * - CommonResult 信封解包 / 业务错误 → ApiError / X-Trace-Id 透传
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, resetSdkConfig } from '../config'
import { http, resetTokenRefreshSingleFlight } from '../client'
import { ApiError } from '../errorCodes'

const HTTP_401 = 401

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function callOf(fn: { mock: { calls?: unknown[][] } }, index: number): unknown[] {
  const call = fn.mock.calls?.[index]
  expect(call).toBeDefined()
  return call as unknown[]
}

describe('sdk-core client (tokenGetter 懒换)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let tokenGetter: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    sessionStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    tokenGetter = vi.fn(async () => 'tok-1')
    init({ appKey: 'demo', tokenGetter: tokenGetter as unknown as () => Promise<string | null> })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
  })

  it('Bearer 注入: tokenGetter 返回 token → Authorization: Bearer; X-Trace-Id 携带', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: { ok: 1 } }))
    await http.get('/conversations')
    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/conversations')
    expect(new Headers(req.headers).get('authorization')).toBe('Bearer tok-1')
    expect(new Headers(req.headers).get('x-trace-id')).toBeTruthy()
  })

  it('tokenGetter 返回 null → 不带 Authorization 头 (匿名/演示联调)', async () => {
    tokenGetter.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: null }))
    await http.get('/conversations')
    const [, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(new Headers(req.headers).get('authorization')).toBeNull()
  })

  it('过期懒换: 401 → 再次调用 tokenGetter → 新 token 重试一次 → 成功', async () => {
    // 首次给过期 token; 401 后 tokenGetter 被再次调用, 返回新 token
    tokenGetter.mockResolvedValueOnce('stale-tok')
      .mockResolvedValueOnce('fresh-tok') // 懒换重取
      .mockResolvedValue('fresh-tok') // 重试请求取 token
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 10200, msg: '未登录' }))
      .mockResolvedValueOnce(jsonResponse(200, { code: 0, data: 'done' }))

    const result = await http.get<string>('/conversations/1')

    expect(result).toBe('done')
    // tokenGetter: 首请求 1 次 + 单飞重取 1 次 + 重试请求 1 次 = 3 次调用, 且产出新 token
    expect(tokenGetter.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retryAuth = new Headers((callOf(fetchMock, 1)[1] as RequestInit).headers).get('authorization')
    expect(retryAuth).toBe('Bearer fresh-tok')
  })

  it('懒换只重试一次: 重试仍 401 → 抛 ApiError(401), 不再刷新', async () => {
    tokenGetter.mockResolvedValue('expired-tok')
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 10200, msg: '未登录' }))

    await expect(http.get('/me/models')).rejects.toMatchObject({
      code: HTTP_401,
      status: HTTP_401,
    } as Partial<ApiError>)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('并发 401 → 单飞: tokenGetter 懒换只执行一轮, 两个请求都换到新 token', async () => {
    tokenGetter.mockImplementation(async () => {
      // 模拟宿主异步签发: 前 2 次请求 (fetch 记录数 <2) 给旧 token;
      // 401 触发的懒换重取 (此时已有 2 次 fetch 记录) 给新 token
      await Promise.resolve()
      return fetchMock.mock.calls.length < 2 ? 'stale-tok' : 'fresh-tok'
    })
    fetchMock
      .mockImplementationOnce(async () => jsonResponse(401, { code: 10200 }))
      .mockImplementationOnce(async () => jsonResponse(401, { code: 10200 }))
      .mockResolvedValue(jsonResponse(200, { code: 0, data: 'ok' }))

    const [a, b] = await Promise.all([http.get('/runs/running'), http.get('/runs/running')])
    expect([a, b]).toEqual(['ok', 'ok'])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const auths = [0, 1, 2, 3].map((i) =>
      new Headers((callOf(fetchMock, i)[1] as RequestInit).headers).get('authorization'))
    // 前两次 = 旧 token; 重试两次 = 同一轮懒换的新 token
    expect(auths).toEqual(['Bearer stale-tok', 'Bearer stale-tok', 'Bearer fresh-tok', 'Bearer fresh-tok'])
  })

  it('宿主 401 后返回 null → 不重试, 抛 ApiError 401', async () => {
    tokenGetter.mockResolvedValueOnce('stale-tok').mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 10200, msg: '未登录' }))

    await expect(http.get('/conversations')).rejects.toThrow('未登录')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('sdk-core client (信封与错误)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    init({ appKey: 'demo', tokenGetter: async () => 'tok' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
  })

  it('CommonResult code===0 → 返回 data; 无 code 信封 → 原样返回', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: [1, 2] }))
    await expect(http.get('/x')).resolves.toEqual([1, 2])
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { foo: 'bar' }))
    await expect(http.get('/x')).resolves.toEqual({ foo: 'bar' })
  })

  it('业务错误 code!==0 → ApiError(code, msg||message)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 50001, msg: '工具不存在' }))
    const error = await http.get('/x').catch((e: unknown) => e) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe(50001)
    expect(error.message).toBe('工具不存在')
  })

  it('HTTP 500 + 响应体 message → ApiError(500)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: '内部炸了' }))
    const error = await http.get('/x').catch((e: unknown) => e) as ApiError
    expect(error.status).toBe(500)
    expect(error.message).toBe('内部炸了')
  })

  it('POST JSON body 序列化 + FormData 不覆盖 Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: null }))
    await http.post('/runs/cancel', { conversationId: 'c1' })
    let [, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(req.body).toBe(JSON.stringify({ conversationId: 'c1' }))
    expect(new Headers(req.headers).get('content-type')).toBe('application/json')

    const form = new FormData()
    form.append('file', new Blob(['x']), 'a.png')
    await http.post('/attachments', form)
    const [, formReq] = callOf(fetchMock, 1) as [string, RequestInit]
    expect(new Headers(formReq.headers).get('content-type')).toBeNull()
  })

  it('响应头 X-Trace-Id 回写 sessionStorage (链路串联)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: null }, { 'x-trace-id': 'trace-9' }))
    await http.get('/x')
    expect(sessionStorage.getItem('inneragent:trace-id')).toBe('trace-9')
  })
})
