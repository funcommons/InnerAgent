import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchAgentDefinitions,
  fetchAgentOptions,
  saveAgentDefinition,
} from '@/api/ia'
import { http } from '@/api/request'

// 轻 mock 请求层:只关心 ia.ts agent-admin 段的解析契约,不测 axios 链
vi.mock('@/api/request', () => ({
  http: { get: vi.fn(), post: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(http.get).mockReset()
  vi.mocked(http.post).mockReset()
})

describe('fetchAgentDefinitions(PageResult 归一化)', () => {
  it('records 形 → 行数组;spec/prompts 宽松解包,缺省安全值', async () => {
    vi.mocked(http.get).mockResolvedValue({
      records: [
        {
          id: 7,
          agentType: 'ticket-assistant',
          kind: 'main',
          name: '客服工单助手',
          enabled: true,
          modelId: 2,
          spec: { toolWhitelist: ['create_ticket'], subAgentTools: ['sales-query'] },
          prompts: { systemPrompt: '你是工单助手', greeting: '你好' },
        },
      ],
    })
    const rows = await fetchAgentDefinitions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 7,
      agentType: 'ticket-assistant',
      kind: 'main',
      enabled: true,
      modelId: 2,
      toolWhitelist: ['create_ticket'],
      subAgentTools: ['sales-query'],
      systemPrompt: '你是工单助手',
      greeting: '你好',
    })
  })

  it('list 形 / 裸数组形 / 非 JSON 形 → 安全空数组兜底', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({
      list: [{ agentType: 'a', name: 'A', spec: null, prompts: null }],
    })
    expect(await fetchAgentDefinitions()).toHaveLength(1)

    vi.mocked(http.get).mockResolvedValueOnce([{ agentType: 'b', name: 'B' }])
    expect(await fetchAgentDefinitions()).toHaveLength(1)

    vi.mocked(http.get).mockResolvedValueOnce({ foo: 1 })
    expect(await fetchAgentDefinitions()).toEqual([])
  })

  it('缺省语义:enabled 缺失=true,枚举值缺省安全', async () => {
    vi.mocked(http.get).mockResolvedValue({ records: [{ agentType: 'x' }] })
    const [row] = await fetchAgentDefinitions()
    expect(row?.enabled).toBe(true)
    expect(row?.kind).toBe('main')
    expect(row?.toolWhitelist).toEqual([])
    expect(row?.systemPrompt).toBeNull()
  })
})

describe('fetchAgentOptions(下拉聚合)', () => {
  it('tools/models 数组透传,subAgents 缺省空数组', async () => {
    vi.mocked(http.get).mockResolvedValue({
      tools: [{ serverKey: 'acme-demo', toolName: 'create_ticket' }],
      models: [{ id: 2, name: 'MiniMax M3' }],
      subAgents: [{ agentType: 'sales-query', name: '销售查询' }],
    })
    const options = await fetchAgentOptions()
    expect(options.tools).toHaveLength(1)
    expect(options.models[0]).toMatchObject({ id: 2 })
    expect(options.subAgents).toEqual([{ agentType: 'sales-query', name: '销售查询' }])
  })
})

describe('saveAgentDefinition', () => {
  it('POST /api/ia/agent-admin/save,结果透传', async () => {
    vi.mocked(http.post).mockResolvedValue({ created: 1, updated: 0, skipped: 0, errors: [] })
    const req = {
      definitionId: null,
      agentType: 'trouble-reporter',
      name: '故障上报',
      kind: 'main',
      enabled: true,
      modelId: null,
      toolWhitelist: [],
      subAgentTools: [],
      systemPrompt: '你是故障上报助手',
      greeting: '',
    }
    const result = await saveAgentDefinition(req)
    expect(result.created).toBe(1)
    expect(http.post).toHaveBeenCalledWith('/api/ia/agent-admin/save', req)
  })
})
