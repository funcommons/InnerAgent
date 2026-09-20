/**
 * [new] msw 请求处理器全集(P2-pre 阶段唯一"后端")。
 * P2 对齐:apps/tools/grants 三域行为按服务端真实控制器逐条镜像
 * (AdminAppController/AdminToolController/AdminGrantController + 对应 Service);
 * 信封 {code,msg,data},错误 HTTP 状态=业务 code;认证对齐 AdminTokenFilter
 * (X-IA-Admin-Key 缺失/无效一律 403 缺省封闭)。
 * 仍为 mock 的域(服务端未实现,保持原语义):audit-logs(行形已对齐 ia_audit_log)、
 * model-configs(依赖并行任务)、circuit-breaker、webhooks。
 *
 * 动作语义镜像(真实 Service):
 *   - apps:appKey 重复 409;非法 PEM 400;status 仅 0/1 生效;删除前 404 校验
 *   - tools:serverKey 仅字母/数字/连字符 400;FQN 唯一 409;删除/资金/凭据类
 *     关键词强制高危且不可下调 400;活刷新分诊 unchanged/compatible/breaking
 *     (mock 以「新 schema 含 required 判 breaking」,联调以服务端分诊矩阵为准);
 *     breaking 级联失效授权(schema_breaking);confirm/reject 无待确认 → 400
 *   - grants:permanent 携带会话/conversation 缺会话 → 400;工具未注册 404、
 *     已停用 400;同作用域有效授权重复 → 409;撤销可携 decisionNote
 */
import { http, HttpResponse } from 'msw'
import type { DefaultBodyType } from 'msw'
import type { CommonResult, PageResult } from '@/api/common'
import type {
  CircuitBreakerEvent,
  IaApp,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  IaToolSchemaHistory,
  ToolRegisterReq,
  WebhookDelivery,
  WebhookEvent,
} from '@/api/types'
import { fakeSha256, genId, maskKey, resetMockData, store } from './data'

/** mock 登录约定 key(任意非空亦可,此值供测试断言;服务端无登录端点,凭据逐请求校验) */
export const MOCK_ADMIN_KEY = 'ia-admin-mock-key'
export { resetMockData } from './data'

function ok<T>(data: T, init?: ResponseInit): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code: 0, msg: 'success', data } satisfies CommonResult<T>, init)
}

/** 错误信封(对齐服务端:HTTP 状态=业务 code,体 {code,msg,data:null}) */
function fail(code: number, msg: string, status = code): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code, msg, data: null }, { status })
}

/** 管理凭据校验(对齐 AdminTokenFilter:一律 403,除 mock 登录外全部生效) */
function requireAdminKey(request: Request): HttpResponse<DefaultBodyType> | null {
  const key = request.headers.get('X-IA-Admin-Key')
  if (!key) {
    return fail(403, '管理面凭据无效:请携带 X-IA-Admin-Key 请求头', 403)
  }
  return null
}

/** 通用分页器(仅服务端未实现分页的 mock 域使用) */
function paginate<T>(list: T[], pageNo = 1, pageSize = 10): PageResult<T> {
  const start = (pageNo - 1) * pageSize
  return { list: list.slice(start, start + pageSize), total: list.length, pageNo, pageSize }
}

/** PEM 宽松校验(mock 不做 X509 解析;服务端为 RSA 公钥强校验,非法 → 400) */
function looksLikePem(pem: unknown): pem is string {
  return typeof pem === 'string'
    && pem.includes('-----BEGIN PUBLIC KEY-----')
    && pem.includes('-----END PUBLIC KEY-----')
}

/** 删除/资金/凭据类关键词(镜像 ToolRiskLevel.forcedHigh 的判定集合,节选) */
const FORCED_HIGH_KEYWORDS = [
  'delete', 'remove', 'drop', 'destroy', 'purge',
  'payment', 'refund', 'billing', 'charge', 'withdraw',
  'password', 'passwd', 'credential', 'secret', 'api_key', 'apikey',
  '删除', '退款', '资金', '密码', '凭据',
]

function forcedHigh(toolName: string, description?: string | null): boolean {
  const text = `${toolName} ${description ?? ''}`.toLowerCase()
  return FORCED_HIGH_KEYWORDS.some(k => text.includes(k))
}

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 }

