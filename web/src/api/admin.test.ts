/**
 * [new] admin API 客户端测试:逐端点断言 URL / 方法 / 请求体 / 响应解析。
 * P2 对齐:每域至少一条「请求形=真实契约」断言(以服务端控制器为准:
 * AdminAppController / AdminToolController / AdminGrantController)。
 * 用内联捕获型 handler(不依赖 mocks 的实现)。
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
import type { IaApp, IaToolRegistry } from './types'

/** 捕获最近一次请求,并以固定信封响应 */
function capture<T>(payload: T) {
  const state: { req: Request | null; body: unknown } = { req: null, body: null }
  const respond = async ({ request }: { request: Request }) => {
    state.req = request
    state.body = request.headers.get('Content-Type')?.includes('json')
      ? await request.json().catch(() => null)
      : null
    return HttpResponse.json({ code: 0, msg: 'success', data: payload })
  }
  return { state, respond }
}

describe('admin API 客户端', () => {
  beforeEach(() => {
    setAdminKeyGetter(() => 'k-test')
  })

  describe('应用管理(对齐 AdminAppController)', () => {
    it('list:GET /admin/apps 返回数组(真实契约:无分页/过滤参数)', async () => {
      const apps = [{ id: 1, appKey: 'demo' }] as IaApp[]
      const { state, respond } = capture(apps)
      server.use(mswHttp.get('/ia/api/v1/admin/apps', respond))
      const resp = await appAdminApi.list()
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/apps')
      expect(url.search).toBe('') // 服务端无 query 参数
      expect(Array.isArray(resp)).toBe(true)
      expect(resp[0]!.appKey).toBe('demo')
    })

    it('create:POST /admin/apps,请求形=真实契约(appKey/name/signPublicKey 必填;无 remark/retentionDays)', async () => {
      const app = { id: 1, appKey: 'demo', name: '演示应用' } as IaApp
      const { state, respond } = capture(app)
      server.use(mswHttp.post('/ia/api/v1/admin/apps', respond))
      const resp = await appAdminApi.create({
        appKey: 'demo', name: '演示应用', signPublicKey: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
      })
      expect(state.req!.method).toBe('POST')
      expect(state.body).toEqual({
        appKey: 'demo',
        name: '演示应用',
        signPublicKey: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
      })
      expect(resp).toEqual(app)
    })

    it('update/updateSignKey:PUT /apps/{id}(公钥登记/轮换=PUT signPublicKey,无独立端点)', async () => {
      const { state, respond } = capture({ id: 7 } as IaApp)
      server.use(mswHttp.put('/ia/api/v1/admin/apps/7', respond))
      await appAdminApi.updateSignKey(7, '-----BEGIN PUBLIC KEY-----')
      expect(state.req!.method).toBe('PUT')
      expect(state.body).toEqual({ signPublicKey: '-----BEGIN PUBLIC KEY-----' })

      const { state: s2, respond: r2 } = capture({ id: 7 } as IaApp)
      server.use(mswHttp.put('/ia/api/v1/admin/apps/7', r2))
      await appAdminApi.update(7, { status: 0 })
      expect(s2.body).toEqual({ status: 0 })
      expect(s2.req!.method).toBe('PUT')
    })

    it('get/remove:GET、DELETE /apps/{id}', async () => {
      const { state, respond } = capture({ id: 7 } as IaApp)
      server.use(mswHttp.get('/ia/api/v1/admin/apps/7', respond))
      await appAdminApi.get(7)
      expect(new URL(state.req!.url).pathname).toBe('/ia/api/v1/admin/apps/7')

      const { respond: r2 } = capture(true)
      server.use(mswHttp.delete('/ia/api/v1/admin/apps/7', r2))
      await expect(appAdminApi.remove(7)).resolves.toBe(true)
    })
  })

  describe('工具注册(对齐 AdminToolController)', () => {
    it('register:POST /admin/tools,请求形=真实契约(serverKey/toolName/source 必填;单条注册)', async () => {
      const entry = { id: 1, fqn: 'mcp__host__get_user', enabled: true } as IaToolRegistry
      const { state, respond } = capture(entry)
      server.use(mswHttp.post('/ia/api/v1/admin/tools', respond))
      const resp = await toolAdminApi.register({
        serverKey: 'host', toolName: 'get_user', source: 'host_app', description: '查询',
        parametersSchema: '{"type":"object"}', annotationsJson: '{"readOnlyHint":true}',
        riskLevel: 'low', adminPolicy: 'force-ask', resumeSafe: true, concurrencySafe: false,
        endpointUrl: undefined, toolVersion: '1.0.0', enabled: true,
      })
      expect(state.req!.method).toBe('POST')
      // 请求形 = RegisterToolReqVO(字段名/枚举值逐一对应)
      expect(state.body).toEqual({
        serverKey: 'host',
        toolName: 'get_user',
        source: 'host_app',
        description: '查询',
        parametersSchema: '{"type":"object"}',
        annotationsJson: '{"readOnlyHint":true}',
        riskLevel: 'low',
        adminPolicy: 'force-ask',
        resumeSafe: true,
        concurrencySafe: false,
        toolVersion: '1.0.0',
        enabled: true,
      })
      expect(resp.fqn).toBe('mcp__host__get_user')
    })

    it('list:GET /tools?serverKey&enabled(真实契约过滤参数;enabled=false 有效值不下发丢失)', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/tools', respond))
      await toolAdminApi.list({ serverKey: 'host', enabled: false })
      const url = new URL(state.req!.url)
      expect(url.searchParams.get('serverKey')).toBe('host')
      expect(url.searchParams.get('enabled')).toBe('false')
    })

    it('refreshSchema:POST /tools/{id}/schema,响应=真实 TriageRespVO 形', async () => {
      const triage = {
        toolId: 3, fqn: 'mcp__host__x', verdict: 'breaking' as const, reasons: ['新增必填参数'],
        revalidateRequired: true, effectiveSchemaSha256: 'sha256:a', pendingSchemaSha256: 'sha256:b',
      }
      const { state, respond } = capture(triage)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/schema', respond))
      const resp = await toolAdminApi.refreshSchema(3, { parametersSchema: '{"type":"object","required":["id"]}' })
      expect(state.req!.url).toContain('/ia/api/v1/admin/tools/3/schema')
      expect(state.body).toEqual({ parametersSchema: '{"type":"object","required":["id"]}' })
      expect(resp.verdict).toBe('breaking')
      expect(resp.revalidateRequired).toBe(true)
      expect(resp.pendingSchemaSha256).toBe('sha256:b')
    })

    it('confirm/reject:POST /tools/{id}/schema/confirm|reject', async () => {
      const { state, respond } = capture({ id: 3 } as IaToolRegistry)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/schema/confirm', respond))
      const confirmed = await toolAdminApi.confirmSchema(3)
      expect(state.req!.url).toContain('/schema/confirm')
      expect(confirmed.id).toBe(3)

      const { state: s2, respond: r2 } = capture({ id: 3 } as IaToolRegistry)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/schema/reject', r2))
      await toolAdminApi.rejectSchema(3)
      expect(s2.req!.url).toContain('/schema/reject')
    })

    it('schemaHistory:GET /tools/{id}/schema-history 返回数组', async () => {
      const history = [{ id: 1, toolId: 3, triage: 'compatible', outcome: 'applied' }]
      const { state, respond } = capture(history)
      server.use(mswHttp.get('/ia/api/v1/admin/tools/3/schema-history', respond))
      const resp = await toolAdminApi.schemaHistory(3)
      expect(new URL(state.req!.url).pathname).toBe('/ia/api/v1/admin/tools/3/schema-history')
      expect(resp[0]!.outcome).toBe('applied')
    })

    it('update:PUT /tools/{id}(治理元数据;非 PATCH /policy)', async () => {
      const { state, respond } = capture({ id: 3, riskLevel: 'high' } as IaToolRegistry)
      server.use(mswHttp.put('/ia/api/v1/admin/tools/3', respond))
      await toolAdminApi.update(3, { riskLevel: 'high', adminPolicy: 'force-ask', resumeSafe: false })
      expect(state.req!.method).toBe('PUT')
      expect(state.body).toEqual({ riskLevel: 'high', adminPolicy: 'force-ask', resumeSafe: false })
    })

    it('disable/enable:POST 动作端点;remove:DELETE /tools/{id}', async () => {
      const { respond } = capture({ id: 3, enabled: false } as IaToolRegistry)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/disable', respond))
      const disabled = await toolAdminApi.disable(3)
      expect(disabled.enabled).toBe(false)
      const { respond: respond2 } = capture({ id: 3, enabled: true } as IaToolRegistry)
      server.use(mswHttp.post('/ia/api/v1/admin/tools/3/enable', respond2))
      const enabled = await toolAdminApi.enable(3)
      expect(enabled.enabled).toBe(true)
      const { state: s3, respond: r3 } = capture(true)
      server.use(mswHttp.delete('/ia/api/v1/admin/tools/3', r3))
      await expect(toolAdminApi.remove(3)).resolves.toBe(true)
      expect(s3.req!.method).toBe('DELETE')
    })
  })

  describe('工具授权(对齐 AdminGrantController)', () => {
    it('grant:POST /admin/grants,请求形=真实契约(userId:number/toolName/scope;非 toolFqn)', async () => {
      const grant = { id: 9, userId: 42, toolFqn: 'mcp__host__update_user', scope: 'permanent' }
      const { state, respond } = capture(grant)
      server.use(mswHttp.post('/ia/api/v1/admin/grants', respond))
      const resp = await toolGrantAdminApi.grant({ userId: 42, toolName: 'update_user', scope: 'permanent', decisionNote: '代授' })
      expect(state.body).toEqual({ userId: 42, toolName: 'update_user', scope: 'permanent', decisionNote: '代授' })
      expect(resp.id).toBe(9)
    })

    it('list:GET /grants?userId&toolName&scope&activeOnly(activeOnly=false 有效值下发)', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/grants', respond))
      await toolGrantAdminApi.list({ userId: 42, toolName: 'update_user', scope: 'permanent', activeOnly: false })
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/grants')
      expect(url.searchParams.get('userId')).toBe('42')
      expect(url.searchParams.get('toolName')).toBe('update_user')
      expect(url.searchParams.get('scope')).toBe('permanent')
      expect(url.searchParams.get('activeOnly')).toBe('false')
    })

    it('revoke:DELETE /grants/{id} 可携 decisionNote 请求体', async () => {
      const { state, respond } = capture(true)
      server.use(mswHttp.delete('/ia/api/v1/admin/grants/9', respond))
      await toolGrantAdminApi.revoke(9, { decisionNote: '误授撤销' })
      expect(state.req!.method).toBe('DELETE')
      expect(state.req!.url).toContain('/grants/9')
      expect(state.body).toEqual({ decisionNote: '误授撤销' })
    })
  })

  describe('审计查询(mock 域:服务端未实现)', () => {
    it('page:decision/decisionSource/时间过滤进 query(字段名对齐 ia_audit_log 列)', async () => {
      const { state, respond } = capture([])
      server.use(mswHttp.get('/ia/api/v1/admin/audit-logs', respond))
      await auditAdminApi.page({
        appId: 1, userId: 12993, decisionSource: 'live-confirm', decision: 'denied',
        from: '2026-09-01T00:00:00Z', to: '2026-09-20T00:00:00Z',
      })
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/audit-logs')
      expect(url.searchParams.get('decisionSource')).toBe('live-confirm')
      expect(url.searchParams.get('decision')).toBe('denied')
      expect(url.searchParams.get('userId')).toBe('12993')
      expect(url.searchParams.get('appId')).toBe('1')
      expect(url.searchParams.get('from')).toBe('2026-09-01T00:00:00Z')
    })
  })

  describe('模型配置(依赖并行任务,联调时核对)', () => {
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

    it('test:POST /model-configs/{id}/test;delete:DELETE /model-configs/{id}', async () => {
      const { state, respond } = capture({ configId: 5, ok: true, responseText: 'pong', durationMs: 120, testedAt: '2026-09-20T00:00:00Z' })
      server.use(mswHttp.post('/ia/api/v1/admin/model-configs/5/test', respond))
      const resp = await modelConfigAdminApi.test(5)
      expect(state.req!.method).toBe('POST')
      expect(resp.ok).toBe(true)

      const { respond: r2 } = capture(true)
      server.use(mswHttp.delete('/ia/api/v1/admin/model-configs/5', r2))
      await expect(modelConfigAdminApi.delete(5)).resolves.toBe(true)
    })
  })

  describe('熔断与资源上限(mock 域:服务端未实现)', () => {
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

    it('updateLimits/emergencyStop/terminateRun 请求形不变', async () => {
      const { state, respond } = capture({ maxToolCallsPerRun: 64 })
      server.use(mswHttp.put('/ia/api/v1/admin/circuit-breaker/limits', respond))
      const resp = await circuitAdminApi.updateLimits({ limits: { maxToolCallsPerRun: 64 } })
      expect(state.body).toEqual({ limits: { maxToolCallsPerRun: 64 } })
      expect(resp.maxToolCallsPerRun).toBe(64)

      const { state: s2, respond: r2 } = capture({ id: 2, type: 'run-terminated' })
      server.use(mswHttp.post('/ia/api/v1/admin/circuit-breaker/terminate-run', r2))
      await circuitAdminApi.terminateRun({ runId: 'run-1', reason: '失控循环' })
      expect(s2.body).toEqual({ runId: 'run-1', reason: '失控循环' })
      expect(s2.req!.method).toBe('POST')
    })
  })

  describe('Webhook(deliveries=任务 #18b 真契约)', () => {
    it('saveConfig:PUT /webhooks/config(端点待服务端,形状即未来契约)', async () => {
      const { state, respond } = capture({ appId: 1, url: 'https://host/callback', secretMasked: '••••', enabled: true, events: ['run.finished'] })
      server.use(mswHttp.put('/ia/api/v1/admin/webhooks/config', respond))
      const resp = await webhookAdminApi.saveConfig({ url: 'https://host/callback', secret: 's3cret', events: ['run.finished'] })
      expect(state.body).toEqual({ url: 'https://host/callback', secret: 's3cret', events: ['run.finished'] })
      expect(resp.secretMasked).toBe('••••')
    })

    it('deliveries:GET /webhook-deliveries(#18b 真路径);线上 epoch 毫秒归一为 ISO', async () => {
      const { state, respond } = capture({
        list: [{
          id: 71, appId: 1, event: 'run.finished', runId: 'run-2040', url: 'https://host/callback',
          success: true, status: 'SUCCESS', attempt: 1, maxAttempts: 5, httpStatus: 200,
          responseSummary: 'OK', nextRetryAt: null, deliveredAt: 1758350315000,
        }],
        total: 1, pageNo: 1, pageSize: 10,
      })
      server.use(mswHttp.get('/ia/api/v1/admin/webhook-deliveries', respond))
      const page = await webhookAdminApi.deliveries({ event: 'run.failed', success: false, pageNo: 1, pageSize: 10 })
      const url = new URL(state.req!.url)
      expect(url.pathname).toBe('/ia/api/v1/admin/webhook-deliveries')
      expect(url.searchParams.get('event')).toBe('run.failed')
      expect(url.searchParams.get('success')).toBe('false')
      expect(page.list[0]!.deliveredAt).toBe(new Date(1758350315000).toISOString())
      expect(page.list[0]!.status).toBe('SUCCESS')
    })

    it('redeliver:POST /webhook-deliveries/{id}/redeliver(#18b 手动重投)', async () => {
      const { state, respond } = capture({
        id: 72, appId: 1, event: 'run.failed', runId: 'run-2041', url: 'https://host/callback',
        success: false, status: 'PENDING', attempt: 0, maxAttempts: 5,
        httpStatus: null, responseSummary: null, nextRetryAt: null, deliveredAt: null,
      })
      server.use(mswHttp.post('/ia/api/v1/admin/webhook-deliveries/72/redeliver', respond))
      const d = await webhookAdminApi.redeliver(72)
      expect(state.req!.method).toBe('POST')
      expect(state.req!.url).toContain('/webhook-deliveries/72/redeliver')
      expect(d.status).toBe('PENDING')
      expect(d.attempt).toBe(0)
    })
  })

  it('buildQuery 跳过 undefined/null/空串;false/0 为有效过滤值', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: 'x', f: false, g: 0 })).toBe('?a=1&e=x&f=false&g=0')
    expect(buildQuery({})).toBe('')
  })
})
