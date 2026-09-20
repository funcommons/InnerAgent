/**
 * [new] 视图挂载冒烟(每个视图至少一条)。
 * 断言:挂载不抛错 + 关键骨架渲染 + mock 数据可达。
 */
import { describe, expect, it } from 'vitest'
import { mountView } from './helpers'
import LoginView from '@/views/LoginView.vue'
import AdminLayout from '@/views/AdminLayout.vue'
import AppsView from '@/views/AppsView.vue'

describe('视图挂载冒烟', () => {
  it('LoginView:渲染登录表单并可输入', async () => {
    const wrapper = await mountView(LoginView, '/login')
    expect(wrapper.text()).toContain('InnerAgent 管理站')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('AdminLayout:渲染六项导航', async () => {
    const wrapper = await mountView(AdminLayout, '/apps')
    expect(wrapper.text()).toContain('应用管理')
    expect(wrapper.text()).toContain('工具注册与授权')
    expect(wrapper.text()).toContain('审计查询')
    expect(wrapper.text()).toContain('模型配置')
    expect(wrapper.text()).toContain('熔断与紧急停用')
    expect(wrapper.text()).toContain('Webhook')
    wrapper.unmount()
  })

  it('AppsView:表格渲染种子应用并含公钥/保留期列', async () => {
    const wrapper = await mountView(AppsView, '/apps')
    expect(wrapper.text()).toContain('demo-app')
    expect(wrapper.text()).toContain('演示宿主应用')
    expect(wrapper.text()).toContain('sha256:1a2b3c4d5e6f7081')
    expect(wrapper.text()).toContain('180')
    wrapper.unmount()
  })
})
