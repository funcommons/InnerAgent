/**
 * [new] msw 请求处理器全集(本任务唯一"后端")。
 * 契约:《02-技术方案》§7.1 `/ia/api/v1/admin/*`;自拟处见 src/api/types.ts 头清单。
 *
 * 认证约定(mock):除 /auth/login 外,所有 /ia/api/v1/admin/** 请求必须携带
 * 非空 X-IA-Admin-Key 头,否则 401(信封 code=10301)。
 * 动作语义(与 P2 后端对齐的目标行为):
 *   - tools/{id}/disable:停用并级联失效该工具全部授权(PRD §6.2.1)
 *   - tools/{id}/refresh:活刷新分诊——按 id 奇偶模拟 additive(自动接受)/
 *     security-related(需重新确认)
 *   - tool-grants:同 (userId,toolFqn,scope) 重复授予返回 10401
 */
import { http, HttpResponse } from 'msw'
import type { DefaultBodyType } from 'msw'
import { ApiErrorCode } from '@/api/errorCodes'
import type { CommonResult, PageResult } from '@/api/common'
import type {
  CircuitBreakerEvent,
  IaApp,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  ToolRegisterReq,
  WebhookDelivery,
  WebhookEvent,
} from '@/api/types'
import { fakeSha256, genId, maskKey, resetMockData, store } from './data'

/** mock 登录约定 key(任意非空亦可,此值供测试断言) */
export const MOCK_ADMIN_KEY = 'ia-admin-mock-key'
export { resetMockData } from './data'

function ok<T>(data: T, init?: ResponseInit): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code: 0, data } satisfies CommonResult<T>, init)
}

function fail(code: number, message: string, status = 200): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code, message }, { status })
}

/** 管理凭据校验(除 login 外全部生效) */
function requireAdminKey(request: Request): HttpResponse<DefaultBodyType> | null {
  const key = request.headers.get('X-IA-Admin-Key')
  if (!key) {
    return fail(ApiErrorCode.ADMIN_KEY_INVALID, '缺少 X-IA-Admin-Key,请先登录管理站', 401)
  }
  return null
}

/** 通用分页器(内存 list → PageResult) */
function paginate<T>(list: T[], pageNo = 1, pageSize = 10): PageResult<T> {
  const start = (pageNo - 1) * pageSize
  return { list: list.slice(start, start + pageSize), total: list.length, pageNo, pageSize }
}

// ==================== 认证(占位) ====================

const authHandlers = [
  http.post('/ia/api/v1/admin/auth/login', async ({ request }) => {
    const body = (await request.json()) as { adminKey?: string }
    if (!body?.adminKey) {
      return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'adminKey 不能为空')
    }
    return ok({ ok: true, hint: 'mock 环境:任意非空 key 均可登录' })
  }),
  http.post('/ia/api/v1/admin/auth/logout', ({ request }) => {
    const denied = requireAdminKey(request)
    return denied ?? ok({ ok: true })
  }),
]

// ==================== 应用管理 ====================

