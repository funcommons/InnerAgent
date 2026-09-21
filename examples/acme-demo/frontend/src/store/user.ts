import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserVO, UserCreditsVO } from '@/api/types'
import { http } from '@/api/request'
import { getUserCredits } from '@/api/user'

const ACCESS_TOKEN_KEY = 'acme-demo:access_token'
const REFRESH_TOKEN_KEY = 'acme-demo:refresh_token'
const USER_INFO_KEY = 'acme-demo:user_info'

function readStoredUserInfo(): UserVO | null {
  try {
    const raw = localStorage.getItem(USER_INFO_KEY)
    return raw ? (JSON.parse(raw) as UserVO) : null
  } catch {
    return null
  }
}

export const useUserStore = defineStore('user', () => {
  // State(accessToken/userInfo 均持久化,刷新后恢复 —— 回归 2026-09-20-01 F1)
  const userInfo = ref<UserVO | null>(readStoredUserInfo())
  const creditInfo = ref<UserCreditsVO | null>(null)
  const loading = ref(false)
  const accessToken = ref<string>(localStorage.getItem(ACCESS_TOKEN_KEY) || '')
  const refreshToken = ref<string>(localStorage.getItem(REFRESH_TOKEN_KEY) || '')
  /** 兼容保留(原账密登录验证码开关),轻登录恒为 false */
  const requireCaptcha = ref(false)

  // Getters
  const credits = computed(() => creditInfo.value?.balance ?? userInfo.value?.credits ?? 0)
  const userName = computed(() => userInfo.value?.name ?? '')
  const userAvatar = computed(() => userInfo.value?.avatar ?? '')
  const isLoggedIn = computed(() => !!accessToken.value && !!userInfo.value)
  const hasToken = computed(() => !!accessToken.value)

  // Token 持久化
  function persistTokens(access: string, refresh: string) {
    accessToken.value = access
    refreshToken.value = refresh
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, access)
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
    } catch { /* localStorage 不可用, 内存态兜底 */ }
  }

  function persistUserInfo(info: UserVO) {
    userInfo.value = info
    try {
      localStorage.setItem(USER_INFO_KEY, JSON.stringify(info))
    } catch { /* noop */ }
  }

  function clearAuth() {
    accessToken.value = ''
    refreshToken.value = ''
    userInfo.value = null
    requireCaptcha.value = false
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      localStorage.removeItem(USER_INFO_KEY)
    } catch { /* noop */ }
  }

  // Actions

  /**
   * 演示登录(宿主登录态替身;接入指南要求 embed token 只签给已认证用户)。
   * 调用宿主后端 POST /api/demo/login 建立真实服务端会话并持久化
   * (回归 2026-09-20-01 F2:此前纯本地造 token,后端一律 401)。
   * username 即宿主用户标识;后端为其分配稳定数字用户 ID(embed token sub)。
   * 生产实现必须替换为宿主真实鉴权体系。
   */
  async function login(username: string) {
    const name = username.trim()
    if (!name) {
      throw new Error('用户名不能为空')
    }
    const resp = await http.post<{ token: string; username: string; userId: number }>('/api/demo/login', { username: name })
    persistTokens(resp.token, '')
    persistUserInfo({
      id: String(resp.userId),
      name: resp.username,
      ops: true,
    } as UserVO)
    requireCaptcha.value = false
  }

  /** 会话过期后由守卫调用;登录态已持久化,通常无需重建 */
  async function fetchUserInfo() {
    if (userInfo.value) return
    const stored = readStoredUserInfo()
    if (stored && accessToken.value) {
      userInfo.value = stored
      return
    }
    clearAuth()
  }

  /** 登出:通知后端销毁服务端会话(尽力而为),随后清本地态 */
  async function logout() {
    try {
      await http.post('/api/demo/logout')
    } catch { /* 后端不可达也清本地态 */ }
    clearAuth()
  }

  /** 兼容 request.ts 401 刷新链;演示后端无 refresh,恒拒绝(触发 clearAuth 跳登录) */
  async function refreshAccessToken(): Promise<string> {
    if (!refreshToken.value) throw new Error('no refresh token')
    throw new Error('refresh not supported in demo')
  }

  async function fetchUserCredits() {
    try {
      creditInfo.value = await getUserCredits()
    } catch { /* 演示后端无此接口,静默 */ }
  }

  // ============ 登录心跳(兼容保留) ============
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  const HEARTBEAT_INTERVAL = 60_000

  /** 心跳保活:演示会话为服务端 opaque token,无需探活,仅兜底 token 被清的情形 */
  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (!accessToken.value) return
      // 无服务端探活端点,空转占位
    }, HEARTBEAT_INTERVAL)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  return {
    // State
    userInfo,
    creditInfo,
    loading,
    accessToken,
    refreshToken,
    requireCaptcha,

    // Getters
    credits,
    userName,
    userAvatar,
    isLoggedIn,
    hasToken,

    // Actions
    fetchUserInfo,
    fetchUserCredits,
    login,
    logout,
    refreshAccessToken,
    clearAuth,
    startHeartbeat,
    stopHeartbeat,
  }
})
