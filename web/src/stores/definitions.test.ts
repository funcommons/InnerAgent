/**
 * [new] Agent 定义管理 store 测试(P2-W5):分页列表/提示词单槽编辑/export
 * bundle/import(dryRun 预演零副作用 + overwrite 覆盖 + 条目级 errors)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDefinitionsStore, PROMPT_SLOT_META } from './definitions'
import { auditAdminApi } from '@/api/admin'
import { setAdminKeyGetter } from '@/api/request'

describe('definitions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('load 分页列表:agentKey 升序;search 重置页码', async () => {
    const store = useDefinitionsStore()
    store.pageNo = 1
    store.pageSize = 2
    await store.load()
    expect(store.total).toBe(4)
    expect(store.list.map(d => d.agentType)).toEqual(['ai_media', 'demo'])
    expect(store.list[0]!.prompts.systemPrompt).toBeTruthy()
    store.pageNo = 3
    await store.search()
    expect(store.pageNo).toBe(1)
  })

  it('get 详情回读;updatePrompt 三槽编辑后刷新当前页', async () => {
    const store = useDefinitionsStore()
    await store.load()
    const row = await store.get(82)
    expect(row.agentType).toBe('demo')
    const updated = await store.updatePrompt(82, 'greeting', '新问候语')
    expect(updated.prompts.greeting).toBe('新问候语')
    // 当前页已刷新:列表中的行同步新值
    expect(store.list.find(d => d.id === 82)!.prompts.greeting).toBe('新问候语')
  })

  it('exportBundle:全量 schemaVersion=1;选行 ids 过滤', async () => {
    const store = useDefinitionsStore()
    const full = await store.exportBundle()
    expect(full.schemaVersion).toBe(1)
    expect(full.definitions).toHaveLength(4)
    expect(full.definitions[0]!.prompts.map(p => p.slot)).toEqual(['systemPrompt', 'instructionTemplate', 'greeting'])
    const partial = await store.exportBundle([82])
    expect(partial.definitions.map(d => d.agentType)).toEqual(['demo'])
  })

  it('import dryRun 预演:零副作用,计数/条目级 errors 齐备', async () => {
    const store = useDefinitionsStore()
    const before = await store.get(82)
    const result = await store.importBundle({
      bundle: {
        schemaVersion: 1,
        exportedAt: '2026-09-21T00:00:00Z',
        definitions: [
          { agentType: 'demo', name: '演示助手(改)', prompts: [{ slot: 'greeting', content: '覆盖' }] },
          { agentType: 'fresh_agent', name: '全新', prompts: [{ slot: 'systemPrompt', content: '你是全新' }] },
          { agentType: 'bad', name: '', prompts: [] },
        ],
      },
      conflictPolicy: 'skip',
      dryRun: true,
    })
    expect(result.dryRun).toBe(true)
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.agentType).toBe('bad')
    // 零副作用
    expect((await store.get(82)).prompts.greeting).toBe(before.prompts.greeting)
    expect(store.lastPreview).toEqual(result)
    expect(store.lastImport).toBeNull()
  })

  it('import 正式 overwrite:落库覆盖+当前页刷新;审计落 definition-imported/updated', async () => {
    const store = useDefinitionsStore()
    const result = await store.importBundle({
      bundle: {
        schemaVersion: 1,
        exportedAt: '2026-09-21T00:00:00Z',
        definitions: [
          { agentType: 'demo', name: '演示助手(覆盖)', prompts: [{ slot: 'greeting', content: '覆盖问候' }] },
          { agentType: 'fresh_agent', name: '全新', prompts: [{ slot: 'systemPrompt', content: '你是全新' }] },
        ],
      },
      conflictPolicy: 'overwrite',
      dryRun: false,
    })
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    // 当前页刷新:覆盖行 + 新建行都在
    expect(store.list.find(d => d.agentType === 'demo')!.prompts.greeting).toBe('覆盖问候')
    expect(store.list.find(d => d.agentType === 'fresh_agent')).toBeTruthy()
    expect(store.total).toBe(5)
    // 审计留痕(decision + source 双过滤)
    const imported = await auditAdminApi.page({ decision: 'definition-imported', decisionSource: 'admin', pageSize: 10 })
    expect(imported.total).toBe(1)
    const updatedAudit = await auditAdminApi.page({ decision: 'definition-updated', decisionSource: 'admin', pageSize: 10 })
    expect(updatedAudit.total).toBe(1)
  })

  it('PROMPT_SLOT_META 三槽值域:systemPrompt 必填,其余可空', () => {
    expect(PROMPT_SLOT_META.map(m => m.slot)).toEqual(['systemPrompt', 'instructionTemplate', 'greeting'])
    expect(PROMPT_SLOT_META.map(m => m.required)).toEqual([true, false, false])
  })
})
