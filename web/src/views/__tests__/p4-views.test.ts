/**
 * [new] P4 批次五页视图测试(2026-09-21 web 接线):渲染 / 空态 / 关键交互。
 * - McpServersView:列表渲染(打码)/注册表单 serverKey 字符集校验/OAUTH 置灰/注册
 * - SkillsView:列表/导入对话框预览(dryRun)/确认导入/激活上限 409 文案
 * - KbView:列表/状态过滤/文本导入(真实 handler)/检索调试小工具
 * - UsageView:汇总卡片(客户端聚合)/表格/granularity 切月
 * - FeedbacksView:评分图标/维度锚点/北极星卡片/rating 过滤
 * 空态:每页一条(msw override 返回空数据)。
 * Skill multipart 的 jsdom/undici File 字节丢失问题:preview/import 以模块 mock
 * 控制(handler 契约已在 mocks/handlers.test.ts 以手工 multipart 覆盖)。
 */
import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { setAdminKeyGetter } from '@/api/request'
import { mountView } from './helpers'
import McpServersView from '@/views/McpServersView.vue'
import SkillsView from '@/views/SkillsView.vue'
import KbView from '@/views/KbView.vue'
import UsageView from '@/views/UsageView.vue'
import FeedbacksView from '@/views/FeedbacksView.vue'
import { skillAdminApi } from '@/api/admin'
import type { IaSkill, SkillPreviewView } from '@/api/types'

vi.mock('@/api/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/admin')>()
  return {
    ...actual,
    skillAdminApi: {
      ...actual.skillAdminApi,
      preview: vi.fn(),
      importSkill: vi.fn(),
    },
  }
})

/** ElMessage 挂载在 document.body:收集当前所有提示文案 */
function messages(): string[] {
  return [...document.querySelectorAll('.el-message')].map(m => m.textContent ?? '')
}

function okEnvelope<T>(data: T) {
  return HttpResponse.json({ code: 0, msg: 'success', data })
}

function emptyPage() {
  return { list: [], total: 0, pageNo: 1, pageSize: 10 }
}

/** el-select 下拉项经 teleported popper 渲染在 body:点击含指定文案的最后一个选项 */
async function pickSelectOption(text: string) {
  await flushPromises()
  const items = [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(o => o.textContent?.includes(text))
    .map(o => o as HTMLElement)
  expect(items.length).toBeGreaterThan(0)
  items[items.length - 1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

describe('McpServersView(P4-W13 三方 MCP)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('渲染:列表含 serverKey/打码头值/停用态', async () => {
    const wrapper = await mountView(McpServersView, '/mcp-servers')
    expect(wrapper.text()).toContain('crm-mcp')
    expect(wrapper.text()).toContain('weather')
    expect(wrapper.text()).toContain('sk***') // 打码形(前 2 字符 + ***)
    expect(wrapper.text()).toContain('X-Api-Key')
    expect(wrapper.text()).toContain('停用')
    // serverKey 字符集提示在对话框内(防遮蔽语义见注册表单)
    expect(wrapper.text()).not.toContain('仅允许字母/数字/连字符')
    wrapper.unmount()
  })

  it('空态:0 行给「注册第一个服务器」CTA', async () => {
    server.use(mswHttp.get('/ia/api/v1/admin/mcp-servers', () => okEnvelope([])))
    const wrapper = await mountView(McpServersView, '/mcp-servers')
    expect(wrapper.text()).toContain('还没有注册任何三方 MCP 服务器')
    expect(wrapper.text()).toContain('注册第一个服务器')
    wrapper.unmount()
  })

  it('交互:OAUTH 选项禁用「暂未支持」;serverKey 下划线被前端拦截', async () => {
    const wrapper = await mountView(McpServersView, '/mcp-servers')
    // 打开注册对话框
    const createBtn = wrapper.findAll('button').find(b => b.text().includes('注册服务器'))
    await createBtn!.trigger('click')
    await flushPromises()
    // OAUTH radio 禁用(后端 501 的 UI 呈现)
    const oauthRadio = wrapper.findAll('.el-radio').find(r => r.text().includes('暂未支持'))
    expect(oauthRadio).toBeTruthy()
    expect(oauthRadio!.classes()).toContain('is-disabled')
    // serverKey 含下划线:前端校验拦截(不发请求)
    const inputs = wrapper.findAll('input')
    await inputs.find(i => i.attributes('placeholder')?.includes('仅字母/数字/连字符'))!.setValue('bad_key')
    const saveBtn = wrapper.findAll('button').find(b => b.text() === '注册')
    await saveBtn!.trigger('click')
    await flushPromises()
    expect(messages().join()).toContain('仅允许字母/数字/连字符')
    wrapper.unmount()
  })

  it('交互:合法表单注册成功后列表刷新出现新 serverKey', async () => {
    const wrapper = await mountView(McpServersView, '/mcp-servers')
    const createBtn = wrapper.findAll('button').find(b => b.text().includes('注册服务器'))
    await createBtn!.trigger('click')
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs.find(i => i.attributes('placeholder')?.includes('仅字母/数字/连字符'))!.setValue('new-mcp')
    await inputs.find(i => i.attributes('placeholder')?.includes('展示名'))!.setValue('新服务')
    await inputs.find(i => i.attributes('placeholder')?.includes('mcp.example.com'))!.setValue('https://new.example.com/mcp')
    await inputs.find(i => i.attributes('placeholder')?.includes('X-Api-Key'))!.setValue('X-Token')
    await inputs.find(i => i.attributes('placeholder')?.includes('头值'))!.setValue('secret-9f')
    const saveBtn = wrapper.findAll('button').find(b => b.text() === '注册')
    await saveBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('new-mcp')
    wrapper.unmount()
  })
})