const appHandlers = [
  http.get('/ia/api/v1/admin/apps', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const keyword = url.searchParams.get('keyword') || ''
    const status = url.searchParams.get('status')
    let list = store.apps
    if (keyword) list = list.filter(a => a.name.includes(keyword) || a.appKey.includes(keyword))
    if (status !== null) list = list.filter(a => String(a.status) === status)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.get('/ia/api/v1/admin/apps/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    return app ? ok(app) : fail(ApiErrorCode.RESOURCE_NOT_FOUND, '应用不存在')
  }),
  http.post('/ia/api/v1/admin/apps', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { appKey: string; name: string; retentionDays?: number; remark?: string }
    if (!body.appKey || !body.name) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'appKey/name 不能为空')
    if (store.apps.some(a => a.appKey === body.appKey)) return fail(ApiErrorCode.DATA_ALREADY_EXISTS, 'appKey 已存在')
    const now = new Date().toISOString()
    const app: IaApp = {
      id: genId(), appKey: body.appKey, name: body.name, status: 1,
      signPublicKey: null, signKeyFingerprint: null, signKeyUpdatedAt: null,
      retentionDays: body.retentionDays ?? 180,
      emergencyStopped: false, emergencyStopReason: null,
      webhookUrl: null, webhookSecretMasked: null, webhookEnabled: false,
      remark: body.remark ?? null, createTime: now, updateTime: now,
    }
    store.apps.unshift(app)
    return ok(app)
  }),
  http.put('/ia/api/v1/admin/apps/:id', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    if (!app) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '应用不存在')
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.name === 'string') app.name = body.name
    if (typeof body.status === 'number') app.status = body.status
    if (typeof body.retentionDays === 'number') app.retentionDays = body.retentionDays
    if (typeof body.webhookUrl === 'string') app.webhookUrl = body.webhookUrl
    if (typeof body.webhookSecret === 'string') app.webhookSecretMasked = maskKey(body.webhookSecret)
    if (typeof body.webhookEnabled === 'boolean') app.webhookEnabled = body.webhookEnabled
    if (typeof body.remark === 'string') app.remark = body.remark
    app.updateTime = new Date().toISOString()
    return ok(app)
  }),
  http.post('/ia/api/v1/admin/apps/:id/public-key', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    if (!app) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '应用不存在')
    const body = (await request.json()) as { publicKey?: string }
    if (!body.publicKey?.includes('BEGIN PUBLIC KEY')) {
      return fail(ApiErrorCode.PARAMETER_FORMAT_ERROR, '公钥须为 RSA PEM 格式', 400)
    }
    return applyPublicKey(app, body.publicKey)
  }),
  http.post('/ia/api/v1/admin/apps/:id/public-key/rotate', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    if (!app) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '应用不存在')
    const body = (await request.json()) as { publicKey?: string }
    if (!body.publicKey) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'publicKey 不能为空')
    return applyPublicKey(app, body.publicKey)
  }),
]

function applyPublicKey(app: IaApp, publicKey: string): HttpResponse<DefaultBodyType> {
  const now = new Date().toISOString()
  app.signPublicKey = publicKey
  app.signKeyFingerprint = fakeSha256(publicKey)
  app.signKeyUpdatedAt = now
  app.updateTime = now
  return ok({ fingerprint: app.signKeyFingerprint, updatedAt: now })
}

// ==================== 工具注册 ====================

