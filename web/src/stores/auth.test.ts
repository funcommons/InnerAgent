/**
 * [new] auth store 测试(DEF-01 修复后契约):
 * - login 发 {username,password},成功保存 Bearer token 至 localStorage;
 * - 401(凭据错误)/ 423(锁定)不落登录态;
 * - 引导模式 loginWithAdminKey 走 sessionStorage(X-IA-Admin-Key 通道);
 * - restore 恢复、logout 清理、过期判定、401 出口。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http as mswHttp, HttpResponse } from 'msw'
import { useAuthStore } from './auth'
import { server } from '@/mocks/server'

const loginOk = (username: string) =>
  HttpResponse.json({
    code: 0,
    msg: 'success',
    data: {
      token: `token-for-${username}`,
      tokenType: 'Bearer',
      expiresInSeconds: 14400,
      username,
    },
  })

/** Node 24 测试环境下实验性 localStorage 全局不可用(--localstorage-file 未启用),
 * 会遮蔽 jsdom 实现;用内存桩替代,同时供产品代码与断言读写。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getLength: () => map.size,
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
  } as unknown as Storage
}

describe('auth store (DEF-01:账号密码 + Bearer 会话)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('login 发送 {username,password} 请求体(占位 adminKey 契约已废弃),成功保存 token', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      mswHttp.post('/ia/api/v1/admin/auth/login', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return loginOk('admin')
      }),
    )
    const auth = useAuthStore()
    const resp = await auth.login('admin', 'Admin#12345')

    expect(capturedBody).toEqual({ username: 'admin', password: 'Admin#12345' })
    expect('adminKey' in (capturedBody ?? {})).toBe(false)
    expect(resp.tokenType).toBe('Bearer')
    expect(resp.token).toBe('token-for-admin')
    expect(resp.expiresInSeconds).toBeGreaterThan(0)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.token).toBe('token-for-admin')
    expect(auth.username).toBe('admin')
    // token 持久化 localStorage + 过期时间落库
    expect(localStorage.getItem('ia:admin-token')).toBe('token-for-admin')
    expect(Number(localStorage.getItem('ia:admin-token-expires-at'))).toBeGreaterThan(Date.now())
  })

  it('login 空凭据被拒(400)且不落登录态', async () => {
    const auth = useAuthStore()
    await expect(auth.login('', 'pw')).rejects.toMatchObject({ code: 400 })
    expect(auth.isAuthenticated).toBe(false)
    expect(localStorage.getItem('ia:admin-token')).toBeNull()
  })

  it('401 凭据错误 → 抛 ApiError(401),不落登录态', async () => {
    server.use(
      mswHttp.post('/ia/api/v1/admin/auth/login', () =>
        HttpResponse.json({ code: 401, msg: '用户名或密码错误', data: null }, { status: 401 })),
    )
    const auth = useAuthStore()
    const err = await auth.login('admin', 'wrong').catch((e: unknown) => e as { status?: number })
    expect(err).toMatchObject({ status: 401 })
    expect(auth.isAuthenticated).toBe(false)
  })

  it('423 锁定 → 抛 ApiError(423),透出服务端剩余秒数文案', async () => {
    server.use(
      mswHttp.post('/ia/api/v1/admin/auth/login', () =>
        HttpResponse.json(
          { code: 423, msg: '账号已锁定,请 600 秒后重试', data: null },
          { status: 423 },
        )),
    )
    const auth = useAuthStore()
    const err = await auth.login('admin', 'Admin#12345').catch((e: unknown) => e as { status?: number; message?: string })
    expect(err).toMatchObject({ status: 423 })
    expect((err as { message?: string }).message).toContain('600 秒')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('loginWithAdminKey 引导通道:写 sessionStorage,不产生 token', async () => {
    const auth = useAuthStore()
    await auth.loginWithAdminKey('boot-key')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.adminKey).toBe('boot-key')
    expect(auth.token).toBe('')
    expect(sessionStorage.getItem('ia:admin-key')).toBe('boot-key')
    await expect(auth.loginWithAdminKey('')).rejects.toThrow('管理 Key 不能为空')
  })

  it('restore 恢复 token 与引导 Key 并挂载请求层注入', () => {
    localStorage.setItem('ia:admin-token', 'restored-token')
    localStorage.setItem('ia:admin-token-expires-at', String(Date.now() + 60_000))
    sessionStorage.setItem('ia:admin-key', 'restored-key')
    const auth = useAuthStore()
    auth.restore()
    expect(auth.token).toBe('restored-token')
    expect(auth.adminKey).toBe('restored-key')
    expect(auth.isAuthenticated).toBe(true)
  })

  it('logout 清空 token/引导 Key 与两侧存储', async () => {
    const auth = useAuthStore()
    await auth.login('admin', 'Admin#12345')
    await auth.loginWithAdminKey('boot-key')
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBe('')
    expect(auth.adminKey).toBe('')
    expect(localStorage.getItem('ia:admin-token')).toBeNull()
    expect(localStorage.getItem('ia:admin-token-expires-at')).toBeNull()
    expect(sessionStorage.getItem('ia:admin-key')).toBeNull()
  })

  it('isAuthenticated 随 token 过期失效(本地过期判定)', () => {
    const auth = useAuthStore()
    auth.loggedIn = true
    auth.token = 't'
    auth.tokenExpiresAt = Date.now() - 1
    expect(auth.isAuthenticated).toBe(false)
    auth.tokenExpiresAt = Date.now() + 60_000
    expect(auth.isAuthenticated).toBe(true)
    // 无时效(0)时仅依赖 401 出口
    auth.tokenExpiresAt = 0
    expect(auth.isAuthenticated).toBe(true)
  })

  it('handleUnauthorized 仅清本地态(供 401/403 出口调用)', () => {
    const auth = useAuthStore()
    auth.loginWithAdminKey('x')
    auth.handleUnauthorized()
    expect(auth.isAuthenticated).toBe(false)
  })
})
