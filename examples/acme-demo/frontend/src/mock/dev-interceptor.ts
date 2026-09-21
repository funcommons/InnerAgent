import type { AxiosInstance } from 'axios'

/**
 * dev-only mock interceptor.
 *
 * 目的: 无后端时让前端独立可跑. 任意 phone/password 都返回 mock ops 用户,
 * OEM 配置返回 mchuan 主题. 仅 import.meta.env.DEV 生效, build 时被 Vite tree-shake.
 *
 * 安装位置: src/main.ts bootstrap, 在 setUserStoreGetter 之后, app.mount 之前.
 */

const MOCK_ACCESS = 'mock-access-token'
const MOCK_REFRESH = 'mock-refresh-token'
const MOCK_USER_ID = 'mock-user-001'

function buildMockUser(phone: string) {
  return {
    id: MOCK_USER_ID,
    userId: MOCK_USER_ID,
    phone: phone || '13800000000',
    real_name: 'Mock 用户',
    realName: 'Mock 用户',
    avatar: '',
    role: 'ops',
    ops: true,
    status: 1,
  }
}

function buildLoginResult(phone: string) {
  return {
    access_token: MOCK_ACCESS,
    refresh_token: MOCK_REFRESH,
    expires_in: 7200,
    token_type: 'Bearer',
    user: buildMockUser(phone),
  }
}

const OEM_MOCK = {
  logoUrl: '/logo.svg',
  logoDarkUrl: '',
  companyName: 'ACME 接入演示',
  title: 'ACME 接入演示',
  subtitle: 'InnerAgent 第三方接入演示',
  brand: 'ldx2',
  theme: 'light',
  primaryColor: '#f97316',
  locale: 'zh-CN',
  faviconUrl: '/logo.svg',
  footerText: '© ACME DEMO',
}

const CAPABILITIES_MOCK = {
  strategy: 'self-managed',
  supportsLogin: true,
  supportsRegister: false,
  requiresAuth: false,
  availableStrategies: ['self-managed'],
  captcha: { provider: 'off' },
}

const CAPTCHA_MOCK = {
  captchaId: 'mock-captcha',
  type: 'altcha',
  expiresIn: 600,
}

const CREDITS_MOCK = {
  balance: 9999,
  frozen: 0,
  total: 9999,
}

interface MockConfig {
  url?: string
  method?: string
  data?: unknown
  params?: Record<string, unknown>
}

function pickMockResponse(config: MockConfig): unknown | undefined {
  const url = config.url || ''
  const method = (config.method || 'get').toLowerCase()
  const data = (typeof config.data === 'string' ? safeParse(config.data) : config.data) as { phone?: string } | null

  // 公开 OEM 配置
  if (method === 'get' && url.startsWith('/api/v1/oem/config')) return OEM_MOCK

  // 自管理鉴权能力探测
  if (method === 'post' && url.endsWith('/api/v1/auth/capabilities')) return CAPABILITIES_MOCK

  // 验证码挑战 (mock 直接返回无需验证)
  if (method === 'post' && url.endsWith('/api/v1/auth/captcha')) return CAPTCHA_MOCK

  // 账密登录: 任意 phone/password 都返回 ops 用户
  if (method === 'post' && url.endsWith('/api/v1/auth/login')) {
    return buildLoginResult(data?.phone || '13800000000')
  }

  // 登出: 直接成功
  if (method === 'post' && url.endsWith('/api/v1/auth/logout')) return null

  // 刷新 token
  if (method === 'post' && url.endsWith('/api/v1/auth/refresh')) {
    return buildLoginResult('13800000000')
  }

  // 当前用户信息 (路由守卫 / heartbeat 调用)
  if (method === 'get' && (url.endsWith('/api/v1/users/me') || url.endsWith('/api/v1/user/me'))) {
    return buildMockUser('13800000000')
  }

  // 算力点数 (顶部 badge / 路由守卫 / 工作台)
  if (method === 'get' && url.includes('/api/v1/user/credits')) return CREDITS_MOCK

  return undefined
}

function safeParse(json: string): unknown {
  try { return JSON.parse(json) } catch { return null }
}

/**
 * 在 axios response 拦截器最前短路命中. 让真实业务代码零改动.
 */
export function installDevMock(instance: AxiosInstance): void {
  instance.interceptors.response.use((response) => {
    const mock = pickMockResponse(response.config as MockConfig)
    if (mock !== undefined) {
      // 用 Axios 包装一个伪 response, 让上层 unwrap 时拿到 mock 数据
      return { ...response, data: mock, status: 200, statusText: 'OK' } as typeof response
    }
    return response
  })
}
