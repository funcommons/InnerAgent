/**
 * [new] 视图挂载冒烟(每个视图至少一条)。
 * 断言:挂载不抛错 + 关键骨架渲染 + mock 数据可达。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountView } from './helpers'
import LoginView from '@/views/LoginView.vue'
import AdminLayout from '@/views/AdminLayout.vue'
import AppsView from '@/views/AppsView.vue'
import ToolsView from '@/views/ToolsView.vue'
import AuditView from '@/views/AuditView.vue'
import ModelsView from '@/views/ModelsView.vue'
import CircuitView from '@/views/CircuitView.vue'
import WebhooksView from '@/views/WebhooksView.vue'

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

  it('AppsView:表格渲染种子应用并含公钥登记态/保留期列', async () => {
    const wrapper = await mountView(AppsView, '/apps')
    expect(wrapper.text()).toContain('demo-app')
    expect(wrapper.text()).toContain('演示宿主应用')
    expect(wrapper.text()).toContain('已登记')
    expect(wrapper.text()).toContain('未登记')
    expect(wrapper.text()).toContain('180')
    // 密钥指纹列(#10):等宽展示前 12 位,tooltip 携完整指纹
    expect(wrapper.text()).toContain('a1b2c3d4e5f6')
    expect(wrapper.text()).not.toContain('a1b2c3d4e5f60718')
    wrapper.unmount()
  })

  it('ToolsView:注册表 Tab 渲染 FQN/指纹/注解;授权 Tab 可切换', async () => {
    const wrapper = await mountView(ToolsView, '/tools')
    expect(wrapper.text()).toContain('mcp__demo_host__get_user')
    expect(wrapper.text()).toContain('mcp__demo_host__reset_password')
    expect(wrapper.text()).toContain('sha256:0002fp')
    // 注解图例(R/D/I/W)渲染
    expect(wrapper.findAll('.hint').length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('ToolsView:行内「历史」抽屉打开(#11 schema 历史入口;空态可引导)', async () => {
    const wrapper = await mountView(ToolsView, '/tools')
    const historyBtn = wrapper.findAll('button').find(b => b.text().includes('历史'))
    expect(historyBtn).toBeTruthy()
    await historyBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('schema 历史')
    // 种子无历史 → 空态引导文案
    expect(wrapper.text()).toContain('暂无变更历史')
    wrapper.unmount()
  })

  it('AuditView:渲染审计流水并含脱敏参数锚点', async () => {
    const wrapper = await mountView(AuditView, '/audit')
    expect(wrapper.text()).toContain('mcp__demo_host__reset_password')
    expect(wrapper.text()).toContain('模式默认')
    expect(wrapper.text()).toContain('2026-09-20T07:59:00Z')
    // [优化建议 #3] zh-cn locale 全量接入:分页总数中文「共 N 条」,不再出现英文 Total
    expect(wrapper.text()).toContain('共 12 条')
    expect(wrapper.text()).not.toContain('Total')
    wrapper.unmount()
  })

  it('ModelsView:渲染配置列表且密钥仅掩码', async () => {
    const wrapper = await mountView(ModelsView, '/models')
    expect(wrapper.text()).toContain('DeepSeek 生产')
    expect(wrapper.text()).toContain('sk-d1••••7a9f')
    expect(wrapper.text()).toContain('阿里 DashScope')
    wrapper.unmount()
  })

  it('CircuitView:渲染总开关状态、上限表单与事件流', async () => {
    const wrapper = await mountView(CircuitView, '/circuit')
    expect(wrapper.text()).toContain('应用级 Agent 总开关')
    expect(wrapper.text()).toContain('32')
    expect(wrapper.text()).toContain('上限触发')
    wrapper.unmount()
  })

  it('WebhooksView:渲染配置(URL 进 input value)与投递记录', async () => {
    const wrapper = await mountView(WebhooksView, '/webhooks')
    // 回调地址在 input value 中(非文本节点)
    const inputs = wrapper.findAll('input').map(i => (i.element as HTMLInputElement).value)
    expect(inputs.some(v => v.includes('demo.example.com/ia/callback'))).toBe(true)
    // 密钥掩码出现在 placeholder
    const placeholders = wrapper.findAll('input').map(i => i.attributes('placeholder') ?? '')
    expect(placeholders.some(p => p.includes('whsec-••••9f2e'))).toBe(true)
    // 投递记录表
    expect(wrapper.text()).toContain('run-2041')
    wrapper.unmount()
  })
})