function nowIso(): string {
  return new Date().toISOString()
}

// ==================== 认证(mock 登录占位:服务端无登录端点) ====================

const authHandlers = [
  http.post('/ia/api/v1/admin/auth/login', async ({ request }) => {
    const body = (await request.json()) as { adminKey?: string }
    if (!body?.adminKey) {
      return fail(400, 'adminKey 不能为空')
    }
    return ok({ ok: true, hint: 'mock 环境:任意非空 key 均可登录' })
  }),
  http.post('/ia/api/v1/admin/auth/logout', ({ request }) => {
    const denied = requireAdminKey(request)
    return denied ?? ok({ ok: true })
  }),
]

// ==================== 应用管理(镜像 AdminAppController/AdminAppService) ====================

const appHandlers = [
  http.get('/ia/api/v1/admin/apps', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    return ok(store.apps) // 真实形:数组,无分页
  }),
  http.get('/ia/api/v1/admin/apps/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    return app ? ok(app) : fail(404, `应用不存在: ${params.id}`)
  }),
  http.post('/ia/api/v1/admin/apps', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as Partial<IaApp>
    if (!body.appKey || !body.name || !body.signPublicKey) {
      return fail(400, 'appKey/name/signPublicKey 不能为空')
    }
    if (!looksLikePem(body.signPublicKey)) {
      return fail(400, 'signPublicKey 不是合法的 RSA 公钥 PEM')
    }
    if (store.apps.some(a => a.appKey === body.appKey)) {
      return fail(409, `应用 appKey 已存在: ${body.appKey}`)
    }
    const now = nowIso()
    const app: IaApp = {
      id: genId(),
      appKey: body.appKey,
      name: body.name,
      signPublicKey: body.signPublicKey,
      webhookUrl: body.webhookUrl ?? null,
      webhookSecret: body.webhookSecret ?? null,
      conversationRetentionDays: 180,
      status: 1,
      createTime: now,
      updateTime: now,
      deleted: false,
    }
    store.apps.unshift(app)
    return ok(app)
  }),
  http.put('/ia/api/v1/admin/apps/:id', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    if (!app) return fail(404, `应用不存在: ${params.id}`)
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.name === 'string' && body.name.trim()) app.name = body.name.trim()
    if (typeof body.signPublicKey === 'string' && body.signPublicKey.trim()) {
      if (!looksLikePem(body.signPublicKey)) {
        return fail(400, 'signPublicKey 不是合法的 RSA 公钥 PEM')
      }
      app.signPublicKey = body.signPublicKey.trim()
    }
    if (typeof body.webhookUrl === 'string') app.webhookUrl = body.webhookUrl.trim() || null
    if (typeof body.webhookSecret === 'string') app.webhookSecret = body.webhookSecret.trim() || null
    if (body.status === 0 || body.status === 1) app.status = body.status
    app.updateTime = nowIso()
    return ok(app)
  }),
  http.delete('/ia/api/v1/admin/apps/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.apps.findIndex(a => a.id === Number(params.id))
    if (idx < 0) return fail(404, `应用不存在: ${params.id}`)
    store.apps.splice(idx, 1)
    return ok(true)
  }),
]

// ==================== 工具注册(镜像 AdminToolController/ToolRegistryService) ====================

/** 记录一条 schema 历史(镜像 recordHistory) */
function recordHistory(
  entry: IaToolRegistry,
  previousSha256: string | null,
  newSha256: string | null,
  triage: IaToolSchemaHistory['triage'],
  outcome: IaToolSchemaHistory['outcome'],
  reasons: string[],
): void {
  store.schemaHistory.unshift({
    id: genId(),
    appId: entry.appId,
    toolId: entry.id,
    fqn: entry.fqn,
    previousSha256,
    newSha256,
    triage,
    outcome,
    actor: 'admin',
    detail: JSON.stringify(reasons),
    createTime: nowIso(),
  })
}

/** 级联失效授权(镜像 ToolGrantService.invalidateByFqn) */
function invalidateGrantsByFqn(toolFqn: string, reason: IaToolGrant['invalidatedReason']): number {
  let count = 0
  for (const g of store.grants) {
    if (g.toolFqn === toolFqn && !g.invalidated) {
      g.invalidated = true
      g.invalidatedReason = reason
      g.updateTime = nowIso()
      count++
    }
  }
  return count
}

