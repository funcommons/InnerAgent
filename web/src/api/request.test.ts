/**
 * [new] request 层测试:信封解包 / ApiError 归一 / X-IA-Admin-Key 注入 /
 * 401 出口 / trace 与幂等头。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { http, setAdminKeyGetter, setUnauthorizedHandler } from './request'
import { ApiError, ApiErrorCode } from './errorCodes'
import { server } from '@/mocks/server'

describe('request 层', () => {
  beforeEach(() => {
    setAdminKeyGetter(() => 'test-key-123')
    setUnauthorizedHandler(null)
  })

  it('信封 code===0 时解包 data', async () => {
    server.use(
      mswHttp.get('http://local.test/echo', () =>
        HttpResponse.json({ code: 0, data: { hello: 'world' } })),
    )
    await expect(http.get<{ hello: string }>('http://local.test/echo')).resolves.toEqual({ hello: 'world' })
  })

  it('无信封的裸响应原样返回', async () => {
    server.use(
      mswHttp.get('http://local.test/raw', () => HttpResponse.json({ foo: 1 })),
    )
    await expect(http.get<{ foo: number }>('http://local.test/raw')).resolves.toEqual({ foo: 1 })
  })

  it('业务错误归一为 ApiError(code/message/details)', async () => {
    server.use(
      mswHttp.get('http://local.test/biz-err', () =>
        HttpResponse.json({
          code: 10401,
          message: '名称已存在',
          error: [{ field: 'name', code: 'DUPLICATED', message: '名称已存在', rejectedValue: 'a' }],
        })),
    )
    const err = await http.get('http://local.test/biz-err').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.code).toBe(10401)
    expect(apiErr.message).toBe('名称已存在')
    expect(apiErr.isBusinessError()).toBe(true)
    expect(apiErr.details?.[0]?.field).toBe('name')
  })

  it('HTTP 错误归一为带 status 的 ApiError,且透出后端 message', async () => {
    server.use(
      mswHttp.get('http://local.test/http-err', () =>
        HttpResponse.json({ code: 10400, message: '应用不存在' }, { status: 404 })),
    )
    const err = await http.get('http://local.test/http-err').catch((e: unknown) => e)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(404)
    expect(apiErr.message).toBe('应用不存在')
    expect(apiErr.isHttpError()).toBe(true)
  })

  it('GET 请求携带 X-IA-Admin-Key 与 X-Trace-Id 头', async () => {
    let captured: Request | null = null
    server.use(
      mswHttp.get('http://local.test/headers', ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, data: null })
      }),
    )
    await http.get('http://local.test/headers')
    expect(captured).not.toBeNull()
    expect(captured!.headers.get('X-IA-Admin-Key')).toBe('test-key-123')
    const traceId = captured!.headers.get('X-Trace-Id')
    expect(traceId).toBeTruthy()
  })

  it('POST 请求 JSON 序列化并携带 Idempotency-Key', async () => {
    let captured: Request | null = null
    server.use(
      mswHttp.post('http://local.test/submit', async ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, data: null })
      }),
    )
    await http.post('http://local.test/submit', { a: 1 })
    expect(captured!.headers.get('Content-Type')).toContain('application/json')
    expect(captured!.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await captured!.json()).toEqual({ a: 1 })
  })

  it('HTTP 401 触发 unauthorizedHandler', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(
      mswHttp.get('http://local.test/need-auth', () =>
        HttpResponse.json({ code: ApiErrorCode.ADMIN_KEY_INVALID, message: '缺少 X-IA-Admin-Key' }, { status: 401 })),
    )
    await expect(http.get('http://local.test/need-auth')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('网络错误归一为 code=0 的 ApiError', async () => {
    server.use(
      mswHttp.get('http://local.test/network-err', () => HttpResponse.error()),
    )
    const err = await http.get('http://local.test/network-err').catch((e: unknown) => e)
    const apiErr = err as ApiError
    expect(apiErr.code).toBe(0)
    expect(apiErr.message).toContain('网络错误')
  })
})
