/**
 * [new] admin API 客户端测试:逐端点断言 URL / 方法 / 请求体 / 响应解析。
 * 用内联捕获型 handler(不依赖 mocks 的实现),先于 mock 后端编写(测试先行)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { setAdminKeyGetter } from './request'
import {
  appAdminApi,
  auditAdminApi,
  buildQuery,
  circuitAdminApi,
  modelConfigAdminApi,
  toolAdminApi,
  toolGrantAdminApi,
  webhookAdminApi,
} from './admin'
import type { IaApp } from './types'

/** 捕获最近一次请求,并以固定信封响应 */
function capture<T>(payload: T) {
  const state: { req: Request | null; body: unknown } = { req: null, body: null }
  const respond = async ({ request }: { request: Request }) => {
    state.req = request
    state.body = request.headers.get('Content-Type')?.includes('json')
      ? await request.json().catch(() => null)
      : null
    return HttpResponse.json({ code: 0, data: payload })
  }
  return { state, respond }
}

describe('admin API 客户端', () => {
  beforeEach(() => {
    setAdminKeyGetter(() => 'k-test')
  })

  describe('应用管理', () => {
    it('page:GET /admin/apps 且分页/筛选参数进 query', async () => {
      const { state, respond } = capture<IaApp[]>([])
      server.use(mswHttp.get('/ia/api/v1/admin/apps', respond))
      await appAdminApi.page({ keyword: 'demo', status: 1, pageNo: 2, pageSize: 20 })
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/apps')
      expect(url.searchParams.get('keyword')).toBe('demo')
      expect(url.searchParams.get('status')).toBe('1')
      expect(url.searchParams.get('pageNo')).toBe('2')
      expect(url.searchParams.get('pageSize')).toBe('20')
    })

    it('create:POST JSON 体并解析回 IaApp', async () => {
      const app = { id: 1, appKey: 'demo', name: '演示应用' }
      const { state, respond } = capture(app)
      server.use(mswHttp.post('/ia/api/v1/admin/apps', respond))
      const resp = await appAdminApi.create({ appKey: 'demo', name: '演示应用' })
      expect(state.req!.method).toBe('POST')
      expect(state.body).toEqual({ appKey: 'demo', name: '演示应用' })
      expect(resp).toEqual(app)
    })

    it('registerPublicKey:POST /apps/{id}/public-key', async () => {
      const { state, respond } = capture({ fingerprint: 'sha256:abc', updatedAt: '2026-09-20T00:00:00Z' })
      server.use(mswHttp.post('/ia/api/v1/admin/apps/7/public-key', respond))
      const resp = await appAdminApi.registerPublicKey(7, { publicKey: '-----BEGIN PUBLIC KEY-----' })
      expect(state.req!.url).toContain('/ia/api/v1/admin/apps/7/public-key')
      expect(state.body).toEqual({ publicKey: '-----BEGIN PUBLIC KEY-----' })
      expect(resp.fingerprint).toBe('sha256:abc')
    })

    it('rotateKey:POST /apps/{id}/public-key/rotate', async () => {
      const { state, respond } = capture({ fingerprint: 'sha256:def', updatedAt: '2026-09-21T00:00:00Z' })
      server.use(mswHttp.post('/ia/api/v1/admin/apps/7/public-key/rotate', respond))
      const resp = await appAdminApi.rotateKey(7, { publicKey: '-----BEGIN PUBLIC KEY-----' })
      expect(state.req!.url).toContain('/public-key/rotate')
      expect(resp.fingerprint).toBe('sha256:def')
    })

    it('update:PUT /apps/{id}', async () => {
      const { state, respond } = capture({ id: 7 } satisfies Partial<IaApp> as IaApp)
      server.use(mswHttp.put('/ia/api/v1/admin/apps/7', respond))
      await appAdminApi.update(7, { retentionDays: 90 })
      expect(state.req!.method).toBe('PUT')
      expect(state.body).toEqual({ retentionDays: 90 })
    })
  })

  describe('工具注册', () => {
    it('register:POST /tools/register 返回清单与数量', async () => {
      const payload = { registered: 1, tools: [{ id: 1, fqn: 'mcp__host__get_user' }] }
      const { state, respond } = capture(payload)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/register', respond))
      const resp = await toolAdminApi.register({
        serverKey: 'host', serverName: '宿主', endpoint: 'http://host/ia-mcp', transport: 'streamable_http',
      })
      expect(state.body).toMatchObject({ serverKey: 'host', transport: 'streamable_http' })
      expect(resp.registered).toBe(1)
      expect(resp.tools[0]!.fqn).toBe('mcp__host__get_user')
    })

    it('refresh:POST /tools/{id}/refresh', async () => {
      const { state, respond } = capture({ fqn: 'x', schemaFingerprint: 'fp', diffKind: 'additive', applied: true, message: '纯增量自动接受' })
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/refresh', respond))
      const resp = await toolAdminApi.refresh(3)
      expect(state.req!.url).toContain('/ia/api/v1/admin/tools/3/refresh')
      expect(resp.applied).toBe(true)
    })

    it('disable/enable:POST 对应动作端点', async () => {
      const { respond } = capture({ id: 3, status: 0 })
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/disable', respond))
      const disabled = await toolAdminApi.disable(3)
      expect(disabled.status).toBe(0)
      const { respond: respond2 } = capture({ id: 3, status: 1 })
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/enable', respond2))
      const enabled = await toolAdminApi.enable(3)
      expect(enabled.status).toBe(1)
    })

    it('updatePolicy:PATCH /tools/{id}/policy', async () => {
      const { state, respond } = capture({ id: 3, riskLevel: 'high' })
      server.use(mswHttp.patch('/ia/api/v1/admin/tools/3/policy', respond))
      await toolAdminApi.updatePolicy(3, { riskLevel: 'high', adminPolicy: 'force-ask' })
      expect(state.req!.method).toBe('PATCH')
      expect(state.body).toEqual({ riskLevel: 'high', adminPolicy: 'force-ask' })
    })

    it('page:riskLevel/status/serverKey 过滤参数', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/tools', respond))
      await toolAdminApi.page({ riskLevel: 'high', status: 1, serverKey: 'host', pageNo: 1, pageSize: 10 })
      const url = new URL(state.req!.url)
      expect(url.searchParams.get('riskLevel')).toBe('high')
      expect(url.searchParams.get('status')).toBe('1')
      expect(url.searchParams.get('serverKey')).toBe('host')
    })
  })

  describe('工具授权', () => {
    it('grant:POST /tool-grants', async () => {
      const { state, respond } = capture({ id: 9, userId: 'u1', toolFqn: 'mcp__host__update_user', scope: 'permanent' })
      server.use(mswHttp.post('/ia/api/v1/admin/tool-grants', respond))
      const resp = await toolGrantAdminApi.grant({ userId: 'u1', toolFqn: 'mcp__host__update_user', scope: 'permanent' })
      expect(state.body).toEqual({ userId: 'u1', toolFqn: 'mcp__host__update_user', scope: 'permanent' })
      expect(resp.id).toBe(9)
    })

    it('revoke:DELETE /tool-grants/{id}', async () => {
      const { state, respond } = capture({ ok: true })
      server.use(mswHttp.delete('/ia/api/v1/admin/tool-grants/9', respond))
      await toolGrantAdminApi.revoke(9)
      expect(state.req!.method).toBe('DELETE')
      expect(state.req!.url).toContain('/tool-grants/9')
    })

    it('page:未传的可选参数不下发(false/0 为有效值)', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/tool-grants', respond))
      await toolGrantAdminApi.page({ toolFqn: 'mcp__host__x', scope: 'permanent' })
      const url = new URL(state.req!.url)
      expect(url.searchParams.get('toolFqn')).toBe('mcp__host__x')
      expect(url.searchParams.has('includeInvalid')).toBe(false)
      expect(url.searchParams.has('pageNo')).toBe(false)
    })

    it('page:status=0(停用)作为有效过滤值下发', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/apps', respond))
      await appAdminApi.page({ status: 0 })
      const url = new URL(state.req!.url)
      expect(url.searchParams.get('status')).toBe('0')
    })
  })

  describe('审计查询', () => {
    it('page:时间与 decisionSource 过滤进 query', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/audit-logs', respond))
      await auditAdminApi.page({
        appKey: 'demo', userId: 'u1', decisionSource: 'live-confirm',
        from: '2026-09-01T00:00:00Z', to: '2026-09-20T00:00:00Z',
      })
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/audit-logs')
      expect(url.searchParams.get('decisionSource')).toBe('live-confirm')
      expect(url.searchParams.get('from')).toBe('2026-09-01T00:00:00Z')
      expect(url.searchParams.get('userId')).toBe('u1')
    })
  })

  describe('模型配置', () => {
    it('create:POST;update:PUT /model-configs/{id};apiKey 只写', async () => {
      const created = { id: 5, apiKeyMasked: 'sk-1••••abcd' }
      const { state, respond } = capture(created)
      server.use(mswHttp.post('/ia/api/v1/admin/model-configs', respond))
      const resp = await modelConfigAdminApi.create({
        name: 'deepseek', platform: 'openai_compatible', apiKey: 'sk-secret',
      })
      expect(state.body).toEqual({ name: 'deepseek', platform: 'openai_compatible', apiKey: 'sk-secret' })
      expect(resp.apiKeyMasked).toBe('sk-1••••abcd')

      const { state: s2, respond: r2 } = capture(created)
      server.use(mswHttp.put('/ia/api/v1/admin/model-configs/5', r2))
      await modelConfigAdminApi.update(5, { id: 5, name: 'deepseek-2', platform: 'openai_compatible' })
      expect(s2.req!.method).toBe('PUT')
      expect(new URL(s2.req!.url).pathname).toBe('/ia/api/v1/admin/model-configs/5')
    })

    it('test:POST /model-configs/{id}/test', async () => {
      const { state, respond } = capture({ configId: 5, ok: true, responseText: 'pong', durationMs: 120, testedAt: '2026-09-20T00:00:00Z' })
      server.use(mswHttp.post('/ia/api/v1/admin/model-configs/5/test', respond))
      const resp = await modelConfigAdminApi.test(5)
      expect(state.req!.method).toBe('POST')
      expect(resp.ok).toBe(true)
    })
  })

  describe('熔断与资源上限', () => {
    it('getState:GET /circuit-breaker 返回上限与事件', async () => {
      const { respond } = capture({
        emergencyStopped: false, stoppedAt: null, stopReason: null,
        limits: { maxToolCallsPerRun: 32 },
        recentEvents: [],
      })
      server.use(mswHttp.get('/ia/api/v1/admin/circuit-breaker', respond))
      const resp = await circuitAdminApi.getState()
      expect(resp.limits.maxToolCallsPerRun).toBe(32)
    })

    it('updateLimits:PUT /circuit-breaker/limits', async () => {
      const { state, respond } = capture({ maxToolCallsPerRun: 64 })
      server.use(mswHttp.put('/ia/api/v1/admin/circuit-breaker/limits', respond))
      const resp = await circuitAdminApi.updateLimits({ limits: { maxToolCallsPerRun: 64 } })
      expect(state.body).toEqual({ limits: { maxToolCallsPerRun: 64 } })
      expect(resp.maxToolCallsPerRun).toBe(64)
    })

    it('emergencyStop/terminateRun:POST 动作端点', async () => {
      const { state, respond } = capture({ id: 1, type: 'emergency-stop' })
      server.use(mswHttp.post('/ia/api/v1/admin/circuit-breaker/emergency-stop', respond))
      await circuitAdminApi.emergencyStop({ reason: '成本异常' })
      expect(state.body).toEqual({ reason: '成本异常' })

      const { state: s2, respond: r2 } = capture({ id: 2, type: 'run-terminated' })
      server.use(mswHttp.post('/ia/api/v1/admin/circuit-breaker/terminate-run', r2))
      await circuitAdminApi.terminateRun({ runId: 'run-1', reason: '失控循环' })
      expect(s2.body).toEqual({ runId: 'run-1', reason: '失控循环' })
    })
  })

  describe('Webhook', () => {
    it('saveConfig:PUT /webhooks/config;deliveries 分页', async () => {
      const { state, respond } = capture({ appId: 1, url: 'https://host/callback', secretMasked: '••••', enabled: true, events: ['run.finished'] })
      server.use(mswHttp.put('/ia/api/v1/admin/webhooks/config', respond))
      const resp = await webhookAdminApi.saveConfig({ url: 'https://host/callback', secret: 's3cret', events: ['run.finished'] })
      expect(state.body).toEqual({ url: 'https://host/callback', secret: 's3cret', events: ['run.finished'] })
      expect(resp.secretMasked).toBe('••••')

      const { state: s2, respond: r2 } = capture({ list: [], total: 0, pageNo: 1, pageSize: 10 })
      server.use(mswHttp.get('/ia/api/v1/admin/webhooks/deliveries', r2))
      await webhookAdminApi.deliveries({ event: 'run.failed', success: false, pageNo: 1, pageSize: 10 })
      const url = new URL(s2.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/webhooks/deliveries')
      expect(url.searchParams.get('event')).toBe('run.failed')
      expect(url.searchParams.get('success')).toBe('false')
    })

    it('testConfig:POST /webhooks/config/test 返回签名校验结果', async () => {
      const { respond } = capture({ ok: true, signatureValid: true })
      server.use(mswHttp.post('/ia/api/v1/admin/webhooks/config/test', respond))
      const resp = await webhookAdminApi.testConfig()
      expect(resp.signatureValid).toBe(true)
    })
  })

  it('buildQuery 跳过 undefined/null/空串', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: 'x' })).toBe('?a=1&e=x')
    expect(buildQuery({})).toBe('')
  })
})