const toolHandlers = [
  http.get('/ia/api/v1/admin/tools', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const serverKey = url.searchParams.get('serverKey')
    const enabled = url.searchParams.get('enabled')
    let list = store.tools
    if (serverKey) list = list.filter(t => t.serverKey === serverKey)
    if (enabled !== null) list = list.filter(t => String(t.enabled) === enabled)
    return ok(list) // 真实形:数组,无分页
  }),
  http.get('/ia/api/v1/admin/tools/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    return t ? ok(t) : fail(404, `工具不存在: ${params.id}`)
  }),
  http.get('/ia/api/v1/admin/tools/:id/schema-history', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    return ok(store.schemaHistory.filter(h => h.toolId === t.id))
  }),
  http.post('/ia/api/v1/admin/tools', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as ToolRegisterReq
    if (!body.serverKey || !/^[A-Za-z0-9-]{1,64}$/.test(body.serverKey)) {
      return fail(400, `serverKey 仅允许字母/数字/连字符(避用下划线,V25): ${body.serverKey ?? ''}`)
    }
    if (!body.toolName) return fail(400, 'toolName 不能为空')
    if (body.source !== 'host_app' && body.source !== 'third_party') {
      return fail(400, `source 仅支持 host_app/third_party: ${body.source ?? ''}`)
    }
    const fqn = `mcp__${body.serverKey}__${body.toolName}`
    if (store.tools.some(t => t.fqn === fqn && !t.deleted)) {
      return fail(409, `工具已注册: ${fqn}`)
    }
    // 注解生成默认风险级(V15)+ 强制高危(PRD §6.2.2);mock 不做 JSON 深解析,
    // 以 readOnlyHint/destructiveHint 字样近似
    const annotationsJson = body.annotationsJson ?? null
    let riskLevel = body.riskLevel ?? 'medium'
    if (!body.riskLevel) {
      if (annotationsJson?.includes('"destructiveHint":true')) riskLevel = 'high'
      else if (annotationsJson?.includes('"readOnlyHint":true')) riskLevel = 'low'
    }
    if (forcedHigh(body.toolName, body.description)) riskLevel = 'high'
    const resumeSafe = body.resumeSafe
      ?? (annotationsJson?.includes('"idempotentHint":true') ?? false)
    const now = nowIso()
    const entry: IaToolRegistry = {
      id: genId(),
      appId: 1,
      serverKey: body.serverKey,
      toolName: body.toolName,
      fqn,
      description: body.description ?? null,
      parametersSchema: body.parametersSchema ?? null,
      annotationsJson,
      riskLevel,
      adminPolicy: body.adminPolicy ?? null,
      resumeSafe,
      concurrencySafe: body.concurrencySafe ?? false,
      source: body.source,
      endpointUrl: body.endpointUrl ?? null,
      credentialsEnc: null,
      schemaSha256: fakeSha256(body.parametersSchema ?? fqn),
      toolVersion: body.toolVersion ?? null,
      revalidateRequired: false,
      pendingSchema: null,
      pendingAnnotationsJson: null,
      pendingSchemaSha256: null,
      pendingRefreshAt: null,
      enabled: body.enabled ?? true,
      lastTestStatus: null,
      createTime: now,
      updateTime: now,
      deleted: false,
    }
    store.tools.unshift(entry)
    return ok(entry)
  }),
  http.put('/ia/api/v1/admin/tools/:id', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    const body = (await request.json()) as {
      description?: string; riskLevel?: IaToolRegistry['riskLevel']; adminPolicy?: IaToolRegistry['adminPolicy']
      resumeSafe?: boolean; concurrencySafe?: boolean; toolVersion?: string
    }
    if (body.riskLevel) {
      if (body.riskLevel !== 'high' && forcedHigh(t.toolName, t.description)) {
        return fail(400, `删除/资金/凭据类工具强制高危,不可下调: ${t.toolName}`)
      }
      const upgraded = (RISK_ORDER[body.riskLevel] ?? 0) > (RISK_ORDER[t.riskLevel] ?? 0)
      t.riskLevel = body.riskLevel
      if (upgraded) invalidateGrantsByFqn(t.fqn, 'risk_upgrade')
    }
    if (body.adminPolicy !== undefined) {
      if (body.adminPolicy === null || body.adminPolicy === ('' as never)) t.adminPolicy = null
      else t.adminPolicy = body.adminPolicy
    }
    if (typeof body.resumeSafe === 'boolean') t.resumeSafe = body.resumeSafe
    if (typeof body.concurrencySafe === 'boolean') t.concurrencySafe = body.concurrencySafe
    if (typeof body.description === 'string') t.description = body.description
    if (typeof body.toolVersion === 'string') t.toolVersion = body.toolVersion
    t.updateTime = nowIso()
    return ok(t)
  }),
  http.post('/ia/api/v1/admin/tools/:id/schema', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    const body = (await request.json()) as { parametersSchema?: string; annotationsJson?: string; toolVersion?: string }
    if (typeof body.toolVersion === 'string') t.toolVersion = body.toolVersion

    // 分诊(mock 判据:无新 schema/与现库一致 → unchanged;含 required → breaking;
    // 其余差异 → compatible。联调以服务端 SchemaTriageService 矩阵为准)
    let verdict: 'unchanged' | 'compatible' | 'breaking'
    let reasons: string[]
    const nextSchema = body.parametersSchema
    if (!nextSchema || nextSchema === t.parametersSchema) {
      verdict = 'unchanged'
      reasons = ['schema 无差异(静默刷新)']
      recordHistory(t, t.schemaSha256, fakeSha256(nextSchema ?? t.fqn), 'unchanged', 'silent_refresh', reasons)
    } else if (nextSchema.includes('"required"')) {
      verdict = 'breaking'
      reasons = ['新增必填参数(安全相关差异)']
      t.pendingSchema = nextSchema
      t.pendingAnnotationsJson = body.annotationsJson ?? null
      t.pendingSchemaSha256 = fakeSha256(nextSchema)
      t.pendingRefreshAt = nowIso()
      t.revalidateRequired = true
      const invalidated = invalidateGrantsByFqn(t.fqn, 'schema_breaking')
      reasons.push(`存量授权已级联失效 ${invalidated} 条`)
      recordHistory(t, t.schemaSha256, t.pendingSchemaSha256, 'breaking', 'pending_review', reasons)
    } else {
      verdict = 'compatible'
      reasons = ['纯增量差异(新增可选参数),自动生效']
      t.parametersSchema = nextSchema
      if (body.annotationsJson) t.annotationsJson = body.annotationsJson
      t.schemaSha256 = fakeSha256(nextSchema)
      recordHistory(t, null, t.schemaSha256, 'compatible', 'applied', reasons)
    }
    t.updateTime = nowIso()
    return ok({
      toolId: t.id,
      fqn: t.fqn,
      verdict,
      reasons,
      revalidateRequired: t.revalidateRequired,
      effectiveSchemaSha256: t.schemaSha256,
      pendingSchemaSha256: t.pendingSchemaSha256,
    })
  }),
  http.post('/ia/api/v1/admin/tools/:id/schema/confirm', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    if (!t.revalidateRequired || !t.pendingSchemaSha256) {
      return fail(400, '该工具没有待重新确认的 schema 变更')
    }
    t.parametersSchema = t.pendingSchema
    t.annotationsJson = t.pendingAnnotationsJson
    t.schemaSha256 = t.pendingSchemaSha256
    t.pendingSchema = null
    t.pendingAnnotationsJson = null
    t.pendingSchemaSha256 = null
    t.pendingRefreshAt = null
    t.revalidateRequired = false
    t.updateTime = nowIso()
    recordHistory(t, null, t.schemaSha256, 'breaking', 'applied', ['revalidate_confirmed'])
    return ok(t)
  }),
  http.post('/ia/api/v1/admin/tools/:id/schema/reject', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    if (!t.revalidateRequired) {
      return fail(400, '该工具没有待重新确认的 schema 变更')
    }
    const rejectedSha = t.pendingSchemaSha256
    t.pendingSchema = null
    t.pendingAnnotationsJson = null
    t.pendingSchemaSha256 = null
    t.pendingRefreshAt = null
    t.revalidateRequired = false
    t.updateTime = nowIso()
    recordHistory(t, t.schemaSha256, rejectedSha, 'breaking', 'rejected', ['revalidate_rejected'])
    return ok(t)
  }),
  http.post('/ia/api/v1/admin/tools/:id/disable', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    t.enabled = false
    t.updateTime = nowIso()
    // 级联失效授权(PRD §6.2.1:停用从白名单摘除)
    invalidateGrantsByFqn(t.fqn, 'tool_disabled')
    return ok(t)
  }),
  http.post('/ia/api/v1/admin/tools/:id/enable', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    t.enabled = true
    t.updateTime = nowIso()
    return ok(t)
  }),
  http.delete('/ia/api/v1/admin/tools/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.tools.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `工具不存在: ${params.id}`)
    invalidateGrantsByFqn(store.tools[idx]!.fqn, 'tool_deleted')
    store.tools.splice(idx, 1)
    return ok(true)
  }),
]

