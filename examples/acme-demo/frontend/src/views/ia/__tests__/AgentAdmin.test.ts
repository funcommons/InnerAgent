import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import { createI18n } from 'vue-i18n'
import ElementPlus from 'element-plus'
import AgentAdmin from '@/views/ia/AgentAdmin.vue'
import zhCN from '@/locales/zh-CN'
import { fetchAgentDefinitions, fetchAgentOptions, saveAgentDefinition } from '@/api/ia'
import type { IaAgentDefinitionRow } from '@/api/ia'

/**
 * Agent 管理页:列表渲染、新建抽屉表单→保存载荷组装(创建 id=null,
 * 编辑回填且 systemPrompt 留空=保持原值语义)。
 * api 层整体 mock;ElementPlus 注册使 el-table/el-input 在 jsdom 下可渲染
 * (ResizeObserver 兜底)。
 */
vi.mock('@/api/ia', () => ({
  fetchAgentDefinitions: vi.fn(),
  fetchAgentOptions: vi.fn(),
  saveAgentDefinition: vi.fn(),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver)

const ROW: IaAgentDefinitionRow = {
  id: 7,
  agentType: 'ticket-assistant',
  kind: 'main',
  name: '客服工单助手',
  enabled: true,
  modelId: null,
  toolWhitelist: ['create_ticket', 'list_tickets'],
  subAgentTools: [],
  systemPrompt: '旧人设',
  greeting: '旧欢迎语',
}

function createTestRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/ia/agent-admin', component: AgentAdmin },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
}

function mountPage() {
  const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
  return mount(AgentAdmin, {
    global: { plugins: [createTestRouter(), i18n, ElementPlus] },
  })
}

beforeEach(() => {
  vi.mocked(fetchAgentDefinitions).mockReset()
  vi.mocked(fetchAgentOptions).mockReset()
  vi.mocked(saveAgentDefinition).mockReset()
  vi.mocked(fetchAgentDefinitions).mockResolvedValue([ROW])
  vi.mocked(fetchAgentOptions).mockResolvedValue({
    tools: [{ serverKey: 'acme-demo', toolName: 'create_ticket', riskLevel: 'low' }],
    models: [{ id: 2, name: 'MiniMax M3' }],
    subAgents: [{ agentType: 'sales-query', name: '销售查询' }],
  })
})

describe('Agent 管理页(/ia/agent-admin)', () => {
  it('挂载即拉列表与选项,表格渲染定义行(agentType/名称/工具数)', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(fetchAgentDefinitions).toHaveBeenCalled()
    expect(fetchAgentOptions).toHaveBeenCalled()
    const table = wrapper.find('[data-testid="agent-admin-table"]')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('ticket-assistant')
    expect(table.text()).toContain('客服工单助手')
    expect(wrapper.find('[data-testid="agent-admin-tools"]').text()).toBe('2')
  })

  it('新建:抽屉表单填写 → 保存载荷 definitionId=null 且带 systemPrompt', async () => {
    vi.mocked(saveAgentDefinition).mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="agent-admin-create"]').trigger('click')
    await flushPromises()
    const form = wrapper.find('[data-testid="agent-admin-form"]')
    expect(form.exists()).toBe(true)

    // el-input inheritAttrs=false:data-testid 落在内部 input 本身
    const typeInput = form.find('[data-testid="agent-admin-agent-type"]')
    await typeInput.setValue('trouble-reporter')
    // 表单内 input 顺序:agentType(1) → name(2) → radio 组 → 下拉过滤框
    const nameInput = form.findAll('input').at(1)
    await nameInput?.setValue('故障上报')
    const prompt = form.find('[data-testid="agent-admin-system-prompt"]')
    await prompt.setValue('你是故障上报助手')

    await wrapper.find('[data-testid="agent-admin-save"]').trigger('click')
    await flushPromises()

    expect(saveAgentDefinition).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveAgentDefinition).mock.calls[0]?.[0]
    expect(payload?.definitionId).toBeNull()
    expect(payload?.agentType).toBe('trouble-reporter')
    expect(payload?.name).toBe('故障上报')
    expect(payload?.systemPrompt).toBe('你是故障上报助手')
    expect(payload?.kind).toBe('main')
  })

  it('编辑:回填原 agentType 但 systemPrompt 留空(保持原值语义);保存后刷新', async () => {
    vi.mocked(saveAgentDefinition).mockResolvedValue({
      created: 0,
      updated: 1,
      skipped: 0,
      errors: [],
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="agent-admin-edit"]').trigger('click')
    await flushPromises()
    const typeInput = wrapper.find('[data-testid="agent-admin-agent-type"]')
    expect((typeInput.element as HTMLInputElement).value).toBe('ticket-assistant')
    expect((typeInput.element as HTMLInputElement).disabled).toBe(true)

    await wrapper.find('[data-testid="agent-admin-save"]').trigger('click')
    await flushPromises()

    const payload = vi.mocked(saveAgentDefinition).mock.calls[0]?.[0]
    expect(payload?.definitionId).toBe(7)
    expect(payload?.systemPrompt).toBe('')
    expect(payload?.greeting).toBe('')
    expect(fetchAgentDefinitions).toHaveBeenCalledTimes(2)
  })
})
