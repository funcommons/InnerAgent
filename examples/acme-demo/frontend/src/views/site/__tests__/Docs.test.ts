import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import Docs from '@/views/site/Docs.vue'
import { usePreferenceStore } from '@/store/preference'
import { getDocSections } from '@/site/docs'

/**
 * 文档中心:/docs 文档首页(章节卡)与 /docs/:sectionId 章节正文、
 * 侧边栏章节树、学习路径(下一步)、移动端抽屉、zh/en 切换。
 */
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/docs/:sectionId?', component: Docs },
      { path: '/playground', component: { template: '<div />' } },
    ],
  })
}

/** 挂载后再导航到目标地址(push-before-mount 会被初始导航取代) */
async function mountDocs(initial = '/docs') {
  const router = createTestRouter()
  const wrapper = mount(Docs, { global: { plugins: [router] } })
  await router.isReady()
  await router.push(initial)
  await flushPromises()
  return { wrapper }
}

beforeEach(() => {
  localStorage.clear()
})

describe('Docs(文档首页 /docs 无参)', () => {
  it('渲染概览标题 + 八张章节卡 + 从快速开始起步 CTA', async () => {
    const { wrapper } = await mountDocs()
    expect(wrapper.find('[data-testid="docs-overview-title"]').exists()).toBe(true)
    const cards = wrapper.findAll('[data-testid^="docs-card-"]')
    expect(cards).toHaveLength(8)
    expect(wrapper.find('[data-testid="docs-start-cta"]').attributes('href')).toBe('/docs/quickstart')
    wrapper.unmount()
  })

  it('未知章节 id 回落文档首页', async () => {
    const { wrapper } = await mountDocs('/docs/not-a-section')
    expect(wrapper.find('[data-testid="docs-overview-title"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('Docs(章节正文)', () => {
  it('渲染章节标题/正文块/代码块(含复制按钮)', async () => {
    const { wrapper } = await mountDocs('/docs/quickstart')
    const quickstart = getDocSections('zh-CN')[0]!
    expect(wrapper.find('[data-testid="docs-section-title"]').text()).toBe(quickstart.title)
    expect(wrapper.find('[data-testid="code-block"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="code-copy"]').exists()).toBe(true)
    // 正文包含表格与提示框(yaml 排障 callout)
    expect(wrapper.find('.docs-callout').exists()).toBe(true)
    wrapper.unmount()
  })

  it('侧边栏章节树高亮当前章;学习路径下一步指向下一章', async () => {
    const { wrapper } = await mountDocs('/docs/quickstart')
    expect(wrapper.find('[data-testid="docs-nav-quickstart"]').classes()).toContain('is-active')
    expect(wrapper.find('[data-testid="docs-nav-app-registration"]').classes()).not.toContain('is-active')

    const nextLink = wrapper.find('[data-testid="docs-next-link"]')
    expect(nextLink.exists()).toBe(true)
    expect(nextLink.attributes('href')).toBe('/docs/app-registration')
    wrapper.unmount()
  })

  it('终点章(endpoints):下一步位变成体验台 CTA', async () => {
    const { wrapper } = await mountDocs('/docs/endpoints')
    expect(wrapper.find('[data-testid="docs-next-link"]').exists()).toBe(false)
    const cta = wrapper.find('[data-testid="docs-playground-cta"]')
    expect(cta.exists()).toBe(true)
    expect(cta.find('a').attributes('href')).toBe('/playground')
    wrapper.unmount()
  })

  it('表格行数与数据一致(embed-token claims 表 5 行)', async () => {
    const { wrapper } = await mountDocs('/docs/embed-token')
    const tables = wrapper.findAll('.docs-table')
    expect(tables.length).toBeGreaterThanOrEqual(1)
    expect(tables[0]!.findAll('tbody tr')).toHaveLength(5)
    wrapper.unmount()
  })
})

describe('Docs(导航与语言)', () => {
  it('移动端:章节抽屉可开合', async () => {
    const { wrapper } = await mountDocs('/docs')
    expect(wrapper.find('[data-testid="docs-drawer"]').exists()).toBe(false)
    await wrapper.find('[data-testid="docs-nav-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="docs-drawer"]').exists()).toBe(true)
    await wrapper.find('[data-testid="docs-nav-close"]').trigger('click')
    expect(wrapper.find('[data-testid="docs-drawer"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('切到 en-US 后章节标题/侧栏切换为英文内容', async () => {
    const { wrapper } = await mountDocs('/docs/quickstart')
    const preference = usePreferenceStore()
    preference.setLocale('en-US')
    await flushPromises()
    const quickstartEn = getDocSections('en-US')[0]!
    expect(wrapper.find('[data-testid="docs-section-title"]').text()).toBe(quickstartEn.title)
    expect(wrapper.find('[data-testid="docs-nav-embed-token"]').text()).toContain('embed token')
    wrapper.unmount()
  })
})
