/**
 * [new] request 层测试:信封解包 / ApiError 归一 / X-IA-Admin-Key 注入 /
 * 401/403 出口 / trace 与幂等头。
 * P2 对齐:服务端信封字段为 msg(CommonResult{code,msg,data});管理面凭据
 * 失效以 403 拒绝(AdminTokenFilter 缺省封闭)。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { http, setAdminKeyGetter, setAuthTokenGetter, setUnauthorizedHandler } from './request'
import { ApiError } from './errorCodes'
import { server } from '@/mocks/server'

describe('request 层', () => {
  beforeEach(() => {
    setAdminKeyGetter(() => 'test-key-123')
    setAuthTokenGetter(null)
    setUnauthorizedHandler(null)
  })

  it('信封 code===0 时解包 data', async () => {
    server.use(
      mswHttp.get('http://local.test/echo', () =>
        HttpResponse.json({ code: 0, msg: 'success', data: { hello: 'world' } })),
    )
    await expect(http.get<{ hello: string }>('http://local.test/echo')).resolves.toEqual({ hello: 'world' })
  })

  it('无信封的裸响应原样返回', async () => {
    server.use(
      mswHttp.get('http://local.test/raw', () => HttpResponse.json({ foo: 1 })),
    )
    await expect(http.get<{ foo: number }>('http://local.test/raw')).resolves.toEqual({ foo: 1 })
  })

  it('业务错误归一为 ApiError(读取信封 msg 字段;details 解析保留)', async () => {
    server.use(
      mswHttp.get('http://local.test/biz-err', () =>
        HttpResponse.json({
          code: 10401,
          msg: '名称已存在',
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

  it('HTTP 错误归一为带 status 的 ApiError,透出服务端 msg(错误码=HTTP 状态镜像)', async () => {
    server.use(
      mswHttp.get('http://local.test/http-err', () =>
        HttpResponse.json({ code: 404, msg: '应用不存在: 7', data: null }, { status: 404 })),
    )
    const err = await http.get('http://local.test/http-err').catch((e: unknown) => e)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(404)
    expect(apiErr.message).toBe('应用不存在: 7')
    expect(apiErr.isHttpError()).toBe(true)
  })

  it('GET 请求携带 X-IA-Admin-Key 与 X-Trace-Id 头(引导通道,admin 域)', async () => {
    let captured: Request | null = null
    server.use(
      mswHttp.get('/ia/api/v1/admin/headers', ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, msg: 'success', data: null })
      }),
    )
    await http.get('/ia/api/v1/admin/headers')
    expect(captured).not.toBeNull()
    expect(captured!.headers.get('X-IA-Admin-Key')).toBe('test-key-123')
    const traceId = captured!.headers.get('X-Trace-Id')
    expect(traceId).toBeTruthy()
  })

  it('[DEF-01] admin 域请求注入 Authorization: Bearer,且不双发 X-IA-Admin-Key', async () => {
    setAuthTokenGetter(() => 'session-token-1')
    let captured: Request | null = null
    server.use(
      mswHttp.get('/ia/api/v1/admin/apps', ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, msg: 'success', data: [] })
      }),
    )
    await http.get('/ia/api/v1/admin/apps')
    expect(captured!.headers.get('Authorization')).toBe('Bearer session-token-1')
    expect(captured!.headers.get('X-IA-Admin-Key')).toBeNull()
  })

  it('[DEF-01] 无会话 token 时 admin 域回退 X-IA-Admin-Key(引导通道)', async () => {
    setAuthTokenGetter(() => '')
    let captured: Request | null = null
    server.use(
      mswHttp.get('/ia/api/v1/admin/apps', ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, msg: 'success', data: [] })
      }),
    )
    await http.get('/ia/api/v1/admin/apps')
    expect(captured!.headers.get('Authorization')).toBeNull()
    expect(captured!.headers.get('X-IA-Admin-Key')).toBe('test-key-123')
  })

  it('[DEF-01] 非 admin 域请求不注入管理凭据', async () => {
    setAuthTokenGetter(() => 'session-token-1')
    let captured: Request | null = null
    server.use(
      mswHttp.get('http://local.test/echo', ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, msg: 'success', data: null })
      }),
    )
    await http.get('http://local.test/echo')
    expect(captured!.headers.get('Authorization')).toBeNull()
    expect(captured!.headers.get('X-IA-Admin-Key')).toBeNull()
  })

  it('POST 请求 JSON 序列化并携带 Idempotency-Key', async () => {
    let captured: Request | null = null
    server.use(
      mswHttp.post('http://local.test/submit', async ({ request }) => {
        captured = request
        return HttpResponse.json({ code: 0, msg: 'success', data: null })
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
        HttpResponse.json({ code: 401, msg: '未认证' }, { status: 401 })),
    )
    await expect(http.get('http://local.test/need-auth')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('HTTP 403(AdminTokenFilter 凭据拒绝)透出 msg 并触发 unauthorizedHandler', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(
      mswHttp.get('http://local.test/admin-only', () =>
        HttpResponse.json(
          { code: 403, msg: '管理面凭据无效:请携带 X-IA-Admin-Key 请求头', data: null },
          { status: 403 },
        )),
    )
    const err = await http.get('http://local.test/admin-only').catch((e: unknown) => e)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(403)
    expect(apiErr.message).toContain('X-IA-Admin-Key')
    expect(apiErr.isAuthError()).toBe(true)
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