describe('SkillsView(P4-W13 Skill 目录)', () => {
  beforeEach(() => {
    setAdminKeyGetter(() => 'k')
    ;(skillAdminApi.preview as Mock).mockReset()
    ;(skillAdminApi.importSkill as Mock).mockReset()
  })

  it('渲染:清单 name/显示名/激活态/指纹', async () => {
    const wrapper = await mountView(SkillsView, '/skills')
    expect(wrapper.text()).toContain('week-report')
    expect(wrapper.text()).toContain('周报生成')
    expect(wrapper.text()).toContain('已激活')
    expect(wrapper.text()).toContain('未激活')
    expect(wrapper.text()).toContain('sha256:skill0119')
    wrapper.unmount()
  })

  it('空态:0 行给「导入第一个 Skill」CTA', async () => {
    server.use(mswHttp.get('/ia/api/v1/admin/skills', () => okEnvelope(emptyPage())))
    const wrapper = await mountView(SkillsView, '/skills')
    expect(wrapper.text()).toContain('还没有任何 Skill')
    expect(wrapper.text()).toContain('导入第一个 Skill')
    wrapper.unmount()
  })

  it('交互:激活第 9 个 → 409 上限文案(后端语义原样透出)', async () => {
    const wrapper = await mountView(SkillsView, '/skills')
    const activateBtn = wrapper.findAll('button').find(b => b.text() === '激活')
    expect(activateBtn).toBeTruthy() // 种子含 1 个未激活行
    await activateBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(messages().join()).toContain('已达上限 8')
    wrapper.unmount()
  })

  it('交互:导入对话框预览(dryRun)→ 校验通过才亮「确认导入」', async () => {
    const fakePreview: SkillPreviewView = {
      fileName: 'demo-skill.zip',
      valid: true,
      manifest: { name: 'demo-skill', displayName: '演示技能', description: 'd', version: '1.0.0' },
      files: [{ path: 'SKILL.md', encoding: 'utf-8', sizeBytes: 10, content: '正文' }],
      warnings: ['包内缺少 SKILL.md(技能正文将不可见)'],
      errors: [],
      totalBytes: 10,
    }
    ;(skillAdminApi.preview as Mock).mockResolvedValue(fakePreview)
    const fakeRow: IaSkill = {
      id: 999, appId: 1, name: 'demo-skill', displayName: '演示技能', description: 'd',
      version: '1.0.0', status: 'inactive', source: 'import', contentSha256: 'sha256:x', active: false,
    }
    ;(skillAdminApi.importSkill as Mock).mockResolvedValue(fakeRow)
    const wrapper = await mountView(SkillsView, '/skills')
    const importBtn = wrapper.findAll('button').find(b => b.text().includes('导入 Skill'))
    await importBtn!.trigger('click')
    await flushPromises()
    // 未预览时确认按钮禁用
    const confirmBtn = () => wrapper.findAll('button').find(b => b.text().includes('确认导入'))!
    expect(confirmBtn().attributes('disabled')).toBeDefined()
    // 模拟选择文件(el-upload input change)
    const file = new File(['zip-bytes'], 'demo-skill.zip')
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    await input.dispatchEvent(new Event('change'))
    await flushPromises()
    // 预览校验(dryRun 零落库)
    const previewBtn = wrapper.findAll('button').find(b => b.text().includes('预览校验'))
    await previewBtn!.trigger('click')
    await flushPromises()
    const panel = wrapper.find('[data-testid="skill-preview"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('校验通过')
    expect(panel.text()).toContain('demo-skill')
    // 预览通过后确认按钮可用并完成导入
    expect(confirmBtn().attributes('disabled')).toBeUndefined()
    await confirmBtn().trigger('click')
    await flushPromises()
    expect(skillAdminApi.importSkill).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('KbView(P4-W14 知识库)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('渲染:标题/来源/状态/分段数', async () => {
    const wrapper = await mountView(KbView, '/kb')
    expect(wrapper.text()).toContain('员工手册.md')
    expect(wrapper.text()).toContain('产品 FAQ(9 月版)')
    expect(wrapper.text()).toContain('失效')
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('检索调试')
    wrapper.unmount()
  })

  it('空态:0 行给「导入第一个文档」CTA', async () => {
    server.use(mswHttp.get('/ia/api/v1/admin/kb/documents', () => okEnvelope(emptyPage())))
    const wrapper = await mountView(KbView, '/kb')
    expect(wrapper.text()).toContain('知识库还没有文档')
    expect(wrapper.text()).toContain('导入第一个文档')
    wrapper.unmount()
  })

  it('交互:状态过滤(客户端)只留失效行', async () => {
    const wrapper = await mountView(KbView, '/kb')
    const select = wrapper.find('.toolbar .el-select')
    await select.trigger('click')
    await pickSelectOption('失效(inactive)')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('旧版退款政策(已失效)')
    expect(wrapper.text()).not.toContain('员工手册.md')
    wrapper.unmount()
  })

  it('交互:文本导入(真实 handler)→ 列表出现新文档', async () => {
    const wrapper = await mountView(KbView, '/kb')
    const importBtn = wrapper.findAll('button').find(b => b.text().includes('导入文档'))
    await importBtn!.trigger('click')
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs.find(i => i.attributes('placeholder')?.includes('文档名'))!.setValue('新人指南')
    await wrapper.find('textarea').setValue('很长的正文'.repeat(100))
    const submitBtn = wrapper.findAll('button').find(b => b.text() === '导入')
    await submitBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('新人指南')
    wrapper.unmount()
  })

  it('交互:检索调试小工具出 top-k 命中与检索配置', async () => {
    const wrapper = await mountView(KbView, '/kb')
    const debugBtn = wrapper.findAll('button').find(b => b.text().includes('检索调试'))
    await debugBtn!.trigger('click')
    await flushPromises()
    const searchInput = wrapper.findAll('.el-drawer input').find(i => i.attributes('placeholder')?.includes('检索查询'))!
    await searchInput.setValue('员工')
    const runBtn = wrapper.findAll('.el-drawer button').find(b => b.text().includes('检索') && !b.text().includes('调试'))
    await runBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('tsvector')
    expect(wrapper.text()).toContain('员工手册.md')
    expect(wrapper.text()).toContain('TOP 1')
    wrapper.unmount()
  })
})

describe('UsageView(W15 用量统计)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('渲染:汇总卡片(调用 113/tokens)+ 模型分布 + 聚合表格', async () => {
    const wrapper = await mountView(UsageView, '/usage')
    // 种子 12 行聚合调用次数合计 = 113(overview 客户端聚合)
    expect(wrapper.text()).toContain('113')
    expect(wrapper.text()).toContain('调用次数(终态)')
    expect(wrapper.text()).toContain('仅 COMPLETED 调用')
    // 模型分布 top1 = deepseek/deepseek-chat(23+11+31+17+9=91)
    expect(wrapper.text()).toContain('deepseek/deepseek-chat')
    // 表格首行 statDate 降序
    expect(wrapper.text()).toContain('2026-09-20')
    wrapper.unmount()
  })

  it('空态:无数据时表格给引导 CTA', async () => {
    server.use(mswHttp.get('/ia/api/v1/admin/usage/summary', () =>
      okEnvelope({ list: [], total: 0, pageNo: 1, pageSize: 10 })))
    const wrapper = await mountView(UsageView, '/usage')
    expect(wrapper.text()).toContain('窗口内没有用量数据')
    expect(wrapper.text()).toContain('重新查询')
    wrapper.unmount()
  })

  it('交互:granularity 切月 → 表格统计周期变 2026-09', async () => {
    const wrapper = await mountView(UsageView, '/usage')
    const monthRadio = wrapper.findAll('.el-radio-button').find(r => r.text().includes('按月'))
    await monthRadio!.find('input').setValue('MONTH')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('2026-09')
    expect(wrapper.text()).not.toContain('2026-09-20')
    wrapper.unmount()
  })
})

