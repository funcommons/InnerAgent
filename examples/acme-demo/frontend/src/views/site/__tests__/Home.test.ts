import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/site/Home.vue'
import { SITE_FEATURES } from '@/site/features'
import zhCN from '@/locales/zh-CN'
import enUS from '@/locales/en-US'

/**
 * 产品首页:hero 双 CTA / 8 特性卡深链 / 架构图 / 三步曲 / 关于区。
 * 文案断言直接查 i18n 字典(组件用空测试 i18n 渲染 key,字典校验用真实 messages),
 * 保证 zh/en 齐备且无硬编码漏翻。
 */
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/docs/:sectionId?', component: { template: '<div />' } },
      { path: '/ia/overview', component: { template: '<div />' } },
    ],
  })
}

function mountHome() {
  const router = createTestRouter()
  return mount(Home, { global: { plugins: [router] } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('Home(产品首页)', () => {
  it('hero:主标语/副标语 + 双 CTA(查看文档 → /docs,进入 Demo → /ia/overview)', () => {
    const w = mountHome()
    expect(w.find('[data-testid="home-title"]').exists()).toBe(true)
    expect(w.find('[data-testid="home-subtitle"]').exists()).toBe(true)
    expect(w.find('[data-testid="home-cta-docs"]').attributes('href')).toBe('/docs')
    expect(w.find('[data-testid="home-cta-demo"]').attributes('href')).toBe('/ia/overview')
    w.unmount()
  })

  it('特性网格:8 卡,每卡深链与 features 数据一致', () => {
    const w = mountHome()
    const cards = w.findAll('[data-testid^="feature-"]')
    expect(cards).toHaveLength(8)
    for (const f of SITE_FEATURES) {
      const card = w.find(`[data-testid="feature-${f.id}"]`)
      expect(card.exists()).toBe(true)
      expect(card.attributes('href')).toBe(f.docTo)
    }
    w.unmount()
  })

  it('架构一图流(内联 SVG)与接入三步曲渲染,三步曲 CTA 指向快速开始', () => {
    const w = mountHome()
    expect(w.find('[data-testid="arch-diagram"]').exists()).toBe(true)
    expect(w.findAll('[data-testid^="step-"]')).toHaveLength(3)
    expect(w.find('[data-testid="home-steps-docs"]').attributes('href')).toBe('/docs/quickstart')
    w.unmount()
  })

  it('关于区:AgentScope 内核说明 + 与 demo-host 的四行比对表', () => {
    const w = mountHome()
    expect(w.find('[data-testid="home-agentscope"]').exists()).toBe(true)
    const rows = w.findAll('[data-testid="home-compare"] tbody tr')
    expect(rows).toHaveLength(4)
    w.unmount()
  })
})

describe('Home i18n 覆盖(zh/en 双语齐备,无硬编码漏翻)', () => {
  const zhHome = (zhCN as { home: { features: { items: Record<string, { title: string; desc: string }> } } }).home.features.items
  const enHome = (enUS as { home: { features: { items: Record<string, { title: string; desc: string }> } } }).home.features.items

  it('八卡的 title/desc 中英都有非空翻译', () => {
    for (const f of SITE_FEATURES) {
      expect(zhHome[f.id]?.title?.trim()).toBeTruthy()
      expect(zhHome[f.id]?.desc?.trim()).toBeTruthy()
      expect(enHome[f.id]?.title?.trim()).toBeTruthy()
      expect(enHome[f.id]?.desc?.trim()).toBeTruthy()
      // 不允许英文文案漏到中文词典(以纯 ASCII 为主的中文卡标题视为漏翻)
      expect(/[一-鿿]/.test(zhHome[f.id]!.title)).toBe(true)
    }
  })
})
