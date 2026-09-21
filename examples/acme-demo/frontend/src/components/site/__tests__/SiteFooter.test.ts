import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import SiteFooter from '@/components/site/SiteFooter.vue'

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

describe('SiteFooter(公开官网页脚)', () => {
  it('渲染产品/资源链接列与 GitHub 占位外链', () => {
    const router = createTestRouter()
    const wrapper = mount(SiteFooter, { global: { plugins: [router] } })
    expect(wrapper.find('[data-testid="footer-home"]').attributes('href')).toBe('/')
    expect(wrapper.find('[data-testid="footer-playground"]').attributes('href')).toBe('/playground')
    expect(wrapper.find('[data-testid="footer-console"]').attributes('href')).toBe('/ia/overview')
    expect(wrapper.find('[data-testid="footer-docs"]').attributes('href')).toBe('/docs')
    expect(wrapper.find('[data-testid="footer-quickstart"]').attributes('href')).toBe('/docs/quickstart')
    expect(wrapper.find('[data-testid="footer-embed"]').attributes('href')).toBe('/docs/frontend-embed')
    const github = wrapper.find('[data-testid="footer-github"]')
    expect(github.attributes('href')).toContain('github.com')
    expect(github.attributes('rel')).toContain('noopener')
    wrapper.unmount()
  })

  it('包含「由 InnerAgent 驱动」署名位', () => {
    const router = createTestRouter()
    const wrapper = mount(SiteFooter, { global: { plugins: [router] } })
    const powered = wrapper.find('.site-footer__powered')
    expect(powered.exists()).toBe(true)
    // 空测试 i18n 下 t 回退 key,署名 key 必须存在(防漏翻)
    expect(powered.text()).toContain('site.footer.poweredBy')
    wrapper.unmount()
  })
})