describe('FeedbacksView(W15 用户反馈)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('渲染:评分图标/评论/维度锚点/北极星卡片(好评率 67%)', async () => {
    const wrapper = await mountView(FeedbacksView, '/feedbacks')
    expect(wrapper.text()).toContain('👍')
    expect(wrapper.text()).toContain('👎')
    expect(wrapper.text()).toContain('改错了字段,把昵称当成了姓名')
    // 维度锚点(会话/运行)
    expect(wrapper.text()).toContain('conv-1002')
    expect(wrapper.text()).toContain('run-2001')
    // 北极星:种子 4 UP / 2 DOWN → 67%
    const positive = wrapper.find('[data-testid="ns-positive"]')
    expect(positive.text()).toBe('67%')
    expect(wrapper.text()).toContain('带反馈完成率(代理)')
    expect(wrapper.text()).toContain('不虚报')
    wrapper.unmount()
  })

  it('空态:无反馈给说明与重新查询', async () => {
    server.use(mswHttp.get('/ia/api/v1/admin/feedbacks', () => okEnvelope(emptyPage())))
    const wrapper = await mountView(FeedbacksView, '/feedbacks')
    expect(wrapper.text()).toContain('窗口内没有用户反馈')
    wrapper.unmount()
  })

  it('交互:rating 过滤 DOWN → 仅差评行', async () => {
    const wrapper = await mountView(FeedbacksView, '/feedbacks')
    const select = wrapper.find('.toolbar .el-select')
    await select.trigger('click')
    await pickSelectOption('差评')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('等了很久超时了')
    expect(wrapper.text()).not.toContain('周报结构很清晰')
    wrapper.unmount()
  })
})
