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
import DefinitionsView from '@/views/DefinitionsView.vue'
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

  it('AdminLayout:渲染十二项导航(P4 批次 + 三方 MCP/Skill/知识库/用量/反馈)', async () => {
    const wrapper = await mountView(AdminLayout, '/apps')
    expect(wrapper.text()).toContain('应用管理')
    expect(wrapper.text()).toContain('工具注册与授权')
    expect(wrapper.text()).toContain('Agent 定义')
    expect(wrapper.text()).toContain('审计查询')
    expect(wrapper.text()).toContain('模型配置')
    expect(wrapper.text()).toContain('熔断与紧急停用')
    expect(wrapper.text()).toContain('Webhook')
    // P4 批次新增五项
    expect(wrapper.text()).toContain('三方 MCP')
    expect(wrapper.text()).toContain('Skill 管理')
    expect(wrapper.text()).toContain('知识库')
    expect(wrapper.text()).toContain('用量统计')
    expect(wrapper.text()).toContain('用户反馈')
    // 2026-09-23:顶栏应用上下文切换器(Skill/知识库/用量/反馈的数据范围)
    expect(wrapper.find('[data-testid="app-context-select"]').exists()).toBe(true)
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

  it('ToolsView:注册表 Tab 渲染 FQN/指纹/注解/体检徽标;授权 Tab 可切换', async () => {
    const wrapper = await mountView(ToolsView, '/tools')
    expect(wrapper.text()).toContain('mcp__demo_host__get_user')
    expect(wrapper.text()).toContain('mcp__demo_host__reset_password')
    expect(wrapper.text()).toContain('sha256:0002fp')
    // 注解图例(R/D/I/W)渲染
    expect(wrapper.findAll('.hint').length).toBeGreaterThan(0)
    // 体检列(V17):种子 id1=ok(健康),id7=degraded(漂移),其余未体检
    expect(wrapper.text()).toContain('健康')
    expect(wrapper.text()).toContain('漂移')
    expect(wrapper.text()).toContain('未体检')
    // 页级批量体检入口 + 行内详情入口(立即体检落点)
    expect(wrapper.text()).toContain('批量体检')
    expect(wrapper.text()).toContain('详情')
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

  it('DefinitionsView:渲染定义列表与导入导出骨架(P2-W5)', async () => {
    const wrapper = await mountView(DefinitionsView, '/definitions')
    // 种子四行(agentKey 升序,首页 10 全容纳):main/sub 双 kind
    expect(wrapper.text()).toContain('demo')
    expect(wrapper.text()).toContain('InnerAgent 演示助手')
    expect(wrapper.text()).toContain('script_assistant')
    expect(wrapper.text()).toContain('主定义')
    expect(wrapper.text()).toContain('子代理')
    // 导出/导入入口与审计口径提示
    expect(wrapper.text()).toContain('全量导出')
    expect(wrapper.text()).toContain('导入')
    expect(wrapper.text()).toContain('编辑留痕')
    // 分页总数
    expect(wrapper.text()).toContain('共 4 条')
    wrapper.unmount()
  })

  it('AuditView:渲染审计流水并含脱敏参数锚点', async () => {
    const wrapper = await mountView(AuditView, '/audit')
    expect(wrapper.text()).toContain('mcp__demo_host__reset_password')
    expect(wrapper.text()).toContain('模式默认')
    // [优化建议 #21] 时间列相对化:精确 ISO 保留在 <time datetime> 机器可读属性
    const timeAttrs = wrapper.findAll('.ia-time').map(t => t.attributes('datetime'))
    expect(timeAttrs).toContain('2026-09-20T07:59:00Z')
    // [优化建议 #3] zh-cn locale 全量接入:分页总数中文「共 N 条」,不再出现英文 Total
    expect(wrapper.text()).toContain('共 12 条')
    expect(wrapper.text()).not.toContain('Total')
    // [优化建议 #19] 面包屑(域名→页名)与页头
    expect(wrapper.text()).toContain('审计中心')
    expect(wrapper.text()).toContain('审计检索')
    // [优化建议 #18] 工具条导出/列设置
    expect(wrapper.text()).toContain('导出 CSV')
    expect(wrapper.text()).toContain('列设置')
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
