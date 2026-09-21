import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import SiteHeader from '@/components/site/SiteHeader.vue'
import { usePreferenceStore } from '@/store/preference'

/** 轻量测试路由:覆盖公开区 + 控制台入口路径,断言 router-link 解析 */
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/docs/:sectionId?', component: { template: '<div />' } },
      { path: '/playground', component: { template: '<div />' } },
      { path: '/ia/overview', component: { template: '<div />' } },
    ],
  })
}

function mountHeader() {
  const router = createTestRouter()
  const wrapper = mount(SiteHeader, { global: { plugins: [router] } })
  return { wrapper, router }
}

beforeEach(() => {
  localStorage.clear()
})

describe('SiteHeader(公开官网顶部导航)', () => {
  it('渲染 logo/四个主导航/语言切换/进入控制台 CTA', () => {
    const { wrapper } = mountHeader()
    expect(wrapper.find('[data-testid="site-logo"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-nav-home"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-nav-ia\\/overview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-nav-docs"]').attributes('href')).toBe('/docs')
    expect(wrapper.find('[data-testid="site-nav-playground"]').attributes('href')).toBe('/playground')
    expect(wrapper.find('[data-testid="site-lang"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-console-cta"]').attributes('href')).toBe('/ia/overview')
    wrapper.unmount()
  })

  it('当前路由点亮对应导航(docs 前缀匹配)', async () => {
    const { wrapper, router } = mountHeader()
    await router.push('/docs/quickstart')
    await flushPromises()
    expect(wrapper.find('[data-testid="site-nav-docs"]').classes()).toContain('is-active')
    expect(wrapper.find('[data-testid="site-nav-home"]').classes()).not.toContain('is-active')
    wrapper.unmount()
  })

  it('首页路由精确点亮「产品」', async () => {
    const { wrapper, router } = mountHeader()
    await router.push('/')
    await flushPromises()
    expect(wrapper.find('[data-testid="site-nav-home"]').classes()).toContain('is-active')
    expect(wrapper.find('[data-testid="site-nav-docs"]').classes()).not.toContain('is-active')
    wrapper.unmount()
  })

  it('移动端折叠菜单:点击汉堡展开,含导航与 CTA;路由跳转后自动收起', async () => {
    const { wrapper, router } = mountHeader()
    expect(wrapper.find('[data-testid="site-mobile-menu"]').exists()).toBe(false)
    await wrapper.find('[data-testid="site-burger"]').trigger('click')
    expect(wrapper.find('[data-testid="site-mobile-menu"]').exists()).toBe(true)
    const mobileLinks = wrapper.findAll('.site-mobile-menu__link')
    expect(mobileLinks.length).toBe(4)
    expect(wrapper.find('[data-testid="site-console-cta-mobile"]').exists()).toBe(true)

    // 点击导航跳转 → 菜单收起
    await wrapper.find('[data-testid="site-nav-docs"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/docs')
    expect(wrapper.find('[data-testid="site-mobile-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('语言切换:写入 preference store(zh-CN ↔ en-US)', async () => {
    const { wrapper } = mountHeader()
    const preference = usePreferenceStore()
    expect(preference.locale).toBe('zh-CN')
    await wrapper.find('[data-testid="site-lang"]').trigger('click')
    expect(preference.locale).toBe('en-US')
    await wrapper.find('[data-testid="site-lang"]').trigger('click')
    expect(preference.locale).toBe('zh-CN')
    wrapper.unmount()
  })
})
