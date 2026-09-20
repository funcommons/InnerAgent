/**
 * [new] 审计 store 测试:过滤组合、时间倒序、分页。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuditStore, DECISION_SOURCES, RESULT_STATUS } from './audit'
import { setAdminKeyGetter } from '@/api/request'

describe('audit store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('默认加载种子 12 条,时间倒序', async () => {
    const store = useAuditStore()
    await store.load()
    expect(store.total).toBe(12)
    const dates = store.list.map(l => l.occurredAt)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('decisionSource 过滤(live-confirm → 2 条)', async () => {
    const store = useAuditStore()
    store.filters.decisionSource = 'live-confirm'
    await store.load()
    expect(store.total).toBe(2)
    expect(store.list.every(l => l.decisionSource === 'live-confirm')).toBe(true)
  })

  it('时间范围 + 用户组合过滤', async () => {
    const store = useAuditStore()
    store.filters.userId = 'user-12993'
    store.filters.from = '2026-09-19T00:00:00Z'
    store.filters.to = '2026-09-20T23:59:59Z'
    await store.load()
    expect(store.total).toBe(5)
  })

  it('resultStatus 过滤与分页', async () => {
    const store = useAuditStore()
    store.filters.resultStatus = 'denied'
    await store.load()
    expect(store.total).toBe(3)
    store.filters.resultStatus = ''
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

  it('decision_source 与结果状态字典完备', () => {
    expect(DECISION_SOURCES.map(d => d.value)).toEqual(['mode-default', 'user-grant', 'forced-policy', 'live-confirm', 'full-access'])
    expect(RESULT_STATUS.map(r => r.value)).toEqual(['success', 'failed', 'denied', 'timeout'])
  })
})
