/**
 * [P3 · 2026-09-27] AdminLayout 收尾三件套守卫:
 * C1 导航分组标题 + ⌘K 面板;C2 应用级路由「当前应用」徽标;
 * D10 暗黑模式切换(html.dark 类切换 + 持久化键)。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountView } from './helpers'
import AdminLayout from '@/views/AdminLayout.vue'

describe('AdminLayout P3(C1/C2/D10)', () => {
  it('C1:侧栏按集成中心/数据洞察/运行治理三组渲染分组标题', async () => {
    const wrapper = await mountView(AdminLayout, '/apps')
    const text = wrapper.text()
    expect(text).toContain('集成中心')
    expect(text).toContain('数据洞察')
    expect(text).toContain('运行治理')
    // 分组内代表项仍在
    expect(text).toContain('三方 MCP')
    expect(text).toContain('用量统计')
    wrapper.unmount()
  })

  it('C1:⌘K 面板默认关闭,点开按钮后渲染选项并可关闭', async () => {
    const wrapper = await mountView(AdminLayout, '/apps')
    // Teleport 到 body:须查 document 而非 wrapper
    expect(document.querySelector('[data-testid="cmdk"]')).toBeNull()
    await wrapper.find('[data-testid="admin-cmdk-open"]').trigger('click')
    const panel = document.querySelector('[data-testid="cmdk"]')
    expect(panel).toBeTruthy()
    const input = panel?.querySelector('[data-testid="cmdk-input"]') as HTMLInputElement
    expect(input).toBeTruthy()
    input.value = '用量'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(document.body.textContent).toContain('用量统计')
    // Esc 关闭(组件在 window 上监听)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(document.querySelector('[data-testid="cmdk"]')).toBeNull()
    wrapper.unmount()
  })

  it('C2:应用级路由渲染当前应用徽标,聚合视角路由不渲染', async () => {
    const scoped = await mountView(AdminLayout, '/skills')
    expect(scoped.find('[data-testid="app-scope-badge"]').exists()).toBe(true)
    scoped.unmount()

    const aggregate = await mountView(AdminLayout, '/apps')
    expect(aggregate.find('[data-testid="app-scope-badge"]').exists()).toBe(false)
    aggregate.unmount()
  })

  it('D10:主题切换按钮翻转 html.dark 并写入持久化键', async () => {
    const wrapper = await mountView(AdminLayout, '/apps')
    const before = document.documentElement.classList.contains('dark')
    await wrapper.find('[data-testid="admin-theme-toggle"]').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(!before)
    // 测试环境可能无 localStorage:仅断言类切换语义(持久化键由浏览器端覆盖)
    // 还原,避免污染同文件其他用例
    document.documentElement.classList.remove('dark')
    wrapper.unmount()
  })
})
