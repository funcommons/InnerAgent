import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import { createI18n } from 'vue-i18n'
import AgentsGallery from '@/views/ia/AgentsGallery.vue'
import { DEMO_AGENTS, DEMO_CAPABILITIES, hasCapability } from '@/ia/demoAgents'
import zhCN from '@/locales/zh-CN'

/**
 * 场景画廊(/ia/agents):5 场景卡 + 能力×场景矩阵 + 剧本折叠 + 深链。
 * 挂真实 i18n(zh-CN)断言渲染文案;router 用 WebHistory 断言跳转与 href。
 */
function createTestRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/ia/agents', component: AgentsGallery },
      { path: '/ia/embed', component: { template: '<div />' } },
      { path: '/docs/:sectionId?', component: { template: '<div />' } },
    ],
  })
}

function mountGallery(router: Router) {
  const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
  return mount(AgentsGallery, { global: { plugins: [router, i18n] } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('AgentsGallery(场景画廊)', () => {
  it('开通提示条常显(不遮蔽页面),含 provision.sh 命令', () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    const hint = w.find('[data-testid="provision-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('seeds/provision.sh')
    // 页面主体未被遮蔽:5 张场景卡同时可见
    expect(w.findAll('article[data-testid^="agent-card-"]')).toHaveLength(5)
    w.unmount()
  })

  it('5 张场景卡:名称 / 一句场景 / 能力 chips(数量与契约一致)', () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    for (const a of DEMO_AGENTS) {
      const card = w.find(`[data-testid="agent-card-${a.agentType}"]`)
      expect(card.exists()).toBe(true)
      expect(card.text()).toContain(zhCN.ia.demo.agents[a.agentType].name)
      expect(card.text()).toContain(zhCN.ia.demo.agents[a.agentType].tagline)
      const chips = card.find('[data-testid="agent-chips"]')
      expect(chips.findAll('.fc-tag')).toHaveLength(a.capabilities.length)
    }
    w.unmount()
  })

  it('能力×场景矩阵:6 能力行 × 5 场景列,勾叉与 hasCapability 一致', () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    expect(w.find('[data-testid="capability-matrix"]').exists()).toBe(true)
    for (const cap of DEMO_CAPABILITIES) {
      for (const a of DEMO_AGENTS) {
        const cell = w.find(`[data-testid="matrix-${cap}-${a.agentType}"]`)
        expect(cell.exists()).toBe(true)
        const expected = hasCapability(a.agentType, cap)
        expect(cell.classes()).toContain(expected ? 'yes' : 'no')
        expect(cell.text()).toBe(expected ? '✓' : '✗')
      }
    }
    w.unmount()
  })

  it('「开始对话」→ /ia/embed?agentType=<场景>', async () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    await w.find('[data-testid="start-chat-ticket-assistant"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/ia/embed')
    expect(router.currentRoute.value.query.agentType).toBe('ticket-assistant')

    await w.find('[data-testid="start-chat-master-demo"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.agentType).toBe('master-demo')
    w.unmount()
  })

  it('剧本折叠:默认收起,展开见步骤,再点收起', async () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    const agent = DEMO_AGENTS[0]!.agentType
    // 断言 v-show 控制的内联 style(jsdom 的 getComputedStyle 缓存在移除
    // style 属性后不失效,isVisible() 会读到过期 display:none,故不走它)
    const styleOf = () => w.find(`[data-testid="script-steps-${agent}"]`).attributes('style') ?? ''
    expect(styleOf()).toContain('display: none')

    await w.find(`[data-testid="script-toggle-${agent}"]`).trigger('click')
    const steps = w.find(`[data-testid="script-steps-${agent}"]`)
    expect(steps.attributes('style') ?? '').not.toContain('display: none')
    // 步骤内容来自 i18n 剧本数组
    const script = zhCN.ia.demo.agents[agent].script as string[]
    expect(steps.text()).toContain(script[0]!.slice(0, 10))
    expect(steps.findAll('li')).toHaveLength(script.length)

    await w.find(`[data-testid="script-toggle-${agent}"]`).trigger('click')
    expect(w.find(`[data-testid="script-steps-${agent}"]`).attributes('style') ?? '').toContain('display: none')
    w.unmount()
  })

  it('文档深链:每卡「相关文档」指向 /docs/<docSectionId>', () => {
    const router = createTestRouter()
    const w = mountGallery(router)
    for (const a of DEMO_AGENTS) {
      expect(w.find(`[data-testid="doc-link-${a.agentType}"]`).attributes('href'))
        .toBe(`/docs/${a.docSectionId}`)
    }
    w.unmount()
  })
})