const toolHandlers = [
  http.get('/ia/api/v1/admin/tools', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const keyword = url.searchParams.get('keyword') || ''
    const riskLevel = url.searchParams.get('riskLevel')
    const status = url.searchParams.get('status')
    const serverKey = url.searchParams.get('serverKey')
    let list = store.tools
    if (keyword) list = list.filter(t => t.toolName.includes(keyword) || t.fqn.includes(keyword) || t.description.includes(keyword))
    if (riskLevel) list = list.filter(t => t.riskLevel === riskLevel)
    if (status !== null) list = list.filter(t => String(t.status) === status)
    if (serverKey) list = list.filter(t => t.serverKey === serverKey)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.get('/ia/api/v1/admin/tools/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    return t ? ok(t) : fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具不存在')
  }),
  http.post('/ia/api/v1/admin/tools/register', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as ToolRegisterReq
    if (!body.serverKey || !body.endpoint) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'serverKey/endpoint 不能为空')
    // 模拟一次 list_tools 拉取:固定两把工具(查/写各一)
    const now = new Date().toISOString()
    const created: IaToolRegistry[] = [`${body.serverKey}__get_status`, `${body.serverKey}__apply_change`].map((name, i) => ({
      id: genId(),
      appId: 1,
      serverKey: body.serverKey,
      serverName: body.serverName || body.serverKey,
      endpoint: body.endpoint,
      transport: body.transport ?? 'streamable_http',
      credentialMasked: body.credential ? maskKey(body.credential) : '••••',
      toolName: name.split('__')[1]!,
      fqn: `mcp__${name}`,
      description: i === 0 ? `查询 ${body.serverKey} 状态(注册时拉取)` : `提交 ${body.serverKey} 变更(注册时拉取)`,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      schemaFingerprint: fakeSha256(`register:${name}:${now}`),
      annotations: i === 0
        ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        : { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      riskLevel: i === 0 ? 'low' : 'high',
      writeOperation: i !== 0,
      adminPolicy: 'default',
      resumeSafe: i === 0,
      healthStatus: 'healthy',
      healthMessage: null,
      lastSyncedAt: now,
      status: 1,
      createTime: now,
      updateTime: now,
    }))
    store.tools.unshift(...created)
    return ok({ registered: created.length, tools: created })
  }),
  http.post('/ia/api/v1/admin/tools/:id/refresh', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具不存在')
    // 分诊模拟:偶数 id → 纯增量(自动接受);奇数 id → 安全相关(强制重新确认)
    const additive = t.id % 2 === 0
    const newFp = fakeSha256(`${t.fqn}:${t.schemaFingerprint}:refresh`)
    if (additive) {
      t.schemaFingerprint = newFp
      t.lastSyncedAt = new Date().toISOString()
    }
    return ok({
      fqn: t.fqn,
      schemaFingerprint: newFp,
      diffKind: additive ? 'additive' : 'security-related',
      applied: additive,
      message: additive
        ? '纯增量差异已自动接受并留审计'
        : '安全相关差异(新增必填参数):须重新确认后生效,进行中运行按快照不受影响',
    })
  }),
  http.post('/ia/api/v1/admin/tools/:id/disable', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具不存在')
    t.status = 0
    t.healthStatus = 'unknown'
    t.healthMessage = '已停用'
    // 级联失效授权(PRD §6.2.1 / 方案 S10)
    for (const g of store.grants) {
      if (g.toolFqn === t.fqn && !g.invalid) {
        g.invalid = true
        g.invalidReason = 'tool-disabled'
      }
    }
    return ok(t)
  }),
  http.post('/ia/api/v1/admin/tools/:id/enable', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具不存在')
    t.status = 1
    t.healthStatus = 'healthy'
    t.healthMessage = null
    return ok(t)
  }),
  http.patch('/ia/api/v1/admin/tools/:id/policy', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具不存在')
    const body = (await request.json()) as { riskLevel?: IaToolRegistry['riskLevel']; adminPolicy?: IaToolRegistry['adminPolicy']; resumeSafe?: boolean }
    if (body.riskLevel) {
      // 风险升级使存量授权失效(PRD §6.2.2)
      if (t.riskLevel !== body.riskLevel) {
        for (const g of store.grants) {
          if (g.toolFqn === t.fqn && !g.invalid) {
            g.invalid = true
            g.invalidReason = 'risk-upgraded'
          }
        }
      }
      t.riskLevel = body.riskLevel
    }
    if (body.adminPolicy) t.adminPolicy = body.adminPolicy
    if (typeof body.resumeSafe === 'boolean') t.resumeSafe = body.resumeSafe
    t.updateTime = new Date().toISOString()
    return ok(t)
  }),
]

// ==================== 工具授权 ====================

const grantHandlers = [
  http.get('/ia/api/v1/admin/tool-grants', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const toolFqn = url.searchParams.get('toolFqn')
    const userId = url.searchParams.get('userId')
    const scope = url.searchParams.get('scope')
    const includeInvalid = url.searchParams.get('includeInvalid') === 'true'
    let list = store.grants
    if (toolFqn) list = list.filter(g => g.toolFqn === toolFqn)
    if (userId) list = list.filter(g => g.userId === userId)
    if (scope) list = list.filter(g => g.scope === scope)
    if (!includeInvalid) list = list.filter(g => !g.invalid)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.post('/ia/api/v1/admin/tool-grants', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { userId?: string; toolFqn?: string; scope?: IaToolGrant['scope']; conversationId?: string }
    if (!body.userId || !body.toolFqn || !body.scope) {
      return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'userId/toolFqn/scope 不能为空')
    }
    const dup = store.grants.find(g => g.userId === body.userId && g.toolFqn === body.toolFqn
      && g.scope === body.scope && !g.invalid)
    if (dup) return fail(ApiErrorCode.DATA_ALREADY_EXISTS, '该用户对此工具的授权已存在')
    const t = store.tools.find(x => x.fqn === body.toolFqn)
    if (!t) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '工具未注册')
    const grant: IaToolGrant = {
      id: genId(), appId: t.appId, userId: body.userId, toolFqn: body.toolFqn, scope: body.scope,
      conversationId: body.scope === 'session' ? (body.conversationId ?? `conv-${genId()}`) : null,
      grantedRiskLevel: t.riskLevel, schemaFingerprint: t.schemaFingerprint,
      source: 'admin-grant', invalid: false, invalidReason: null, grantedAt: new Date().toISOString(),
    }
    store.grants.unshift(grant)
    return ok(grant)
  }),
  http.delete('/ia/api/v1/admin/tool-grants/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.grants.findIndex(g => g.id === Number(params.id))
    if (idx < 0) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '授权不存在')
    store.grants.splice(idx, 1)
    return ok({ ok: true })
  }),
]

