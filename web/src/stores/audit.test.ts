/**
 * [new] 审计 store 测试:过滤组合(字段名对齐 ia_audit_log 真实列)、时间倒序、分页。
 * 查询端点服务端未实现(P2 后续),行形已对齐真实列。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuditStore, DECISION_SOURCES, AUDIT_DECISIONS } from './audit'
import { setAdminKeyGetter } from '@/api/request'

describe('audit store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('默认加载种子 12 条,createTime 倒序', async () => {
    const store = useAuditStore()
    await store.load()
    expect(store.total).toBe(12)
    const dates = store.list.map(l => l.createTime ?? '')
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('decisionSource 过滤(live-confirm → 2 条,T3b 实弹决策)', async () => {
    const store = useAuditStore()
    store.filters.decisionSource = 'live-confirm'
    await store.load()
    expect(store.total).toBe(2)
    expect(store.list.every(l => l.decisionSource === 'live-confirm')).toBe(true)
  })

  it('时间范围 + 用户组合过滤', async () => {
    const store = useAuditStore()
    store.filters.userId = '12993'
    store.filters.from = '2026-09-19T00:00:00Z'
    store.filters.to = '2026-09-20T23:59:59Z'
    await store.load()
    expect(store.total).toBe(5)
  })

  it('#7 时间筛选无时区后缀形(YYYY-MM-DDTHH:mm:ss)过滤生效(即输即查落点)', async () => {
    // 视图层 value-format 已去 Z(对齐服务端 LocalDateTime ISO.DATE_TIME);
    // 该形经查询链路(含 mock 词典比较)须与带 Z 形等价命中
    const store = useAuditStore()
    store.filters.from = '2026-09-19T00:00:00'
    store.filters.to = '2026-09-20T23:59:59'
    await store.load()
    expect(store.total).toBe(5)
    expect(store.list.every(l => (l.createTime ?? '').slice(0, 19) >= store.filters.from)).toBe(true)
    expect(store.list.every(l => (l.createTime ?? '').slice(0, 19) <= store.filters.to)).toBe(true)
  })

  it('decision 过滤与分页', async () => {
    const store = useAuditStore()
    store.filters.decision = 'denied'
    await store.load()
    expect(store.total).toBe(4)
    store.filters.decision = ''
    store.filters.pageSize = 5
    store.filters.pageNo = 2
    await store.load()
    expect(store.list.length).toBe(5)
    expect(store.total).toBe(12)
  })

  it('search 重置页码', async () => {
    const store = useAuditStore()
    store.filters.pageNo = 3
    await store.search()
    expect(store.filters.pageNo).toBe(1)
  })

  it('decision_source 与 decision 字典完备(真实码值)', () => {
    expect(DECISION_SOURCES.map(d => d.value)).toEqual(['mode-default', 'user-grant', 'forced-policy', 'live-confirm', 'full-access'])
    expect(AUDIT_DECISIONS.map(d => d.value)).toEqual([
      'allowed', 'denied', 'granted', 'revoked', 'invalidated',
      'risk_upgraded', 'tool_disabled', 'schema_compatible', 'schema_breaking',
    ])
  })
})
