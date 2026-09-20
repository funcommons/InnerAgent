/**
 * [new] 管理站会话 store(DEF-01 修复:对齐服务端 18a 账号密码登录契约)。
 *
 * 凭据双轨(服务端 AdminTokenFilter):
 * - 主通道:username/password → POST /admin/auth/login → Bearer 会话 token。
 *   token 持久化于 localStorage(管理站会话跨标签页/浏览器重启复用,
 *   服务端侧由 expiresInSeconds + jti 吊销控制时效);
 * - 引导/自动化通道:X-IA-Admin-Key,sessionStorage 持久化(不跨浏览器生命周期),
 *   作为登录页「高级 → 引导模式」入口保留(e2e 预置会话等自动化场景依赖)。
 *
 * 请求层注入见 api/request.ts(仅对 /ia/api/v1/admin 域请求生效):
 * Bearer 优先;Bearer 缺席时回退 X-IA-Admin-Key。401/403 统一经
 * unauthorizedHandler 清登录态,由路由守卫跳登录。
 */
import { defineStore } from 'pinia'
import { adminAuthApi } from '@/api/auth'
import type { AdminLoginResp } from '@/api/auth'
import { setAdminKeyGetter, setAuthTokenGetter, setUnauthorizedHandler } from '@/api/request'

const TOKEN_STORAGE_KEY = 'ia:admin-token'
const TOKEN_EXPIRES_AT_KEY = 'ia:admin-token-expires-at'
const ADMIN_KEY_STORAGE_KEY = 'ia:admin-key'

function readStorage(storage: Storage, key: string): string {
  try {
    return storage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch { /* noop */ }
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key)
  } catch { /* noop */ }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** 管理会话 Bearer token(主通道) */
    token: '',
    /** token 过期时间(epoch ms;0 = 服务端未给时效,仅依赖 401 出口) */
    tokenExpiresAt: 0,
    /** 登录管理员用户名(展示用) */
    username: '',
    /** 引导模式管理 Key(自动化通道,登录页高级折叠项) */
    adminKey: '',
    loggedIn: false,
  }),
  getters: {
    isAuthenticated: (state) => {
      if (!state.loggedIn) return false
      if (state.adminKey) return true
      if (!state.token) return false
      return state.tokenExpiresAt === 0 || state.tokenExpiresAt > Date.now()
    },
  },
  actions: {
    /** 从本地存储恢复会话并挂载请求头注入(应用启动时调用) */
    restore() {
      this.token = readStorage(localStorage, TOKEN_STORAGE_KEY)
      this.tokenExpiresAt = Number(readStorage(localStorage, TOKEN_EXPIRES_AT_KEY)) || 0
      this.adminKey = readStorage(sessionStorage, ADMIN_KEY_STORAGE_KEY)
      this.loggedIn = Boolean(this.token || this.adminKey)
      setAuthTokenGetter(() => this.token)
      setAdminKeyGetter(() => this.adminKey)
      setUnauthorizedHandler(() => this.handleUnauthorized())
    },
    /** 账号密码登录(主通道):成功后保存 Bearer 会话 */
    async login(username: string, password: string): Promise<AdminLoginResp> {
      const resp = await adminAuthApi.login({ username, password })
      this.token = resp.token
      this.username = resp.username || username
      this.tokenExpiresAt = resp.expiresInSeconds > 0
        ? Date.now() + resp.expiresInSeconds * 1000
        : 0
      this.loggedIn = true
      writeStorage(localStorage, TOKEN_STORAGE_KEY, resp.token)
      writeStorage(localStorage, TOKEN_EXPIRES_AT_KEY, String(this.tokenExpiresAt))
      return resp
    },
    /** 引导模式登录(自动化通道):仅持管理 Key,走 X-IA-Admin-Key 请求头 */
    async loginWithAdminKey(adminKey: string): Promise<void> {
      if (!adminKey) throw new Error('管理 Key 不能为空')
      this.adminKey = adminKey
      this.loggedIn = true
      writeStorage(sessionStorage, ADMIN_KEY_STORAGE_KEY, adminKey)
    },
    async logout() {
      try { await adminAuthApi.logout() } catch { /* 登出失败不阻断本地清理 */ }
      this.clearLocal()
    },
    /** 401/403 凭据失效统一出口:清本地态,由路由守卫跳登录 */
    handleUnauthorized() {
      this.clearLocal()
    },
    clearLocal() {
      this.token = ''
      this.tokenExpiresAt = 0
      this.username = ''
      this.adminKey = ''
      this.loggedIn = false
      removeStorage(localStorage, TOKEN_STORAGE_KEY)
      removeStorage(localStorage, TOKEN_EXPIRES_AT_KEY)
      removeStorage(sessionStorage, ADMIN_KEY_STORAGE_KEY)
    },
  },
})
