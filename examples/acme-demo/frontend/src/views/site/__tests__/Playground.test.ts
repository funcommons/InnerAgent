import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import Playground from '@/views/site/Playground.vue'
import { PlaygroundApiError } from '@/api/playground'

/**
 * API 体验台全流程:登录 → 签发 → claims 可视化 → 倒计时 → 控制台入口;
 * 失败态(503 未配置私钥 / 401 / 网络)给差异化指引。
 * api 层 mock(体验台客户端为 fetch 直连,不触 axios)。
 */
const loginMock = vi.fn()
const embedTokenMock = vi.fn()

vi.mock('@/api/playground', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/playground')>()
  return {
    ...actual,
    playgroundApi: {
      login: (...args: unknown[]) => loginMock(...args),
      embedToken: (...args: unknown[]) => embedTokenMock(...args),
    },
  }
})

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeJwt(payload: object): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.signature`
}

const OK_TOKEN = makeJwt({
  iss: 'acme-demo',
  sub: '10086',
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + 12 * 3600,
})

const EXPIRED_TOKEN = makeJwt({ iss: 'acme-demo', sub: '10086', exp: Math.floor(Date.now() / 1000) - 10 })

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/ia/overview', component: { template: '<div />' } },
    ],
  })
}

async function mountPlayground() {
  const router = createTestRouter()
  const wrapper = mount(Playground, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper }
}

async function submitUsername(wrapper: Awaited<ReturnType<typeof mountPlayground>>['wrapper'], name = 'alice') {
  await wrapper.find('[data-testid="pg-username"]').setValue(name)
  await wrapper.find('[data-testid="pg-submit"]').trigger('click')
  await flushPromises()
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  loginMock.mockResolvedValue({ token: 'session-1', username: 'alice', userId: 10086 })
  embedTokenMock.mockResolvedValue({ token: OK_TOKEN, expiresIn: 43200, appKey: 'acme-demo' })
})

describe('Playground(成功流:登录 → 签发 → claims → 倒计时)', () => {
  it('提交用户名后依次调 login 与 embedToken(Bearer 会话 token)', async () => {
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)
    expect(loginMock).toHaveBeenCalledWith('alice')
    expect(embedTokenMock).toHaveBeenCalledWith('session-1')
    wrapper.unmount()
  })

  it('claims 可视化:分色原文 + iss/sub/appKey/倒计时/原始 token/控制台入口', async () => {
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)

    expect(wrapper.find('[data-testid="pg-signed-ok"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="claims-viewer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="claims-payload"]').text()).toContain('acme-demo')
    expect(wrapper.find('[data-testid="pg-sub"]').text()).toBe('10086')
    expect(wrapper.find('[data-testid="pg-appkey"]').text()).toBe('acme-demo')
    // 倒计时 hh:mm:ss 形态且未过期
    const countdown = wrapper.find('[data-testid="pg-countdown"]')
    expect(countdown.classes()).not.toContain('is-expired')
    expect(countdown.text()).toMatch(/\d{2}:\d{2}:\d{2}/)
    // 原始 token 可复制块
    expect(wrapper.text()).toContain('signature')
    // 控制台入口
    expect(wrapper.find('[data-testid="pg-console"]').attributes('href')).toBe('/ia/overview')
    wrapper.unmount()
  })

  it('过期 token:倒计时位显示已过期态', async () => {
    embedTokenMock.mockResolvedValue({ token: EXPIRED_TOKEN, expiresIn: 0, appKey: 'acme-demo' })
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)
    expect(wrapper.find('[data-testid="pg-countdown"]').classes()).toContain('is-expired')
    wrapper.unmount()
  })
})

describe('Playground(失败态与守卫)', () => {
  it('503 未配置私钥:错误卡 + 配置指引(openssl 命令),不弹重试', async () => {
    embedTokenMock.mockRejectedValue(new PlaygroundApiError('签名私钥未配置', 503, 503))
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)
    expect(wrapper.find('[data-testid="pg-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pg-fix-title"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pg-error"]').text()).toContain('openssl')
    expect(wrapper.find('[data-testid="pg-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('网络不通(503 之外):给出后端启动提示并可重试', async () => {
    embedTokenMock.mockRejectedValue(new PlaygroundApiError('fetch failed', 0))
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)
    expect(wrapper.find('[data-testid="pg-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pg-error-detail"]').text()).toContain('fetch failed')
    expect(wrapper.find('[data-testid="pg-retry"]').exists()).toBe(true)
    // 修复后重试成功
    embedTokenMock.mockResolvedValue({ token: OK_TOKEN, expiresIn: 43200, appKey: 'acme-demo' })
    await wrapper.find('[data-testid="pg-retry"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-testid="pg-signed-ok"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('login 失败(401)也进错误态', async () => {
    loginMock.mockRejectedValue(new PlaygroundApiError('会话无效', 401, 401))
    const { wrapper } = await mountPlayground()
    await submitUsername(wrapper)
    expect(wrapper.find('[data-testid="pg-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pg-retry"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('空用户名不可提交', async () => {
    const { wrapper } = await mountPlayground()
    expect(wrapper.find('[data-testid="pg-submit"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="pg-username"]').setValue('   ')
    expect(wrapper.find('[data-testid="pg-submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
