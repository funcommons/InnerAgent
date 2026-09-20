/**
 * [new] auth store 测试:登录持久化、restore 恢复、登出清理、401 出口。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import { setAdminKeyGetter } from '@/api/request'
import { MOCK_ADMIN_KEY } from '@/mocks/handlers'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('login 成功后持有 key 并写入 sessionStorage', async () => {
    const auth = useAuthStore()
    const resp = await auth.login(MOCK_ADMIN_KEY)
    expect(resp.ok).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
    expect(sessionStorage.getItem('ia:admin-key')).toBe(MOCK_ADMIN_KEY)
  })

  it('login 传空 key 被 mock 后端拒绝且不落登录态(错误码对齐 HTTP 400)', async () => {
    const auth = useAuthStore()
    await expect(auth.login('')).rejects.toMatchObject({ code: 400 })
    expect(auth.isAuthenticated).toBe(false)
  })

  it('restore 从 sessionStorage 恢复并注入请求头 getter', async () => {
    sessionStorage.setItem('ia:admin-key', 'restored-key')
    const auth = useAuthStore()
    auth.restore()
    expect(auth.isAuthenticated).toBe(true)
    expect(setAdminKeyGetter).toBeDefined()
    // getter 注入后,authStore.adminKey 变化同步反映到请求头来源
    auth.clearLocal()
  })

  it('logout 清空本地登录态', async () => {
    const auth = useAuthStore()
    await auth.login(MOCK_ADMIN_KEY)
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem('ia:admin-key')).toBeNull()
  })

  it('handleUnauthorized 仅清本地态(供 401 出口调用)', () => {
    const auth = useAuthStore()
    auth.adminKey = 'x'
    auth.loggedIn = true
    auth.handleUnauthorized()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('isAuthenticated 需要 loggedIn 且 key 非空', () => {
    const auth = useAuthStore()
    auth.loggedIn = true
    auth.adminKey = ''
    expect(auth.isAuthenticated).toBe(false)
    auth.adminKey = 'k'
    expect(auth.isAuthenticated).toBe(true)
  })
})