// ==================== 工具授权(镜像 AdminGrantController/ToolGrantService) ====================

const grantHandlers = [
  http.get('/ia/api/v1/admin/grants', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')
    const toolName = url.searchParams.get('toolName')
    const scope = url.searchParams.get('scope')
    const activeOnly = url.searchParams.get('activeOnly') !== 'false' // 服务端默认 true
    let list = [...store.grants].sort((a, b) => b.id - a.id) // 镜像 orderByDesc(id)
    if (userId) list = list.filter(g => g.userId === Number(userId))
    if (scope) list = list.filter(g => g.scope === scope)
    if (toolName) {
      // 镜像:按 toolName 解析 FQN(未注册工具 → 空列表)
      const tool = store.tools.find(t => t.toolName === toolName)
      list = tool ? list.filter(g => g.toolFqn === tool.fqn) : []
    }
    if (activeOnly) list = list.filter(g => !g.invalidated) // deleted 行已物理移除
    return ok(list) // 真实形:数组,无分页
  }),
  http.post('/ia/api/v1/admin/grants', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as {
      userId?: number; toolName?: string; scope?: IaToolGrant['scope']; conversationId?: string; decisionNote?: string
    }
    if (body.userId === undefined || body.userId === null) return fail(400, 'userId 不能为空')
    if (!body.toolName) return fail(400, 'toolName 不能为空')
    if (body.scope !== 'conversation' && body.scope !== 'permanent') {
      return fail(400, `scope 仅支持 conversation/permanent: ${body.scope ?? ''}`)
    }
    if (body.scope === 'permanent' && body.conversationId) {
      return fail(400, 'permanent 授权不携带会话 ID')
    }
    if (body.scope === 'conversation' && !body.conversationId) {
      return fail(400, 'conversation 授权必须携带会话 ID')
    }
    const tool = store.tools.find(t => t.toolName === body.toolName)
    if (!tool) return fail(404, `工具未注册: ${body.toolName}`)
    if (!tool.enabled) return fail(400, `工具已停用,不能授予: ${body.toolName}`)
    const dup = store.grants.find(g => g.userId === body.userId && g.toolFqn === tool.fqn && !g.invalidated
      && (g.conversationId === (body.conversationId ?? null)
        || (body.scope === 'permanent' && g.scope === 'permanent')))
    if (dup) return fail(409, '该用户对此工具已存在同作用域的有效授权')
    const now = nowIso()
    const grant: IaToolGrant = {
      id: genId(),
      appId: tool.appId,
      userId: body.userId,
      toolFqn: tool.fqn,
      scope: body.scope,
      conversationId: body.scope === 'conversation' ? (body.conversationId ?? null) : null,
      riskAtGrant: tool.riskLevel,
      schemaSha256: tool.schemaSha256,
      source: 'admin',
      invalidated: false,
      invalidatedReason: null,
      decisionNote: body.decisionNote ?? null,
      tenantId: 0,
      createTime: now,
      updateTime: now,
      deleted: false,
    }
    store.grants.unshift(grant)
    return ok(grant)
  }),
  http.delete('/ia/api/v1/admin/grants/:id', async ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.grants.findIndex(g => g.id === Number(params.id))
    if (idx < 0) return fail(404, `授权不存在: ${params.id}`)
    store.grants.splice(idx, 1) // 镜像 @TableLogic 逻辑删除:列表不再返回
    return ok(true)
  }),
]