// ==================== 审计查询 ====================

const auditHandlers = [
  http.get('/ia/api/v1/admin/audit-logs', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const appKey = url.searchParams.get('appKey')
    const userId = url.searchParams.get('userId')
    const decisionSource = url.searchParams.get('decisionSource')
    const toolFqn = url.searchParams.get('toolFqn')
    const resultStatus = url.searchParams.get('resultStatus')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let list = [...store.auditLogs].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    if (appKey) list = list.filter(l => l.appKey === appKey)
    if (userId) list = list.filter(l => l.userId === userId)
    if (decisionSource) list = list.filter(l => l.decisionSource === decisionSource)
    if (toolFqn) list = list.filter(l => l.toolFqn.includes(toolFqn))
    if (resultStatus) list = list.filter(l => l.resultStatus === resultStatus)
    if (from) list = list.filter(l => l.occurredAt >= from)
    if (to) list = list.filter(l => l.occurredAt <= to)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
]

// ==================== 模型配置 ====================

const modelHandlers = [
  http.get('/ia/api/v1/admin/model-configs', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const name = url.searchParams.get('name')
    const platform = url.searchParams.get('platform')
    const status = url.searchParams.get('status')
    let list = store.modelConfigs
    if (name) list = list.filter(m => m.name.includes(name))
    if (platform) list = list.filter(m => m.platform === platform)
    if (status !== null) list = list.filter(m => String(m.status) === status)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.post('/ia/api/v1/admin/model-configs', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { name?: string; platform?: string; apiKey?: string; apiUrl?: string; autoAppendV1Path?: boolean; remark?: string }
    if (!body.name || !body.platform) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'name/platform 不能为空')
    const now = new Date().toISOString()
    const created: IaModelApiConfig = {
      id: genId(), name: body.name, platform: body.platform as IaModelApiConfig['platform'],
      apiUrl: body.apiUrl ?? null, autoAppendV1Path: body.autoAppendV1Path ?? false,
      proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null,
      apiKeyMasked: maskKey(body.apiKey ?? ''),
      status: 1, remark: body.remark ?? null, createTime: now, updateTime: now,
    }
    store.modelConfigs.unshift(created)
    return ok(created)
  }),
  http.put('/ia/api/v1/admin/model-configs/:id', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const m = store.modelConfigs.find(x => x.id === Number(params.id))
    if (!m) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '模型配置不存在')
    const body = (await request.json()) as Partial<IaModelApiConfig> & { apiKey?: string }
    if (typeof body.name === 'string') m.name = body.name
    if (typeof body.platform === 'string') m.platform = body.platform as IaModelApiConfig['platform']
    if (typeof body.apiUrl === 'string') m.apiUrl = body.apiUrl
    if (typeof body.autoAppendV1Path === 'boolean') m.autoAppendV1Path = body.autoAppendV1Path
    if (typeof body.status === 'number') m.status = body.status
    if (typeof body.remark === 'string') m.remark = body.remark
    if (typeof body.apiKey === 'string' && body.apiKey) m.apiKeyMasked = maskKey(body.apiKey)
    m.updateTime = new Date().toISOString()
    return ok(m)
  }),
  http.delete('/ia/api/v1/admin/model-configs/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.modelConfigs.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '模型配置不存在')
    store.modelConfigs.splice(idx, 1)
    return ok({ ok: true })
  }),
  http.post('/ia/api/v1/admin/model-configs/:id/test', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const m = store.modelConfigs.find(x => x.id === Number(params.id))
    if (!m) return fail(ApiErrorCode.RESOURCE_NOT_FOUND, '模型配置不存在')
    return ok({ configId: m.id, ok: true, responseText: `[mock] ${m.name} 连通正常`, durationMs: 128, testedAt: new Date().toISOString() })
  }),
]

