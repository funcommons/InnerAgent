import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import PublicLayout from '@/layout/PublicLayout.vue'

/**
 * PublicLayout:公开官网布局壳(header + router-view + footer)。
 * 用真实公开区路由(懒加载页面)串一遍挂载,验证三段结构齐全。
 */
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div data-testid="page-home">home</div>' } },
      { path: '/docs/:sectionId?', component: { template: '<div data-testid="page-docs">docs</div>' } },
      { path: '/playground', component: { template: '<div data-testid="page-playground">playground</div>' } },
      { path: '/ia/overview', component: { template: '<div />' } },
    ],
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('PublicLayout(公开区布局)', () => {
  it('结构齐全:header + 页面主体 + footer', async () => {
    const router = createTestRouter()
    await router.push('/')
    const wrapper = mount(PublicLayout, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="public-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-header"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-footer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="page-home"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('路由切换时主体内容随之渲染(docs)', async () => {
    const router = createTestRouter()
    await router.push('/docs')
    const wrapper = mount(PublicLayout, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="page-docs"]').exists()).toBe(true)
    await router.push('/playground')
    await flushPromises()
    expect(wrapper.find('[data-testid="page-playground"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