// ==================== 审计查询(mock 域:服务端未实现;行形已对齐 ia_audit_log) ====================

const auditHandlers = [
  http.get('/ia/api/v1/admin/audit-logs', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const url = new URL(request.url)
    const appId = url.searchParams.get('appId')
    const userId = url.searchParams.get('userId')
    const decisionSource = url.searchParams.get('decisionSource')
    const decision = url.searchParams.get('decision')
    const toolFqn = url.searchParams.get('toolFqn')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let list = [...store.auditLogs].sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
    if (appId) list = list.filter(l => l.appId === Number(appId))
    if (userId) list = list.filter(l => l.userId === Number(userId))
    if (decisionSource) list = list.filter(l => l.decisionSource === decisionSource)
    if (decision) list = list.filter(l => l.decision === decision)
    if (toolFqn) list = list.filter(l => (l.toolFqn ?? '').includes(toolFqn))
    if (from) list = list.filter(l => String(l.createTime) >= from)
    if (to) list = list.filter(l => String(l.createTime) <= to)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
]

// ==================== 模型配置(依赖并行任务,联调时核对) ====================

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
    if (!body.name || !body.platform) return fail(400, 'name/platform 不能为空')
    const now = nowIso()
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
    if (!m) return fail(404, `模型配置不存在: ${params.id}`)
    const body = (await request.json()) as Partial<IaModelApiConfig> & { apiKey?: string }
    if (typeof body.name === 'string') m.name = body.name
    if (typeof body.platform === 'string') m.platform = body.platform as IaModelApiConfig['platform']
    if (typeof body.apiUrl === 'string') m.apiUrl = body.apiUrl
    if (typeof body.autoAppendV1Path === 'boolean') m.autoAppendV1Path = body.autoAppendV1Path
    if (typeof body.status === 'number') m.status = body.status
    if (typeof body.remark === 'string') m.remark = body.remark
    if (typeof body.apiKey === 'string' && body.apiKey) m.apiKeyMasked = maskKey(body.apiKey)
    m.updateTime = nowIso()
    return ok(m)
  }),
  http.delete('/ia/api/v1/admin/model-configs/:id', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const idx = store.modelConfigs.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `模型配置不存在: ${params.id}`)
    store.modelConfigs.splice(idx, 1)
    return ok(true)
  }),
  http.post('/ia/api/v1/admin/model-configs/:id/test', ({ request, params }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const m = store.modelConfigs.find(x => x.id === Number(params.id))
    if (!m) return fail(404, `模型配置不存在: ${params.id}`)
    return ok({ configId: m.id, ok: true, responseText: `[mock] ${m.name} 连通正常`, durationMs: 128, testedAt: nowIso() })
  }),
]

// ==================== 熔断与资源上限(mock 域:服务端未实现) ====================

function pushEvent(type: CircuitBreakerEvent['type'], runId: string | null, reason: string): CircuitBreakerEvent {
  const event: CircuitBreakerEvent = { id: genId(), type, runId, reason, operator: 'admin', occurredAt: nowIso() }
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
    if (!body.reason) return fail(400, 'reason 不能为空')
    store.circuitState.emergencyStopped = true
    store.circuitState.stoppedAt = nowIso()
    store.circuitState.stopReason = body.reason ?? null
    return ok(pushEvent('emergency-stop', null, body.reason))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/resume', ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    store.circuitState.emergencyStopped = false
    store.circuitState.stoppedAt = null
    store.circuitState.stopReason = null
    return ok(pushEvent('resume', null, '人工恢复'))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/terminate-run', async ({ request }) => {
    const denied = requireAdminKey(request)
    if (denied) return denied
    const body = (await request.json()) as { runId?: string; reason?: string }
    if (!body.runId || !body.reason) return fail(400, 'runId/reason 不能为空')
    return ok(pushEvent('run-terminated', body.runId, body.reason))
  }),
]

// ==================== Webhook(mock 域:服务端未实现) ====================

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
      deliveredAt: nowIso(),
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
