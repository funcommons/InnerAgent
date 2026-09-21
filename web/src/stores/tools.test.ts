/**
 * [new] 工具注册与授权 store 测试:筛选/注册/活刷新分诊(confirm|reject)/
 * 停用级联/风险升级失效/授予撤销(P2 真实契约形)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToolsStore, GRANT_INVALID_REASONS, parseAnnotations } from './tools'
import { setAdminKeyGetter } from '@/api/request'

const PURE_ADDITIVE_SCHEMA = '{"type":"object","properties":{"id":{"type":"string"},"email":{"type":"string"}}}'
const REQUIRED_ADDED_SCHEMA = '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}'

describe('tools store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('loadTools 种子 9 把;riskLevel/enabled 客户端筛选', async () => {
    const store = useToolsStore()
    await store.loadTools()
    expect(store.toolsTotal).toBe(9)
    store.toolFilters.riskLevel = 'low'
    await store.loadTools()
    expect(store.toolsTotal).toBe(2)
    store.toolFilters.riskLevel = ''
    store.toolFilters.enabled = false
    await store.loadTools()
    expect(store.tools.map(t => t.fqn)).toEqual(['mcp__demo_host__export_users'])
    store.toolFilters.enabled = null
  })

  it('register(单条,按 toolName)刷新列表;请求走真实字段', async () => {
    const store = useToolsStore()
    await store.loadTools()
    const entry = await store.register({
      serverKey: 'x-host', toolName: 'do_thing', source: 'host_app',
      annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}',
    })
    expect(entry.fqn).toBe('mcp__x-host__do_thing')
    expect(store.toolsTotal).toBe(10)
    // 列表按服务端排序(serverKey,toolName);新行在册即可
    const row = store.tools.find(t => t.fqn === 'mcp__x-host__do_thing')!
    expect(parseAnnotations(row.annotationsJson)?.readOnlyHint).toBe(true)
  })

  it('refreshSchema 分诊:unchanged/compatible/breaking 三类并存 lastTriage', async () => {
    const store = useToolsStore()
    const unchanged = await store.refreshSchema(2)
    expect(unchanged.verdict).toBe('unchanged')
    const compatible = await store.refreshSchema(2, { parametersSchema: PURE_ADDITIVE_SCHEMA })
    expect(compatible.verdict).toBe('compatible')
    const breaking = await store.refreshSchema(2, { parametersSchema: REQUIRED_ADDED_SCHEMA })
    expect(breaking.verdict).toBe('breaking')
    expect(store.lastTriage).not.toBeNull()
    expect((await store.schemaHistory(2)).length).toBeGreaterThanOrEqual(3)
  })

  it('confirmSchema 应用暂存;rejectSchema 保持旧 schema', async () => {
    const store = useToolsStore()
    await store.refreshSchema(4, { parametersSchema: REQUIRED_ADDED_SCHEMA })
    const rejected = await store.rejectSchema(4)
    expect(rejected.revalidateRequired).toBe(false)
    expect(rejected.schemaSha256).toBe('sha256:0004fp')
    await store.refreshSchema(4, { parametersSchema: REQUIRED_ADDED_SCHEMA })
    const confirmed = await store.confirmSchema(4)
    expect(confirmed.revalidateRequired).toBe(false)
    expect(confirmed.schemaSha256).not.toBe('sha256:0004fp')
  })

  it('disable 级联失效授权(工具与授权双刷新)', async () => {
    const store = useToolsStore()
    await store.loadTools()
    await store.loadGrants()
    const beforeValid = store.grantsTotal // includeInvalid=true 时为 5
    expect(beforeValid).toBe(5)
    await store.setEnabled(2, false) // update_user:2 条授权
    const grants = store.grants.filter(g => g.toolFqn === 'mcp__demo_host__update_user')
    expect(grants.every(g => g.invalidated && g.invalidatedReason === 'tool_disabled')).toBe(true)
    await store.setEnabled(2, true)
    expect(store.tools.find(t => t.id === 2)!.enabled).toBe(true)
  })

  it('updateTool 风险升级使存量授权失效;强制高危下调 400', async () => {
    const store = useToolsStore()
    await store.grant({ userId: 61001, toolName: 'get_user', scope: 'permanent' })
    await store.updateTool(1, { riskLevel: 'high', adminPolicy: 'force-ask' }) // low→high 升级
    const tool = store.tools.find(t => t.id === 1)!
    expect(tool.riskLevel).toBe('high')
    expect(tool.adminPolicy).toBe('force-ask')
    await store.loadGrants()
    expect(store.grants.filter(g => g.toolFqn === 'mcp__demo_host__get_user')
      .every(g => g.invalidated && g.invalidatedReason === 'risk_upgrade')).toBe(true)
    await expect(store.updateTool(3, { riskLevel: 'low' })) // 凭据类强制高危不可下调
      .rejects.toMatchObject({ status: 400 })
  })

  it('grant(conversation 必携会话)与 revoke;默认含失效记录', async () => {
    const store = useToolsStore()
    await store.loadGrants()
    expect(store.grantsTotal).toBe(5)
    const g = await store.grant({ userId: 61002, toolName: 'get_user', scope: 'conversation', conversationId: 'conv-999' })
    expect(g.scope).toBe('conversation')
    expect(g.conversationId).toBe('conv-999')
    expect(store.grantsTotal).toBe(6)
    await store.revoke(g.id, '误授撤销')
    expect(store.grantsTotal).toBe(5)
    expect(GRANT_INVALID_REASONS['risk_upgrade']).toBe('风险等级升级')
  })

  it('grantFilters 按 toolName/userId 过滤(真实 query 形,activeOnly 反转)', async () => {
    const store = useToolsStore()
    store.grantFilters.userId = '12993'
    await store.loadGrants()
    expect(store.grantsTotal).toBe(2)
    store.grantFilters.userId = ''
    store.grantFilters.toolName = 'update_user'
    store.grantFilters.includeInvalid = false
    await store.loadGrants()
    expect(store.grantsTotal).toBe(2) // 仅 2 条有效
  })
})
