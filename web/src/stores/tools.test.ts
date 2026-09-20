/**
 * [new] 工具注册与授权 store 测试:筛选/注册/刷新分诊/停用级联/策略升级失效/授予撤销。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToolsStore, GRANT_INVALID_REASONS } from './tools'
import { setAdminKeyGetter } from '@/api/request'

describe('tools store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('loadTools 种子 9 把;riskLevel/status 筛选', async () => {
    const store = useToolsStore()
    await store.loadTools()
    expect(store.toolsTotal).toBe(9)
    store.toolFilters.riskLevel = 'critical'
    await store.loadTools()
    expect(store.toolsTotal).toBe(2)
    store.toolFilters.riskLevel = ''
    store.toolFilters.status = 0
    await store.loadTools()
    expect(store.tools.map(t => t.fqn)).toEqual(['mcp__demo_host__export_users'])
    store.toolFilters.status = null
  })

  it('register 拉取清单并刷新列表', async () => {
    const store = useToolsStore()
    await store.loadTools()
    const resp = await store.register({ serverKey: 'x-host', serverName: 'X', endpoint: 'http://x/mcp', transport: 'streamable_http' })
    expect(resp.registered).toBe(2)
    expect(store.toolsTotal).toBe(11)
    expect(store.tools[0]!.fqn).toContain('mcp__x-host__')
  })

  it('refresh 分诊:applied 与 security-related 两类', async () => {
    const store = useToolsStore()
    const additive = await store.refresh(2)
    expect(additive.applied).toBe(true)
    const security = await store.refresh(3)
    expect(security.applied).toBe(false)
    expect(store.lastRefresh).not.toBeNull()
  })

  it('disable 级联失效授权(工具与授权双刷新)', async () => {
    const store = useToolsStore()
    await store.loadTools()
    await store.loadGrants()
    const beforeValid = store.grantsTotal // includeInvalid=true 时为 5
    expect(beforeValid).toBe(5)
    await store.setEnabled(2, false) // update_user:2 条授权
    const grants = store.grants.filter(g => g.toolFqn === 'mcp__demo_host__update_user')
    expect(grants.every(g => g.invalid && g.invalidReason === 'tool-disabled')).toBe(true)
    await store.setEnabled(2, true)
    expect(store.tools.find(t => t.id === 2)!.status).toBe(1)
  })

  it('updatePolicy 风险升级使存量授权失效', async () => {
    const store = useToolsStore()
    await store.updatePolicy(2, { riskLevel: 'critical', adminPolicy: 'force-ask' })
    const tool = store.tools.find(t => t.id === 2)!
    expect(tool.riskLevel).toBe('critical')
    expect(tool.adminPolicy).toBe('force-ask')
    await store.loadGrants()
    expect(store.grants.filter(g => g.toolFqn === 'mcp__demo_host__update_user')
      .every(g => g.invalidReason === 'risk-upgraded')).toBe(true)
  })

  it('grant 默认含失效记录(includeInvalid=true);revoke 移除', async () => {
    const store = useToolsStore()
    await store.loadGrants()
    expect(store.grantsTotal).toBe(5)
    const g = await store.grant({ userId: 'user-fresh', toolFqn: 'mcp__demo_host__get_user', scope: 'permanent' })
    expect(store.grantsTotal).toBe(6)
    await store.revoke(g.id)
    expect(store.grantsTotal).toBe(5)
    expect(GRANT_INVALID_REASONS['risk-upgraded']).toBe('风险等级升级')
  })
})
