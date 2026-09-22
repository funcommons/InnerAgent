import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import { createI18n } from 'vue-i18n'
import Overview from '@/views/ia/Overview.vue'
import zhCN from '@/locales/zh-CN'

/**
 * 接入总览(/ia/overview):能力覆盖地图(中台能力 ↔ DEMO 体验入口)。
 * 覆盖验收口径(2026-09-22 盘点):每行要么有站内体验链接,要么标注「内核保障」;
 * 链接只落 demo 站内路由(嵌入/工具/管理台嵌入/体验台),管理台行统一指向 /ia/admin。
 */

const configMock = vi.fn()
const statusMock = vi.fn()
vi.mock('@/api/demo', () => ({
  demoApi: { config: (...args: unknown[]) => configMock(...args) },
}))
vi.mock('@/api/ia', () => ({
  fetchIaServerStatus: (...args: unknown[]) => statusMock(...args),
}))

function createTestRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/ia/overview', component: Overview },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
}

async function mountOverview() {
  const router = createTestRouter()
  const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
  const w = mount(Overview, { global: { plugins: [router, i18n] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  vi.clearAllMocks()
  configMock.mockResolvedValue({ appKey: 'acme-demo', agentType: 'ticket-assistant', inneragentBaseUrl: 'http://localhost:18090' })
  statusMock.mockResolvedValue({ state: 'registered', signKeyFingerprint: '39780d49' })
})

describe('Overview(接入总览)能力覆盖地图', () => {
  it('覆盖表渲染:每行要么有站内体验链接,要么标注内核保障', async () => {
    const { w } = await mountOverview()
    const table = w.find('[data-testid="capability-coverage"]')
    expect(table.exists()).toBe(true)
    const rows = table.findAll('[data-testid="coverage-row"]')
    expect(rows.length).toBeGreaterThanOrEqual(16)
    for (const row of rows) {
      const hasLink = row.find('[data-testid="coverage-link"]').exists()
      const annotated = row.text().includes('内核保障')
      expect(hasLink || annotated).toBe(true)
    }
    w.unmount()
  })

  it('覆盖表链接只落 demo 站内路由(嵌入/工具/管理台嵌入/体验台)', async () => {
    const { w } = await mountOverview()
    const allowed = ['/ia/embed', '/ia/tools', '/ia/admin', '/playground']
    const links = w.findAll('[data-testid="coverage-link"]')
    expect(links.length).toBeGreaterThan(10)
    for (const link of links) {
      expect(allowed.some((p) => (link.attributes('href') ?? '').startsWith(p))).toBe(true)
    }
    w.unmount()
  })

  it('盘点核实项在表内:管理台嵌入(不做 SSO)、用户授权 Tab、SSE 断点续传口径', async () => {
    const { w } = await mountOverview()
    const text = w.get('[data-testid="capability-coverage"]').text()
    expect(text).toContain('管理台整站')
    expect(text).toContain('用户授权')
    expect(text).toContain('SSE 断点续传')
    expect(text).toContain('内核保障')
    w.unmount()
  })
})
