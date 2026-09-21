/**
 * [new] 熔断与 Webhook store 测试。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useCircuitStore, DEFAULT_LIMITS, LIMIT_FIELDS } from './circuit'
import { useWebhooksStore, WEBHOOK_EVENTS } from './webhooks'
import { setAdminKeyGetter } from '@/api/request'

describe('circuit store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('load 拉取状态;§4.7 七参数默认值进表单;activeRuns 活跃运行数透出', async () => {
    const store = useCircuitStore()
    await store.load()
    expect(store.state).not.toBeNull()
    expect(store.limitsForm).toEqual(DEFAULT_LIMITS)
    expect(store.state!.recentEvents.length).toBeGreaterThan(0)
    // 契约偏差 #2:activeRuns 引导管理员逐个 terminate-run
    expect(store.state!.activeRuns).toBe(1)
  })

  it('saveLimits 部分更新回写状态', async () => {
    const store = useCircuitStore()
    await store.load()
    store.limitsForm.maxToolCallsPerRun = 64
    const saved = await store.saveLimits()
    expect(saved.maxToolCallsPerRun).toBe(64)
    expect(store.state!.limits.maxToolCallsPerRun).toBe(64)
    expect(store.state!.limits.mcpQps).toBe(20) // 其余不受影响
  })

  it('emergencyStop/resume 翻转状态并入事件流', async () => {
    const store = useCircuitStore()
    await store.load()
    await store.emergencyStop('演练停用')
    expect(store.state!.emergencyStopped).toBe(true)
    expect(store.state!.stopReason).toBe('演练停用')
    expect(store.state!.recentEvents[0]!.type).toBe('emergency-stop')
    await store.resume()
    expect(store.state!.emergencyStopped).toBe(false)
    expect(store.state!.recentEvents[0]!.type).toBe('resume')
  })

  it('terminateRun 返回事件;LIMIT_FIELDS 覆盖七参数', async () => {
    const store = useCircuitStore()
    const event = await store.terminateRun('run-777', '失控循环')
    expect(event.type).toBe('run-terminated')
    expect(event.runId).toBe('run-777')
    expect(LIMIT_FIELDS.map(f => f.key).sort()).toEqual(Object.keys(DEFAULT_LIMITS).sort())
  })

  it('GET /circuit-breaker 404 → unavailable 占位态(衔接 #9,不误报错误)', async () => {
    server.use(
      mswHttp.get('/ia/api/v1/admin/circuit-breaker', () =>
        HttpResponse.json({ code: 404, msg: '资源不存在', data: null }, { status: 404 })),
    )
    const store = useCircuitStore()
    await store.load()
    expect(store.unavailable).toBe(true)
    expect(store.state).toBeNull()
    // 恢复端点后重查可回正常态
    server.use(mswHttp.get('/ia/api/v1/admin/circuit-breaker', () =>
      HttpResponse.json({ code: 0, msg: 'success', data: { emergencyStopped: false, stoppedAt: null, stopReason: null, limits: DEFAULT_LIMITS, recentEvents: [] } })))
    await store.load()
    expect(store.unavailable).toBe(false)
  })
})

describe('webhooks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('loadConfig 回填表单且密钥留空(只写语义)', async () => {
    const store = useWebhooksStore()
    await store.loadConfig()
    expect(store.config!.url).toBe('https://demo.example.com/ia/callback')
    expect(store.configForm.secret).toBe('')
    expect(store.configForm.events).toContain('run.finished')
  })

  it('saveConfig 保存后掩码更新、密钥表单复位', async () => {
    const store = useWebhooksStore()
    await store.loadConfig()
    const beforeMasked = store.config!.secretMasked
    store.configForm.secret = 'whsec-brand-new-0000'
    const saved = await store.saveConfig()
    expect(saved.secretMasked).not.toBe(beforeMasked)
    expect(store.config!.secretMasked).toBe(saved.secretMasked)
    expect(store.configForm.secret).toBe('')
  })

  it('loadDeliveries 按 status 过滤状态机(#18b 真端点;契约偏差 #7)', async () => {
    const store = useWebhooksStore()
    store.filters.status = 'FAILED'
    await store.loadDeliveries()
    expect(store.deliveriesTotal).toBe(1)
    const failed = store.deliveries[0]!
    expect(failed.attempt).toBe(3)
    expect(failed.nextRetryAt).toBeTruthy()
    store.filters.status = 'PENDING'
    await store.loadDeliveries()
    expect(store.deliveriesTotal).toBe(1)
    store.filters.status = ''
    await store.loadDeliveries()
    expect(store.deliveriesTotal).toBe(4)
    // 线上时间字段(epoch 毫秒)已由 api 层归一为 ISO
    expect(store.deliveries.every(d => d.deliveredAt === null || d.deliveredAt.endsWith('Z'))).toBe(true)
  })

  it('testConfig 返回真实外呼形(httpStatus/error 扩展;契约偏差 #6)', async () => {
    const store = useWebhooksStore()
    await store.loadConfig()
    const resp = await store.testConfig()
    expect(resp.ok).toBe(true)
    expect(resp.httpStatus).toBe(200)
    expect(resp.error).toBeNull()
  })

  it('redeliver:PENDING 之外的投递重置回待投递;PENDING 重复重投 → 409', async () => {
    const store = useWebhooksStore()
    await store.loadDeliveries()
    const failed = store.deliveries.find(d => d.status === 'FAILED')!
    const redelivered = await store.redeliver(failed.id)
    expect(redelivered.status).toBe('PENDING')
    expect(redelivered.attempt).toBe(0)
    expect(redelivered.deliveredAt).toBeNull()
    const pending = store.deliveries.find(d => d.id === failed.id)!
    expect(pending.status).toBe('PENDING')

    const err = await store.redeliver(failed.id).catch((e: unknown) => e)
    expect((err as { status?: number }).status).toBe(409)
  })

  it('config 端点 404 → configUnavailable 占位态(衔接 #9,不误报错误)', async () => {
    server.use(
      mswHttp.get('/ia/api/v1/admin/webhooks/config', () =>
        HttpResponse.json({ code: 404, msg: '资源不存在', data: null }, { status: 404 })),
    )
    const store = useWebhooksStore()
    await store.loadConfig()
    expect(store.configUnavailable).toBe(true)
    expect(store.config).toBeNull()
  })

  it('事件字典含 run 终态全集', () => {
    expect(WEBHOOK_EVENTS.map(e => e.value)).toEqual(['run.finished', 'run.failed', 'run.cancelled', 'run.resource-limit'])
  })
})
