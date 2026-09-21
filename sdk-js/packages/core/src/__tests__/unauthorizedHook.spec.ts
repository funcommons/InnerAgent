/**
 * [new] onUnauthorized 事件钩子测试 (P4/W15 iframe 模式的配套基建)。
 *
 * 契约: HTTP 层与 SSE 层每收到一次 401 响应, 先触发 onUnauthorized 钩子
 * (iframe 桥的 child 端借此失效本地 token 缓存, 下次 tokenGetter 经消息桥
 * 向宿主请求新 token), 再走既有的 401 懒换单飞重试。钩子异常不影响重试链路。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, resetSdkConfig } from '../config'
import { http, resetTokenRefreshSingleFlight } from '../client'
import { authenticatedFetch } from '../sseAuth'
import { setAssistantEventHooks } from '../store/assistantEvents'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe('sdk-core onUnauthorized 钩子 (401 通知)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    setAssistantEventHooks(undefined)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    setAssistantEventHooks(undefined)
  })

  it('HTTP 层: 401 响应触发 onUnauthorized, 之后 tokenGetter 重取并重试成功', async () => {
    const onUnauthorized = vi.fn()
    setAssistantEventHooks({ onUnauthorized })
    const tokenGetter = vi.fn()
      .mockResolvedValueOnce('stale-tok')
      .mockResolvedValue('fresh-tok')
    init({ appKey: 'demo', tokenGetter: tokenGetter as unknown as () => Promise<string | null> })

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 10200, msg: '未登录' }))
      .mockResolvedValueOnce(jsonResponse(200, { code: 0, data: 'ok' }))

    await expect(http.get('/conversations')).resolves.toBe('ok')

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(tokenGetter.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('SSE 层: authenticatedFetch 收到 401 同样先触发钩子再懒换重试', async () => {
    const onUnauthorized = vi.fn()
    setAssistantEventHooks({ onUnauthorized })
    const tokenGetter = vi.fn()
      .mockResolvedValueOnce('stale-tok')
      .mockResolvedValue('fresh-tok')
    init({ appKey: 'demo', tokenGetter: tokenGetter as unknown as () => Promise<string | null> })

    const okResponse = jsonResponse(200, {})
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 10200, msg: '未登录' }))
      .mockResolvedValueOnce(okResponse)

    const response = await authenticatedFetch('/ia/api/v1/runs/1/events')

    expect(response).toBe(okResponse)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('钩子异常不影响 401 懒换重试链路', async () => {
    setAssistantEventHooks({ onUnauthorized: () => { throw new Error('hook boom') } })
    const tokenGetter = vi.fn()
      .mockResolvedValueOnce('stale-tok')
      .mockResolvedValue('fresh-tok')
    init({ appKey: 'demo', tokenGetter: tokenGetter as unknown as () => Promise<string | null> })

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 10200, msg: '未登录' }))
      .mockResolvedValueOnce(jsonResponse(200, { code: 0, data: 'ok' }))

    await expect(http.get('/conversations')).resolves.toBe('ok')
  })

  it('非 401 响应不触发钩子; 未注入时默认 no-op 不炸', async () => {
    const onUnauthorized = vi.fn()
    setAssistantEventHooks({ onUnauthorized })
    init({ appKey: 'demo', tokenGetter: async () => 'tok-1' })
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: null }))

    await http.get('/conversations')

    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
