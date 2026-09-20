/**
 * [new] 管理站会话 store。
 * 持久化: sessionStorage(管理站会话不跨浏览器生命周期,与 $SRC localStorage 策略相异,
 * 属安全默认收敛)。登录后把 key 注入 request 层(X-IA-Admin-Key 头)。
 */
import { defineStore } from 'pinia'
import { adminAuthApi } from '@/api/auth'
import { setAdminKeyGetter, setUnauthorizedHandler } from '@/api/request'

const STORAGE_KEY = 'ia:admin-key'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    adminKey: '',
    loggedIn: false,
  }),
  getters: {
    isAuthenticated: (state) => state.loggedIn && state.adminKey.length > 0,
  },
  actions: {
    /** 从 sessionStorage 恢复会话并挂载请求头注入(应用启动时调用) */
    restore() {
      try {
        this.adminKey = sessionStorage.getItem(STORAGE_KEY) || ''
      } catch {
        this.adminKey = ''
      }
      this.loggedIn = this.adminKey.length > 0
      setAdminKeyGetter(() => this.adminKey)
      setUnauthorizedHandler(() => this.handleUnauthorized())
    },
    async login(adminKey: string) {
      const resp = await adminAuthApi.login({ adminKey })
      this.adminKey = adminKey
      this.loggedIn = true
      try {
        sessionStorage.setItem(STORAGE_KEY, adminKey)
      } catch { /* noop */ }
      return resp
    },
    async logout() {
      try { await adminAuthApi.logout() } catch { /* 登出失败不阻断本地清理 */ }
      this.clearLocal()
    },
    /** 401/凭据失效统一出口:清本地态,由路由守卫跳登录 */
    handleUnauthorized() {
      this.clearLocal()
    },
    clearLocal() {
      this.adminKey = ''
      this.loggedIn = false
      try {
        sessionStorage.removeItem(STORAGE_KEY)
      } catch { /* noop */ }
    },
  },
})