// ==================== 熔断与资源上限 ====================

function pushEvent(type: CircuitBreakerEvent['type'], runId: string | null, reason: string): CircuitBreakerEvent {
  const event: CircuitBreakerEvent = { id: genId(), type, runId, reason, operator: 'admin', occurredAt: new Date().toISOString() }
  store.circuitEvents.unshift(event)
  return event
}

const circuitHandlers = [
  http.get('/ia/api/v1/admin/circuit-breaker', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    return ok({
      emergencyStopped: store.circuitState.emergencyStopped,
      stoppedAt: store.circuitState.stoppedAt,
      stopReason: store.circuitState.stopReason,
      limits: store.limits,
      recentEvents: store.circuitEvents.slice(0, 20),
    })
  }),
  http.put('/ia/api/v1/admin/circuit-breaker/limits', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { limits?: Partial<typeof store.limits> }
    Object.assign(store.limits, body.limits ?? {})
    return ok(store.limits)
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/emergency-stop', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { reason?: string }
    if (!body.reason) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'reason 不能为空')
    store.circuitState.emergencyStopped = true
    store.circuitState.stoppedAt = new Date().toISOString()
    store.circuitState.stopReason = body.reason
    store.apps.forEach(a => { a.emergencyStopped = true; a.emergencyStopReason = body.reason! })
    return ok(pushEvent('emergency-stop', null, body.reason))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/resume', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    store.circuitState.emergencyStopped = false
    store.circuitState.stoppedAt = null
    store.circuitState.stopReason = null
    store.apps.forEach(a => { a.emergencyStopped = false; a.emergencyStopReason = null })
    return ok(pushEvent('resume', null, '人工恢复'))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/terminate-run', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { runId?: string; reason?: string }
    if (!body.runId || !body.reason) return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'runId/reason 不能为空')
    return ok(pushEvent('run-terminated', body.runId, body.reason))
  }),
]

// ==================== Webhook ====================

const webhookHandlers = [
  http.get('/ia/api/v1/admin/webhooks/config', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    return ok(store.webhookConfig)
  }),
  http.put('/ia/api/v1/admin/webhooks/config', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { url?: string; secret?: string; enabled?: boolean; events?: WebhookEvent[] }
    if (typeof body.url === 'string') store.webhookConfig.url = body.url
    if (typeof body.secret === 'string' && body.secret) store.webhookConfig.secretMasked = maskKey(body.secret)
    if (typeof body.enabled === 'boolean') store.webhookConfig.enabled = body.enabled
    if (Array.isArray(body.events)) store.webhookConfig.events = body.events
    return ok(store.webhookConfig)
  }),
  http.post('/ia/api/v1/admin/webhooks/config/test', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    return ok({ ok: true, signatureValid: true })
  }),
  http.get('/ia/api/v1/admin/webhooks/deliveries', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const event = url.searchParams.get('event')
    const success = url.searchParams.get('success')
    let list = [...store.deliveries].sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt))
    if (event) list = list.filter(d => d.event === event)
    if (success !== null) list = list.filter(d => String(d.success) === success)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.post('/ia/api/v1/admin/webhooks/deliveries/simulate-failure', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { event?: WebhookEvent; runId?: string }
    const delivery: WebhookDelivery = {
      id: genId(),
      event: (body.event ?? 'run.failed'),
      runId: body.runId ?? `run-${genId()}`,
      url: store.webhookConfig.url,
      success: false,
      attempt: 1,
      maxAttempts: 5,
      httpStatus: 503,
      responseSummary: '[mock] 模拟宿主 5xx,进入指数退避重试',
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
      deliveredAt: new Date().toISOString(),
    }
    store.deliveries.unshift(delivery)
    return ok(delivery)
  }),
]

export const handlers = [
  ...authHandlers,
  ...appHandlers,
  ...toolHandlers,
  ...grantHandlers,
  ...auditHandlers,
  ...modelHandlers,
  ...circuitHandlers,
  ...webhookHandlers,
]

// 模块加载即恢复种子,保证 dev/测试首屏即有数据
resetMockData()
