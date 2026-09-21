/**
 * [new] msw 请求处理器全集(dev 模式演示后端/单测拦截层)。
 * 行为按服务端真实控制器逐条镜像(AdminAppController/AdminToolController/
 * AdminGrantController/AdminAgentDefinitionController/AdminAuditController/
 * AdminModelConfigController/WebhookDeliveryAdminController + 对应 Service);
 * 信封 {code,msg,data},错误 HTTP 状态=业务 code;认证对齐 AdminTokenFilter
 * 双轨(DEF-01:Bearer 会话 token 无效 401;X-IA-Admin-Key 缺失/无效 403
 * 缺省封闭)。
 * P2 尾批镜像:tools/grants 分页兼容形(缺省数组/传参 PageResult)、工具体检
 * check+check-batch(V17 检查矩阵)、definitions 全域(列表/详情/提示词编辑/
 * export/import)、审计字典扩档(admin/definition-*)。
 * 待服务端落地的端点暂由本层供数(跟踪:99-优化建议.md #2):circuit-breaker
 * 全域、/webhooks/config 配置域;落地后 msw 仅作 dev 演示,不参与联调。
 *
 * 动作语义镜像(真实 Service):
 *   - apps:appKey 重复 409;非法 PEM 400;status 仅 0/1 生效;删除前 404 校验;
 *     公钥轮换 V9 语义(同值不算轮换,值变化置 signKeyRotatedAt+新指纹)
 *   - tools:serverKey 仅字母/数字/连字符 400;FQN 唯一 409;删除/资金/凭据类
 *     关键词强制高危且不可下调 400;活刷新分诊 unchanged/compatible/breaking
 *     (mock 以「新 schema 含 required 判 breaking」,联调以服务端分诊矩阵为准);
 *     breaking 级联失效授权(schema_breaking);confirm/reject 无待确认 → 400
 *   - grants:permanent 携带会话/conversation 缺会话 → 400;工具未注册 404、
 *     已停用 400;同作用域有效授权重复 → 409;撤销可携 decisionNote
 *   - webhook-deliveries:#18b 线上行形(时间=epoch 毫秒);redeliver 对
 *     PENDING 重复重投 → 409,重投重置 PENDING 并清空尝试历史
 */
import { http, HttpResponse } from 'msw'
import type { DefaultBodyType } from 'msw'
import type { CommonResult, PageResult } from '@/api/common'
import type {
  CircuitBreakerEvent,
  DefinitionBundleEntry,
  IaAgentDefinition,
  IaApp,
  IaFeedback,
  IaKbDocument,
  IaMcpServer,
  IaModelApiConfig,
  IaSkill,
  IaToolGrant,
  IaToolRegistry,
  IaToolSchemaHistory,
  KbSearchHitView,
  SkillDetailView,
  SkillFileView,
  SkillManifestView,
  SkillPreviewView,
  ToolCheckResult,
  ToolHealthCheckItem,
  ToolHealthStatus,
  ToolRegisterReq,
  UsageSummaryRow,
  WebhookDelivery,
  WebhookEvent,
} from '@/api/types'
import { fakeSha256, fakeFingerprint, genId, maskKey, resetMockData, store } from './data'

/** mock 登录约定 key(引导模式任意非空亦可;此值供测试断言) */
export const MOCK_ADMIN_KEY = 'ia-admin-mock-key'
export { resetMockData } from './data'

function ok<T>(data: T, init?: ResponseInit): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code: 0, msg: 'success', data } satisfies CommonResult<T>, init)
}

/** 错误信封(对齐服务端:HTTP 状态=业务 code,体 {code,msg,data:null}) */
function fail(code: number, msg: string, status = code): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code, msg, data: null }, { status })
}

/**
 * 管理凭据校验(DEF-01:对齐 AdminTokenFilter 双轨语义):
 * - Bearer 会话 token:mock 登录签发的 token 有效;无效 → 401「管理会话 token 无效」;
 * - X-IA-Admin-Key:任意非空可过(mock 无 key 库);缺失/空 → 403 缺省封闭。
 */
const issuedMockTokens = new Set<string>()

function requireAdminCredential(request: Request): HttpResponse<DefaultBodyType> | null {
  const authorization = request.headers.get('Authorization')
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length)
    if (token && issuedMockTokens.has(token)) return null
    return fail(401, '管理会话 token 无效', 401)
  }
  const key = request.headers.get('X-IA-Admin-Key')
  if (!key) {
    return fail(403, '管理面凭据无效:请携带 X-IA-Admin-Key 请求头', 403)
  }
  return null
}

/** 通用分页器(镜像服务端 PageResult 切片语义,供分页域 handler 复用) */
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

// ==================== 认证(DEF-01:镜像 AdminAuthController + AdminTokenFilter 双轨) ====================

const authHandlers = [
  http.post('/ia/api/v1/admin/auth/login', async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string }
    if (!body?.username || !body?.password) {
      return fail(400, '不能为空')
    }
    // mock 无账号库:非空账号密码即签发(mock 环境任意非空凭据均可登录;
    // 401/423 分支由 request 层单测以显式 override handler 覆盖)
    const token = `mock-admin-token-${issuedMockTokens.size + 1}`
    issuedMockTokens.add(token)
    return ok({
      token,
      tokenType: 'Bearer',
      expiresInSeconds: 14400,
      username: body.username,
    })
  }),
  http.post('/ia/api/v1/admin/auth/logout', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const authorization = request.headers.get('Authorization')
    if (authorization?.startsWith('Bearer ')) {
      issuedMockTokens.delete(authorization.slice('Bearer '.length))
    }
    return ok(true)
  }),
]

// ==================== 应用管理(镜像 AdminAppController/AdminAppService) ====================

const appHandlers = [
  http.get('/ia/api/v1/admin/apps', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    return ok(store.apps) // 真实形:数组,无分页
  }),
  http.get('/ia/api/v1/admin/apps/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    return app ? ok(app) : fail(404, `应用不存在: ${params.id}`)
  }),
  http.post('/ia/api/v1/admin/apps', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as Partial<IaApp> & { webhookSecret?: string }
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
      // 首次登记不算轮换(P2-key:rotateSignKey 仅在「同值不同」时置 rotatedAt)
      signKeyFingerprint: fakeFingerprint(body.signPublicKey),
      signKeyRotatedAt: null,
      webhookUrl: body.webhookUrl ?? null,
      webhookSecretMasked: maskKey(body.webhookSecret ?? ''),
      conversationRetentionDays: 180,
      status: 1,
      createTime: now,
      updateTime: now,
    }
    store.apps.unshift(app)
    return ok(app)
  }),
  http.put('/ia/api/v1/admin/apps/:id', async ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const app = store.apps.find(a => a.id === Number(params.id))
    if (!app) return fail(404, `应用不存在: ${params.id}`)
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.name === 'string' && body.name.trim()) app.name = body.name.trim()
    if (typeof body.signPublicKey === 'string' && body.signPublicKey.trim()) {
      const pem = body.signPublicKey.trim()
      if (!looksLikePem(pem)) {
        return fail(400, 'signPublicKey 不是合法的 RSA 公钥 PEM')
      }
      // 轮换语义(镜像 AdminAppService.rotateSignKey):同值重复 PUT 不算轮换;
      // 不同值 → rotatedAt=now + 新指纹(旧公钥进 72h 宽限期,V9)
      if (pem !== app.signPublicKey) {
        app.signKeyRotatedAt = nowIso()
        app.signKeyFingerprint = fakeFingerprint(pem)
      }
      app.signPublicKey = pem
    }
    if (typeof body.webhookUrl === 'string') app.webhookUrl = body.webhookUrl.trim() || null
    // write-only:空/缺省 = 不修改;非空 = 重置。响应仅回掩码(明文永不回显)
    if (typeof body.webhookSecret === 'string' && body.webhookSecret.trim()) {
      app.webhookSecretMasked = maskKey(body.webhookSecret.trim())
    }
    if (body.status === 0 || body.status === 1) app.status = body.status
    app.updateTime = nowIso()
    return ok(app)
  }),
  http.delete('/ia/api/v1/admin/apps/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
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
  // P2-W5 分页兼容形(镜像 AdminToolController.list):pageNo/pageSize 均缺省 →
  // 旧全量数组;任一出现 → PageResult(list/total/pageNo/pageSize,缺省 1/100);
  // 排序镜像 orderByAsc(serverKey, toolName)。
  http.get('/ia/api/v1/admin/tools', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const serverKey = url.searchParams.get('serverKey')
    const enabled = url.searchParams.get('enabled')
    const pageNo = url.searchParams.get('pageNo')
    const pageSize = url.searchParams.get('pageSize')
    let list = [...store.tools].sort((a, b) =>
      a.serverKey.localeCompare(b.serverKey) || a.toolName.localeCompare(b.toolName))
    if (serverKey) list = list.filter(t => t.serverKey === serverKey)
    if (enabled !== null) list = list.filter(t => String(t.enabled) === enabled)
    if (pageNo === null && pageSize === null) return ok(list) // 兼容形:数组
    return ok(paginate(list, Number(pageNo ?? 1), Number(pageSize ?? 100)))
  }),
  http.get('/ia/api/v1/admin/tools/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    return t ? ok(t) : fail(404, `工具不存在: ${params.id}`)
  }),
  http.get('/ia/api/v1/admin/tools/:id/schema-history', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    return ok(store.schemaHistory.filter(h => h.toolId === t.id))
  }),
  http.post('/ia/api/v1/admin/tools', async ({ request }) => {
    const denied = requireAdminCredential(request)
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
      // 工具体检位(V17):新注册行未体检(NULL 三列)
      healthStatus: null,
      lastCheckedAt: null,
      healthDetailJson: null,
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    t.enabled = true
    t.updateTime = nowIso()
    return ok(t)
  }),
  http.delete('/ia/api/v1/admin/tools/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.tools.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `工具不存在: ${params.id}`)
    invalidateGrantsByFqn(store.tools[idx]!.fqn, 'tool_deleted')
    store.tools.splice(idx, 1)
    return ok(true)
  }),
  // 工具体检 v1(V17,镜像 ToolHealthService 检查矩阵):endpoint_reachable →
  // tool_present → schema_fingerprint → annotations_diff;任一漂移 → degraded,
  // 握手失败 → unreachable。结论与明细落库(GET /admin/tools/{id} 可回读)。
  http.post('/ia/api/v1/admin/tools/:id/check', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const t = store.tools.find(x => x.id === Number(params.id))
    if (!t) return fail(404, `工具不存在: ${params.id}`)
    return ok(runMockCheck(t))
  }),
  // 批量/全量体检(镜像 AdminToolController.checkBatch 受理回执形;mock 同步
  // 执行完再返回,服务端为异步单线程逐个——UI 均按「受理后刷新可查」处理)
  http.post('/ia/api/v1/admin/tools/check-batch', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { ids?: number[] }
    const wanted = Array.isArray(body?.ids) && body.ids.length ? [...new Set(body.ids)] : null
    const targets = wanted ? store.tools.filter(t => wanted.includes(t.id)) : [...store.tools]
    const skipped = wanted ? wanted.filter(id => !targets.some(t => t.id === id)) : []
    for (const t of targets) runMockCheck(t)
    return ok({ accepted: true, total: targets.length, skipped })
  }),
]

/**
 * mock 宿主清单(镜像 McpToolHealthChecker 探活通道的 mock 形):
 * - host_app 经宿主桥一律可达;third_party endpointUrl 含 'down' → 握手失败
 *   (unreachable);清单缺失注册工具名 → tool_present 漂移(degraded);
 * - 清单条目 schemaSha256/annotationsJson 给定且与注册行不等 → 指纹/注解
 *   漂移(degraded);缺省=与注册一致(pass)。
 */
const MOCK_HOST_MANIFEST: Record<string, Array<{ name: string; schemaSha256?: string; annotationsJson?: string }>> = {
  demo_host: [
    { name: 'get_user' },
    { name: 'update_user' },
    { name: 'reset_password' },
    { name: 'list_login_records' },
    // 注解漂移演示:宿主不再上报 destructiveHint(注册行仍有)
    { name: 'delete_flow', annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}' },
    // 指纹漂移演示:宿主 schema 与注册快照不一致
    { name: 'refresh_cache', schemaSha256: 'sha256:drift0008' },
    { name: 'export_users' },
  ],
  crm: [{ name: 'search_customers' }],
}

/** 执行检查矩阵并落库体检位(镜像 ToolHealthService.executeAndPersist) */
function runMockCheck(t: IaToolRegistry): ToolCheckResult {
  const checks: ToolHealthCheckItem[] = []
  const finish = (status: ToolHealthStatus): ToolCheckResult => {
    const detail = { status, checks: checks.map(c => ({ ...c, detail: c.detail ?? undefined, advice: c.advice ?? undefined })) }
    t.healthStatus = status
    t.lastCheckedAt = nowIso()
    t.healthDetailJson = JSON.stringify(detail)
    return { toolId: t.id, fqn: t.fqn, toolName: t.toolName, status, checks, detailJson: t.healthDetailJson }
  }
  if (t.endpointUrl?.includes('down')) {
    checks.push({ check: 'endpoint_reachable', status: 'drift', detail: 'MCP initialize 握手失败(连接拒绝/超时)', advice: '宿主端点不可达:核对 endpoint_url 与宿主桥可用性,或注销该工具' })
    return finish('unreachable')
  }
  checks.push({ check: 'endpoint_reachable', status: 'pass', detail: 'MCP initialize/listTools 握手成功' })
  const manifest = MOCK_HOST_MANIFEST[t.serverKey] ?? []
  const host = manifest.find(m => m.name === t.toolName)
  if (!host) {
    checks.push({ check: 'tool_present', status: 'drift', detail: `宿主清单 ${manifest.length} 个工具中不含 ${t.toolName}`, advice: '宿主可能已下线/改名该工具:核对宿主,或注销注册行(v1 归入 degraded 档)' })
    return finish('degraded')
  }
  checks.push({ check: 'tool_present', status: 'pass', detail: 'toolName 在宿主清单中' })
  let status: ToolHealthStatus = 'ok'
  if (host.schemaSha256 !== undefined && host.schemaSha256 !== t.schemaSha256) {
    checks.push({ check: 'schema_fingerprint', status: 'drift', detail: `注册 ${shortSha(t.schemaSha256)} ≠ 宿主 ${shortSha(host.schemaSha256)}`, advice: 'schema 指纹漂移:建议经 POST /admin/tools/{id}/schema 重发走活刷新分诊' })
    status = 'degraded'
  } else {
    checks.push({ check: 'schema_fingerprint', status: 'pass', detail: '指纹一致' })
  }
  if (host.annotationsJson !== undefined && host.annotationsJson !== t.annotationsJson) {
    checks.push({ check: 'annotations_diff', status: 'drift', detail: '差异键: destructiveHint', advice: '注解与宿主上报存在差异(readOnlyHint/idempotentHint 等策略软输入):建议复核风险级与 resumeSafe' })
    status = 'degraded'
  } else {
    checks.push({ check: 'annotations_diff', status: 'pass', detail: '注解一致' })
  }
  return finish(status)
}

/** 指纹短形(镜像 ToolHealthService.shortSha) */
function shortSha(sha: string | null): string {
  if (!sha) return '(empty)'
  return sha.length <= 8 ? sha : sha.slice(0, 8) + '…'
}

// ==================== 工具授权(镜像 AdminGrantController/ToolGrantService) ====================

const grantHandlers = [
  // P2-W5 分页兼容形(镜像 AdminGrantController.list):pageNo/pageSize 均缺省 →
  // 旧全量数组;任一出现 → PageResult(缺省 1/100);activeOnly 默认 true 且已
  // 下推 SQL 条件(invalidated=FALSE),计数与过滤一致。
  http.get('/ia/api/v1/admin/grants', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')
    const toolName = url.searchParams.get('toolName')
    const scope = url.searchParams.get('scope')
    const pageNo = url.searchParams.get('pageNo')
    const pageSize = url.searchParams.get('pageSize')
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
    if (pageNo === null && pageSize === null) return ok(list) // 兼容形:数组
    return ok(paginate(list, Number(pageNo ?? 1), Number(pageSize ?? 100)))
  }),
  http.post('/ia/api/v1/admin/grants', async ({ request }) => {
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.grants.findIndex(g => g.id === Number(params.id))
    if (idx < 0) return fail(404, `授权不存在: ${params.id}`)
    store.grants.splice(idx, 1) // 镜像 @TableLogic 逻辑删除:列表不再返回
    return ok(true)
  }),
]

// ==================== Agent 定义(镜像 AdminAgentDefinitionController,P2-W5) ====================

const DEFINITION_SLOTS = ['systemPrompt', 'instructionTemplate', 'greeting'] as const
const DEFINITION_KINDS = ['main', 'sub']
const MAX_PROMPT_LENGTH = 65_536

/** 定义行 → bundle 条目(镜像 AgentDefinitionAdminService.toEntry:三槽全量导出) */
function toBundleEntry(d: IaAgentDefinition): DefinitionBundleEntry {
  return {
    definitionId: d.id,
    agentType: d.agentType,
    name: d.name,
    specJson: d.spec,
    prompts: [
      { slot: 'systemPrompt', content: d.prompts.systemPrompt },
      { slot: 'instructionTemplate', content: d.prompts.instructionTemplate },
      { slot: 'greeting', content: d.prompts.greeting },
    ],
  }
}

/** 定义管理审计(镜像 auditImport/updatePrompt:tool_fqn=agent-definition:<key>) */
function pushDefinitionAudit(
  decision: 'definition-updated' | 'definition-imported',
  agentType: string,
  params: Record<string, unknown>,
  summary: string,
): void {
  store.auditLogs.unshift({
    id: genId(), appId: 1, tenantId: 0, userId: null, conversationId: null, runId: null,
    toolFqn: `agent-definition:${agentType}`,
    decision, decisionSource: 'admin',
    riskLevel: null, paramsMaskedJson: JSON.stringify(params),
    resultSummary: summary, errorText: null, durationMs: null, createTime: nowIso(),
  })
}

const definitionHandlers = [
  // 列表:端点缺省即分页形 PageResult(缺省 1/10,agentKey 升序)——无数组兼容档
  http.get('/ia/api/v1/admin/definitions', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const list = [...store.definitions].sort((a, b) => a.agentType.localeCompare(b.agentType))
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.get('/ia/api/v1/admin/definitions/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.definitions.find(x => x.id === Number(params.id))
    return d ? ok(d) : fail(404, `Agent 定义不存在: ${params.id}`)
  }),
  // 提示词单槽编辑(镜像 AgentDefinitionAdminService.updatePrompt:slot 值域/
  // content 非空/65536 上限/systemPrompt 非空白;旧值快照落审计,fail-closed)
  http.put('/ia/api/v1/admin/definitions/:id/prompt', async ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.definitions.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `Agent 定义不存在: ${params.id}`)
    const body = (await request.json()) as { slot?: string; content?: string | null }
    const slot = typeof body.slot === 'string' ? body.slot.trim() : ''
    if (!DEFINITION_SLOTS.includes(slot as never)) {
      return fail(400, `未知提示词槽位: ${body.slot ?? ''},允许值 ${DEFINITION_SLOTS.join('/')}`)
    }
    if (body.content === null || body.content === undefined) {
      return fail(400, 'content 不能为空(清空槽位传空字符串)')
    }
    if (body.content.length > MAX_PROMPT_LENGTH) {
      return fail(400, `提示词超过长度上限 ${MAX_PROMPT_LENGTH} 字符: 当前 ${body.content.length}`)
    }
    if (slot === 'systemPrompt' && !body.content.trim()) {
      return fail(400, 'systemPrompt 不能为空白')
    }
    const oldContent = d.prompts[slot as keyof typeof d.prompts]
    d.prompts[slot as keyof typeof d.prompts] = body.content
    pushDefinitionAudit('definition-updated', d.agentType, {
      definitionId: d.id, agentType: d.agentType, slot, oldContent: oldContent ?? '',
    }, `prompt edited via admin; slot=${slot}`)
    return ok(d)
  }),
  // 导出 bundle(schemaVersion=1;ids 缺省=全量,未知 id 静默忽略)
  http.post('/ia/api/v1/admin/definitions/export', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { ids?: number[] }
    let rows = [...store.definitions].sort((a, b) => a.agentType.localeCompare(b.agentType))
    if (Array.isArray(body?.ids) && body.ids.length) {
      const wanted = new Set(body.ids)
      rows = rows.filter(d => wanted.has(d.id))
    }
    return ok({ schemaVersion: 1, exportedAt: nowIso(), definitions: rows.map(toBundleEntry) })
  }),
  // 导入(镜像 AgentDefinitionAdminService.importBundle:bundle 级校验 400 →
  // 条目级校验进 errors[] 继续其余 → 冲突按 skip/overwrite;dryRun 零副作用;
  // created+updated+skipped 只含有效条目,errors[] 不占 skipped)
  http.post('/ia/api/v1/admin/definitions/import', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { bundle?: unknown; conflictPolicy?: string; dryRun?: boolean }
    const policy = body.conflictPolicy ? body.conflictPolicy.trim().toLowerCase() : 'skip'
    if (policy !== 'skip' && policy !== 'overwrite') {
      return fail(400, `conflictPolicy 仅支持 skip/overwrite: ${body.conflictPolicy}`)
    }
    const dryRun = body.dryRun === true
    const bundle = (body.bundle ?? null) as { schemaVersion?: unknown; definitions?: unknown } | null
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      return fail(400, 'bundle 必须为 JSON 对象')
    }
    if (bundle.schemaVersion !== 1) {
      return fail(400, `不支持的 bundle schemaVersion: ${String(bundle.schemaVersion)},当前仅支持 1`)
    }
    if (!Array.isArray(bundle.definitions)) {
      return fail(400, 'bundle.definitions 必须为数组')
    }
    const errors: Array<{ agentType: string | null; reason: string }> = []
    let created = 0
    let updated = 0
    let skipped = 0
    for (const element of bundle.definitions) {
      const echoType = (element as { agentType?: unknown })?.agentType
      const agentTypeEcho = typeof echoType === 'string' ? echoType : null
      try {
        const entry = parseDefinitionEntry(element)
        const existing = store.definitions.find(d => d.agentType === entry.agentType)
        if (!existing) {
          if (!dryRun) {
            const row = entryToRow(entry)
            store.definitions.push(row)
            pushDefinitionAudit('definition-imported', entry.agentType,
              { agentType: entry.agentType, action: 'created', schemaVersion: 1 },
              'definition imported via admin; action=created')
          }
          created++
        } else if (policy === 'skip') {
          skipped++
        } else {
          if (!dryRun) {
            existing.name = entry.name
            if (entry.specJson) existing.spec = { ...existing.spec, ...entry.specJson }
            if (typeof entry.specJson?.kind === 'string') existing.kind = entry.specJson.kind as 'main' | 'sub'
            if (typeof entry.specJson?.enabled === 'boolean') existing.enabled = entry.specJson.enabled
            for (const p of entry.prompts) {
              existing.prompts[p.slot as keyof typeof existing.prompts] = p.content
            }
            pushDefinitionAudit('definition-updated', entry.agentType,
              { agentType: entry.agentType, action: 'overwritten', schemaVersion: 1 },
              'definition imported via admin; action=overwritten')
          }
          updated++
        }
      } catch (invalidEntry) {
        errors.push({ agentType: agentTypeEcho, reason: invalidEntry instanceof Error ? invalidEntry.message : String(invalidEntry) })
      }
    }
    return ok({ dryRun, created, updated, skipped, errors })
  }),
]

/** 条目级解析与校验(镜像 parseEntry/validateSpec/toNewRow 的 400 语义) */
function parseDefinitionEntry(element: unknown): DefinitionBundleEntry {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    throw new Error('定义条目必须为 JSON 对象')
  }
  const e = element as Record<string, unknown>
  const agentType = typeof e.agentType === 'string' ? e.agentType.trim() : ''
  if (!agentType) throw new Error('agentType 不能为空')
  if (agentType.length > 64) throw new Error(`agentType 超长(≤64): ${agentType}`)
  const name = typeof e.name === 'string' ? e.name.trim() : ''
  if (!name) throw new Error(`name 不能为空: ${agentType}`)
  if (name.length > 255) throw new Error(`name 超长(≤255): ${agentType}`)
  const specJson = (e.specJson ?? null) as Record<string, unknown> | null
  if (specJson && (Array.isArray(specJson) || typeof specJson !== 'object')) {
    throw new Error(`specJson 必须为 JSON 对象: ${agentType}`)
  }
  if (specJson) {
    const kind = specJson.kind
    if (kind !== undefined && kind !== null && (typeof kind !== 'string' || !DEFINITION_KINDS.includes(kind))) {
      throw new Error(`specJson.kind 仅支持 main/sub: ${agentType}`)
    }
    const enabled = specJson.enabled
    if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') {
      throw new Error(`specJson.enabled 必须为布尔: ${agentType}`)
    }
    for (const field of ['toolWhitelist', 'subAgentTools'] as const) {
      const v = specJson[field]
      if (v !== undefined && v !== null && !Array.isArray(v)) {
        throw new Error(`specJson.${field} 必须为数组: ${agentType}`)
      }
    }
  }
  const prompts = (e.prompts ?? []) as Array<{ slot?: unknown; content?: unknown }>
  if (!Array.isArray(prompts)) throw new Error(`prompts 必须为数组: ${agentType}`)
  const normalizedPrompts: DefinitionBundleEntry['prompts'] = []
  for (const p of prompts) {
    if (!p || typeof p !== 'object') throw new Error(`prompts 条目必须为对象: ${agentType}`)
    const slot = typeof p.slot === 'string' ? p.slot : ''
    if (!DEFINITION_SLOTS.includes(slot as never)) {
      throw new Error(`未知提示词槽位: ${p.slot ?? ''},允许值 ${DEFINITION_SLOTS.join('/')}: ${agentType}`)
    }
    normalizedPrompts.push({ slot: slot as (typeof DEFINITION_SLOTS)[number], content: typeof p.content === 'string' ? p.content : null })
  }
  // 新定义必须带非空白 systemPrompt(镜像 toNewRow 落库前校验;overwrite 不受限)
  const systemPromptEntry = normalizedPrompts.find(p => p.slot === 'systemPrompt')
  const isNew = !store.definitions.some(d => d.agentType === agentType)
  if (isNew && !(systemPromptEntry?.content ?? '').trim()) {
    throw new Error(`新定义 systemPrompt 不能为空: ${agentType}`)
  }
  return {
    definitionId: typeof e.definitionId === 'number' ? e.definitionId : null,
    agentType,
    name,
    specJson,
    prompts: normalizedPrompts,
  }
}

/** bundle 条目 → 新库行(镜像 toNewRow:缺省 kind=main/enabled=true) */
function entryToRow(entry: DefinitionBundleEntry): IaAgentDefinition {
  const spec = entry.specJson ?? {}
  const prompts = { systemPrompt: null, instructionTemplate: null, greeting: null } as IaAgentDefinition['prompts']
  for (const p of entry.prompts) {
    prompts[p.slot as keyof typeof prompts] = p.content
  }
  return {
    id: genId(),
    appId: 1,
    agentType: entry.agentType,
    kind: (typeof spec.kind === 'string' && DEFINITION_KINDS.includes(spec.kind) ? spec.kind : 'main') as IaAgentDefinition['kind'],
    name: entry.name,
    enabled: typeof spec.enabled === 'boolean' ? spec.enabled : true,
    prompts,
    spec: { kind: 'main', enabled: true, modelId: null, toolWhitelist: null, subAgentTools: null, contextTemplate: null, ...spec },
    modelId: typeof spec.modelId === 'number' ? spec.modelId : null,
  }
}

// ==================== 审计查询(镜像 AdminAuditController,W5) ====================

const auditHandlers = [
  // 字典端点(#12):decision_source/decision 实际值域(逐条镜像
  // ToolAuditQueryService 字典:V8 expired + P2-W5 admin/definition-updated/
  // definition-imported。run-terminated/blocked/redacted 为真实落库码值但
  // 服务端字典尚未枚举——web 兜底常量补齐,见 stores/audit.ts)
  http.get('/ia/api/v1/admin/audit-logs/dictionary', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    return ok({
      decisionSources: [
        { code: 'mode-default', description: '模式默认路径(只读放行/写确认)' },
        { code: 'user-grant', description: '用户「总是允许」授权' },
        { code: 'forced-policy', description: '管理员强制策略' },
        { code: 'live-confirm', description: '确认流实弹批准' },
        { code: 'expired', description: '确认超时系统裁决(过期=denied)' },
        { code: 'full-access', description: 'FULL_ACCESS 全开放' },
        { code: 'admin', description: '管理面定义变更(提示词编辑/导入导出)' },
      ],
      decisions: [
        { code: 'allowed', description: '工具调用放行' },
        { code: 'denied', description: '工具调用拒绝' },
        { code: 'granted', description: '授权授予' },
        { code: 'revoked', description: '授权撤销' },
        { code: 'invalidated', description: '授权自动失效' },
        { code: 'schema_compatible', description: 'schema 纯增量变更自动接受' },
        { code: 'schema_breaking', description: 'schema 安全相关差异强确认' },
        { code: 'risk_upgraded', description: '风险级人工上调' },
        { code: 'tool_disabled', description: '工具停用' },
        { code: 'definition-updated', description: 'Agent 定义变更(提示词编辑/覆盖导入)' },
        { code: 'definition-imported', description: 'Agent 定义导入新建' },
      ],
    })
  }),
  http.get('/ia/api/v1/admin/audit-logs', ({ request }) => {
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
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
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { name?: string; platform?: string; textProtocol?: string; apiKey?: string; apiUrl?: string; autoAppendV1Path?: boolean; remark?: string }
    if (!body.name || !body.platform) return fail(400, 'name/platform 不能为空')
    const now = nowIso()
    const created: IaModelApiConfig = {
      id: genId(), name: body.name, platform: body.platform as IaModelApiConfig['platform'],
      // 镜像 normalizeProtocol:空值落 NULL,显式值归一小写下划线
      textProtocol: body.textProtocol ? body.textProtocol.trim().toLowerCase().replace(/[ -]/g, '_') : null,
      apiUrl: body.apiUrl ?? null, autoAppendV1Path: body.autoAppendV1Path ?? false,
      proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null,
      apiKeyMasked: maskKey(body.apiKey ?? ''),
      status: 1, remark: body.remark ?? null, createTime: now, updateTime: now,
    }
    store.modelConfigs.unshift(created)
    return ok(created)
  }),
  http.put('/ia/api/v1/admin/model-configs/:id', async ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const m = store.modelConfigs.find(x => x.id === Number(params.id))
    if (!m) return fail(404, `模型配置不存在: ${params.id}`)
    const body = (await request.json()) as Partial<IaModelApiConfig> & { apiKey?: string }
    if (typeof body.name === 'string') m.name = body.name
    if (typeof body.platform === 'string') m.platform = body.platform as IaModelApiConfig['platform']
    if (typeof body.textProtocol === 'string') m.textProtocol = body.textProtocol || null
    if (typeof body.apiUrl === 'string') m.apiUrl = body.apiUrl
    if (typeof body.autoAppendV1Path === 'boolean') m.autoAppendV1Path = body.autoAppendV1Path
    if (typeof body.status === 'number') m.status = body.status
    if (typeof body.remark === 'string') m.remark = body.remark
    if (typeof body.apiKey === 'string' && body.apiKey) m.apiKeyMasked = maskKey(body.apiKey)
    m.updateTime = nowIso()
    return ok(m)
  }),
  http.delete('/ia/api/v1/admin/model-configs/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.modelConfigs.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `模型配置不存在: ${params.id}`)
    store.modelConfigs.splice(idx, 1)
    return ok(true)
  }),
  http.post('/ia/api/v1/admin/model-configs/:id/test', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const m = store.modelConfigs.find(x => x.id === Number(params.id))
    if (!m) return fail(404, `模型配置不存在: ${params.id}`)
    return ok({ configId: m.id, ok: true, responseText: `[mock] ${m.name} 连通正常`, durationMs: 128, testedAt: nowIso() })
  }),
]

// ==================== 熔断与资源上限(镜像 AdminCircuitBreakerController) ====================

function pushEvent(type: CircuitBreakerEvent['type'], runId: string | null, reason: string): CircuitBreakerEvent {
  const event: CircuitBreakerEvent = { id: genId(), type, runId, reason, operator: 'admin', occurredAt: nowIso() }
  store.circuitEvents.unshift(event)
  return event
}

const circuitHandlers = [
  http.get('/ia/api/v1/admin/circuit-breaker', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    return ok({
      emergencyStopped: store.circuitState.emergencyStopped,
      stoppedAt: store.circuitState.stoppedAt,
      stopReason: store.circuitState.stopReason,
      limits: store.limits,
      activeRuns: store.circuitState.activeRuns,
      recentEvents: store.circuitEvents.slice(0, 20),
    })
  }),
  http.put('/ia/api/v1/admin/circuit-breaker/limits', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { limits?: Partial<typeof store.limits> }
    Object.assign(store.limits, body.limits ?? {})
    return ok(store.limits)
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/emergency-stop', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { reason?: string }
    if (!body.reason) return fail(400, 'reason 不能为空')
    store.circuitState.emergencyStopped = true
    store.circuitState.stoppedAt = nowIso()
    store.circuitState.stopReason = body.reason ?? null
    return ok(pushEvent('emergency-stop', null, body.reason))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/resume', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    store.circuitState.emergencyStopped = false
    store.circuitState.stoppedAt = null
    store.circuitState.stopReason = null
    return ok(pushEvent('resume', null, '人工恢复'))
  }),
  http.post('/ia/api/v1/admin/circuit-breaker/terminate-run', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { runId?: string; reason?: string }
    if (!body.runId || !body.reason) return fail(400, 'runId/reason 不能为空')
    return ok(pushEvent('run-terminated', body.runId, body.reason))
  }),
]

// ==================== Webhook(deliveries=#18b;config=AdminWebhookConfigController 镜像) ====================

const webhookHandlers = [
  http.get('/ia/api/v1/admin/webhooks/config', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    return ok(store.webhookConfig)
  }),
  http.put('/ia/api/v1/admin/webhooks/config', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as { url?: string; secret?: string; enabled?: boolean; events?: WebhookEvent[] }
    if (typeof body.url === 'string') store.webhookConfig.url = body.url
    if (typeof body.secret === 'string' && body.secret) store.webhookConfig.secretMasked = maskKey(body.secret)
    if (typeof body.enabled === 'boolean') store.webhookConfig.enabled = body.enabled
    if (Array.isArray(body.events)) store.webhookConfig.events = body.events
    return ok(store.webhookConfig)
  }),
  http.post('/ia/api/v1/admin/webhooks/config/test', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    // 镜像 WebhookConfigAdminService.test:未配置 url → 400;响应含 httpStatus/error
    if (!store.webhookConfig.url) {
      return fail(400, '尚未配置 Webhook 回调地址,请先保存 url 后再测试')
    }
    return ok({
      ok: true,
      signatureValid: Boolean(store.webhookConfig.secretMasked),
      httpStatus: 200,
      error: null,
    })
  }),
  // 镜像 WebhookDeliveryAdminController(GET /admin/webhook-deliveries):
  // 线上时间字段为 epoch 毫秒(web/api 层负责归一为 ISO)
  http.get('/ia/api/v1/admin/webhook-deliveries', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const event = url.searchParams.get('event')
    const status = url.searchParams.get('status')
    const byDeliveredDesc = (a: WebhookDelivery, b: WebhookDelivery) =>
      String(b.deliveredAt ?? b.nextRetryAt ?? '').localeCompare(String(a.deliveredAt ?? a.nextRetryAt ?? ''))
    let list = [...store.deliveries].sort(byDeliveredDesc)
    if (event) list = list.filter(d => d.event === event)
    if (status) list = list.filter(d => d.status === status)
    const page = paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10))
    return ok({
      ...page,
      list: page.list.map(d => ({
        id: d.id,
        appId: d.appId,
        event: d.event,
        runId: d.runId,
        url: d.url,
        success: d.success,
        status: d.status,
        attempt: d.attempt,
        maxAttempts: d.maxAttempts,
        httpStatus: d.httpStatus,
        responseSummary: d.responseSummary,
        nextRetryAt: d.nextRetryAt ? Date.parse(d.nextRetryAt) : null,
        deliveredAt: d.deliveredAt ? Date.parse(d.deliveredAt) : null,
      })),
    })
  }),
  // 镜像 POST /admin/webhook-deliveries/{id}/redeliver:SUCCESS/FAILED/EXHAUSTED →
  // PENDING,清空尝试历史;PENDING 重复重投 → 409(镜像 WebhookDeliveryAdminService)
  http.post('/ia/api/v1/admin/webhook-deliveries/:id/redeliver', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.deliveries.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `投递记录不存在: ${params.id}`)
    if (d.status === 'PENDING') return fail(409, '该投递已在待投递队列中,无需重投')
    d.status = 'PENDING'
    d.success = false
    d.attempt = 0
    d.httpStatus = null
    d.responseSummary = '手动重投(重置回 PENDING)'
    d.nextRetryAt = null
    d.deliveredAt = null
    return ok({
      id: d.id,
      appId: d.appId,
      event: d.event,
      runId: d.runId,
      url: d.url,
      success: d.success,
      status: d.status,
      attempt: d.attempt,
      maxAttempts: d.maxAttempts,
      httpStatus: d.httpStatus,
      responseSummary: d.responseSummary,
      nextRetryAt: null,
      deliveredAt: null,
    })
  }),
]

// ==================== 三方 MCP 服务器(镜像 AdminMcpServerController/McpAppServerService,P4-W13) ====================

/**
 * credentials 打码(镜像 McpServerRespVO.mask):null/空白 → null;
 * ≤2 字符 → '***';否则前 2 字符 + '***'。明文永不回显。
 */
function maskCredentials(credentials: string | null | undefined): string | null {
  if (credentials == null || credentials.trim() === '') return null
  return credentials.length <= 2 ? '***' : credentials.slice(0, 2) + '***'
}

/** 应用级防遮蔽冲突域(镜像 McpAppServerService.requireServerKeyFree):
 * ① 本表唯一;② 与宿主注册表工具的 serverKey 冲突(防遮蔽)→ 409 */
function requireMcpServerKeyFree(serverKey: string): HttpResponse<DefaultBodyType> | null {
  if (store.mcpServers.some(s => s.serverKey === serverKey)) {
    return fail(409, `serverKey 已被应用级三方 MCP 服务占用: ${serverKey}`)
  }
  if (store.tools.some(t => !t.deleted && t.serverKey === serverKey)) {
    return fail(409, `serverKey 与宿主注册表工具的 serverKey 冲突(防遮蔽): ${serverKey}`)
  }
  return null
}

/**
 * 应用级注册/更新字段级校验+归一化(镜像 McpThirdPartyServerSupport.normalize,
 * userFacing=false)。credentials 空值语义(P4 差距收口 K③):mode=REQUIRED
 * (注册)必填;mode=KEEP_IF_ABSENT(更新)null/空串 → credentials=undefined
 * (= 保持原值哨兵,handler 跳过掩码覆盖),非空 → 覆盖。
 */
function normalizeMcpUpsert(
  body: Record<string, unknown>,
  mode: 'REQUIRED' | 'KEEP_IF_ABSENT',
): { error?: HttpResponse<DefaultBodyType> } & Partial<IaMcpServer> & { credentials?: string } {
  const serverKey = typeof body.serverKey === 'string' ? body.serverKey.trim() : ''
  if (!serverKey) return { error: fail(400, 'serverKey 不能为空') }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(serverKey)) {
    return { error: fail(400, `serverKey 仅允许字母/数字/连字符(避用下划线,FQN 命名空间): ${serverKey}`) }
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: fail(400, '名称不能为空') }
  if (name.length > 128) return { error: fail(400, '名称超长(≤128)') }
  const transport = typeof body.transport === 'string' && body.transport.trim()
    ? body.transport.trim().toLowerCase()
    : 'streamable-http'
  if (transport !== 'streamable-http') {
    return { error: fail(400, `三方 MCP 当前仅支持 streamable-http 传输: ${transport}`) }
  }
  const authType = typeof body.authType === 'string' && body.authType.trim()
    ? body.authType.trim().toUpperCase()
    : 'STATIC_HEADER'
  if (authType === 'OAUTH') {
    return { error: fail(501, '三方 MCP OAuth(CIMD/DCR + RFC 8707)暂未实现:当前仅支持 STATIC_HEADER 静态头鉴权') }
  }
  if (authType !== 'STATIC_HEADER') {
    return { error: fail(400, `authType 仅支持 STATIC_HEADER/OAUTH: ${authType}`) }
  }
  const headerName = typeof body.headerName === 'string' ? body.headerName.trim() : ''
  if (!headerName) return { error: fail(400, '静态头名不能为空') }
  if (headerName.length > 128) return { error: fail(400, '静态头名超长(≤128)') }
  // K③ 空值语义:更新 null/空串 = 保持原值(哨兵 undefined);注册必填
  const rawCredentials = typeof body.credentials === 'string' ? body.credentials.trim() : ''
  let credentials: string | undefined
  if (mode === 'KEEP_IF_ABSENT' && !rawCredentials) {
    credentials = undefined
  } else {
    if (!rawCredentials) return { error: fail(400, '静态头值不能为空') }
    credentials = rawCredentials
  }
  const endpointUrl = typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : ''
  if (!endpointUrl) return { error: fail(400, 'endpoint URL 不能为空') }
  try {
    const uri = new URL(endpointUrl)
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
      return { error: fail(400, 'endpoint URL 必须是有效的 HTTP(S) URL') }
    }
  } catch {
    return { error: fail(400, 'endpoint URL 必须是有效的 HTTP(S) URL') }
  }
  const timeoutSeconds = typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : 30
  if (timeoutSeconds < 1 || timeoutSeconds > 600) {
    return { error: fail(400, `timeoutSeconds 须在 1-600 之间: ${timeoutSeconds}`) }
  }
  return {
    serverKey,
    name,
    endpointUrl,
    transport: 'streamable-http',
    authType: 'STATIC_HEADER',
    headerName,
    credentials,
    timeoutSeconds,
    enabled: body.enabled === undefined ? true : body.enabled === true,
  }
}

const mcpServerHandlers = [
  http.get('/ia/api/v1/admin/mcp-servers', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    return ok(store.mcpServers) // 真实形:数组含停用,无分页
  }),
  http.get('/ia/api/v1/admin/mcp-servers/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.mcpServers.find(x => x.id === Number(params.id))
    return s ? ok(s) : fail(404, '三方 MCP 服务不存在')
  }),
  http.post('/ia/api/v1/admin/mcp-servers', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as Record<string, unknown>
    const normalized = normalizeMcpUpsert(body, 'REQUIRED')
    if (normalized.error) return normalized.error
    const conflict = requireMcpServerKeyFree(normalized.serverKey!)
    if (conflict) return conflict
    const row: IaMcpServer = {
      id: genId(),
      serverKey: normalized.serverKey!,
      name: normalized.name!,
      endpointUrl: normalized.endpointUrl!,
      transport: normalized.transport!,
      authType: normalized.authType!,
      headerName: normalized.headerName!,
      credentialsMasked: maskCredentials(normalized.credentials),
      timeoutSeconds: normalized.timeoutSeconds!,
      enabled: normalized.enabled!,
      updateTime: nowIso(),
    }
    store.mcpServers.unshift(row)
    return ok(row)
  }),
  http.put('/ia/api/v1/admin/mcp-servers/:id', async ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.mcpServers.find(x => x.id === Number(params.id))
    if (!s) return fail(404, '三方 MCP 服务不存在')
    const body = (await request.json()) as Record<string, unknown>
    // K③ 空值语义:更新 credentials null/空串 = 保持原值;显式非空 = 覆盖
    const normalized = normalizeMcpUpsert(body, 'KEEP_IF_ABSENT')
    if (normalized.error) return normalized.error
    if (normalized.serverKey !== s.serverKey) {
      const conflict = requireMcpServerKeyFree(normalized.serverKey!)
      if (conflict) return conflict
    }
    Object.assign(s, {
      serverKey: normalized.serverKey,
      name: normalized.name,
      endpointUrl: normalized.endpointUrl,
      transport: normalized.transport,
      authType: normalized.authType,
      headerName: normalized.headerName,
      timeoutSeconds: normalized.timeoutSeconds,
      enabled: normalized.enabled,
      updateTime: nowIso(),
    })
    if (normalized.credentials) s.credentialsMasked = maskCredentials(normalized.credentials)
    return ok(s)
  }),
  http.post('/ia/api/v1/admin/mcp-servers/:id/enable', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.mcpServers.find(x => x.id === Number(params.id))
    if (!s) return fail(404, '三方 MCP 服务不存在')
    s.enabled = true
    s.updateTime = nowIso()
    return ok(s)
  }),
  http.post('/ia/api/v1/admin/mcp-servers/:id/disable', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.mcpServers.find(x => x.id === Number(params.id))
    if (!s) return fail(404, '三方 MCP 服务不存在')
    s.enabled = false
    s.updateTime = nowIso()
    return ok(s)
  }),
  http.delete('/ia/api/v1/admin/mcp-servers/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.mcpServers.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, '三方 MCP 服务不存在')
    store.mcpServers.splice(idx, 1)
    return ok(true)
  }),
]

// ==================== Skill 目录(镜像 AdminSkillController/AppSkillCatalogService,P4-W13) ====================

/** 应用内同时激活上限(PRD 缺省 8,可配;镜像 SkillHubProperties.maxActivePerApp) */
const SKILL_MAX_ACTIVE_PER_APP = 8

/** mock zip 解析:测试/演示形态——由文本内容构造包(真实端点收 multipart zip)。 */
interface MockSkillZip {
  manifest: { name?: string; displayName?: string; description?: string; version?: string }
  files: Array<{ path: string; encoding: 'utf-8' | 'base64'; content: string }>
}

/**
 * multipart file 提取(镜像 @RequestPart("file") 语义):
 * 最小 multipart 解析,仅取 name="file" 部件(演示层 zip 载荷为 UTF-8 文本;
 * 不走 request.formData()——jsdom 与 undici 的 File 品牌不互认,解析器会
 * 拒绝 jsdom File,逐字节手动解析对浏览器/测试环境行为一致)。
 */
async function extractMultipartFile(request: Request): Promise<{ name: string; text: string } | null> {
  const contentType = request.headers.get('content-type') ?? ''
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!match) return null
  const boundary = (match[1] ?? match[2] ?? '').trim()
  const raw = new TextDecoder().decode(await request.arrayBuffer())
  for (const part of raw.split(`--${boundary}`)) {
    const nameMatch = /name="([^"]*)"/.exec(part)
    if (!nameMatch || nameMatch[1] !== 'file') continue
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const filenameMatch = /filename="([^"]*)"/.exec(part)
    return {
      name: filenameMatch?.[1] || 'upload.zip',
      text: part.slice(headerEnd + 4).replace(/\r\n$/, ''),
    }
  }
  return null
}

/** zip 字节 → mock 包结构(演示层不做真 zip 解包,内容为 JSON 形承载清单+文件) */
function readMockSkillZip(text: string): MockSkillZip {
  try {
    const parsed = JSON.parse(text) as MockSkillZip
    if (parsed && typeof parsed === 'object' && parsed.manifest) return parsed
  } catch { /* 落到缺省空包 */ }
  return { manifest: {}, files: [] }
}

/** 包校验(镜像 SkillPackageInspector:清单必填/文件清单/警告;errors 非空即 invalid) */
function inspectMockSkillZip(pkg: MockSkillZip, fileName: string): SkillPreviewView {
  const errors: string[] = []
  const warnings: string[] = []
  const name = typeof pkg.manifest.name === 'string' ? pkg.manifest.name.trim() : ''
  if (!name) errors.push('清单 name 不能为空(skill.json)')
  if (name && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    errors.push(`清单 name 仅允许小写字母/数字/连字符: ${name}`)
  }
  if (typeof pkg.manifest.displayName === 'string' && pkg.manifest.displayName.length > 64) {
    errors.push('清单 displayName 不能超过 64 个字符')
  }
  const files = pkg.files ?? []
  if (name && !files.some(f => f.path === 'SKILL.md')) {
    warnings.push('包内缺少 SKILL.md(技能正文将不可见)')
  }
  if (name && files.length === 0) {
    errors.push('包内没有任何文件')
  }
  const manifest: SkillManifestView | null = name
    ? {
        name,
        displayName: pkg.manifest.displayName ?? name,
        description: pkg.manifest.description ?? null,
        version: pkg.manifest.version ?? null,
      }
    : null
  const fileViews: SkillFileView[] = files.map(f => ({
    path: f.path,
    encoding: f.encoding,
    sizeBytes: f.content.length,
    content: f.content,
  }))
  return {
    fileName,
    valid: errors.length === 0,
    manifest,
    files: fileViews,
    warnings,
    errors,
    totalBytes: fileViews.reduce((sum, f) => sum + f.sizeBytes, 0),
  }
}

function toSkillRow(preview: SkillPreviewView, appId = 1): IaSkill {
  return {
    id: genId(),
    appId,
    name: preview.manifest!.name,
    displayName: preview.manifest!.displayName,
    description: preview.manifest!.description,
    version: preview.manifest!.version,
    status: 'inactive',
    source: 'import',
    contentSha256: fakeSha256(preview.fileName + preview.totalBytes),
    active: false,
  }
}

const skillHandlers = [
  // 预览(dryRun 零落库;校验不过仍 200,问题清单看 errors/warnings)
  http.post('/ia/api/v1/admin/skills/import/preview', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const upload = await extractMultipartFile(request)
    if (!upload) return fail(400, 'file 不能为空(multipart zip)')
    const pkg = readMockSkillZip(upload.text)
    return ok(inspectMockSkillZip(pkg, upload.name))
  }),
  // 确认导入(服务端重校验:invalid → 400;同名活跃行缺省 409,overwrite 覆盖;
  // 软删同名行按复活处理;激活上限校验在 activate 端点)
  http.post('/ia/api/v1/admin/skills/import', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const overwrite = url.searchParams.get('overwrite') === 'true'
    const displayName = url.searchParams.get('displayName')
    const upload = await extractMultipartFile(request)
    if (!upload) return fail(400, 'file 不能为空(multipart zip)')
    const pkg = readMockSkillZip(upload.text)
    const preview = inspectMockSkillZip(pkg, upload.name)
    if (!preview.valid) {
      return fail(400, `Skill 包未通过校验:${preview.errors.join(';')}`)
    }
    const manifestName = preview.manifest!.name
    const existing = store.skills.find(s => s.name === manifestName)
    if (existing && existing.active && !overwrite) {
      return fail(409, `同名 Skill 已存在且处于激活态: ${manifestName}(overwrite=true 可覆盖)`)
    }
    let row: IaSkill
    if (existing) {
      // 覆盖/复活:清单+内容整包替换(镜像 importSkill 的复活/覆盖语义)
      existing.displayName = displayName?.trim() || preview.manifest!.displayName
      existing.description = preview.manifest!.description
      existing.version = preview.manifest!.version
      existing.contentSha256 = fakeSha256(upload.name + preview.totalBytes)
      existing.status = 'inactive'
      existing.active = false
      row = existing
    } else {
      row = toSkillRow(preview)
      if (displayName?.trim()) row.displayName = displayName.trim()
      store.skills.unshift(row)
    }
    return ok(row)
  }),
  // 分页列表(id 降序;含激活状态)
  http.get('/ia/api/v1/admin/skills', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const list = [...store.skills].sort((a, b) => b.id - a.id)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  // 详情(含全部文件内容;mock 从包文本重读不可行,回演示文件清单)
  http.get('/ia/api/v1/admin/skills/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.skills.find(x => x.id === Number(params.id))
    if (!s) return fail(404, `Skill 不存在: ${params.id}`)
    const files: SkillFileView[] = [{
      path: 'SKILL.md',
      encoding: 'utf-8',
      sizeBytes: s.description?.length ?? 0,
      content: s.description ?? '',
    }]
    return ok({ skill: s, files } satisfies SkillDetailView)
  }),
  // 激活:应用内同时上限 8(镜像 activate:已达上限 → 409 明确报错)
  http.post('/ia/api/v1/admin/skills/:id/activate', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.skills.find(x => x.id === Number(params.id))
    if (!s) return fail(404, `Skill 不存在: ${params.id}`)
    if (s.status !== 'active') {
      const activeCount = store.skills.filter(x => x.appId === s.appId && x.status === 'active').length
      if (activeCount >= SKILL_MAX_ACTIVE_PER_APP) {
        return fail(409, `应用内同时激活的 Skill 已达上限 ${SKILL_MAX_ACTIVE_PER_APP},请先停用后再激活`)
      }
      s.status = 'active'
      s.active = true
    }
    return ok(s)
  }),
  http.post('/ia/api/v1/admin/skills/:id/deactivate', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const s = store.skills.find(x => x.id === Number(params.id))
    if (!s) return fail(404, `Skill 不存在: ${params.id}`)
    s.status = 'inactive'
    s.active = false
    return ok(s)
  }),
  http.delete('/ia/api/v1/admin/skills/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.skills.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `Skill 不存在: ${params.id}`)
    store.skills.splice(idx, 1) // 镜像逻辑删除:列表不再返回,同名再导入按复活
    return ok(true)
  }),
]

// ==================== mini 知识库(镜像 AdminKbController/KbIngestService,P4-W14) ====================

/** 单 app 文档数上限(PRD 缺省 1000;mock 取小值便于演示) */
const KB_MAX_DOCUMENTS_PER_APP = 1000

function normalizeKbChunkParams(body: { chunkSize?: unknown; chunkOverlap?: unknown }): { chunkSize: number; chunkOverlap: number } | HttpResponse<DefaultBodyType> {
  const chunkSize = typeof body.chunkSize === 'number' && body.chunkSize > 0 ? body.chunkSize : 500
  const chunkOverlap = typeof body.chunkOverlap === 'number' && body.chunkOverlap >= 0 ? body.chunkOverlap : 50
  if (chunkOverlap >= chunkSize) {
    return fail(400, '分段参数不合法:chunkOverlap 须小于 chunkSize')
  }
  return { chunkSize, chunkOverlap }
}

function importKbDocument(body: {
  title?: unknown; source?: unknown; content?: unknown; metadata?: unknown
  chunkSize?: unknown; chunkOverlap?: unknown
}): { document?: IaKbDocument; error?: HttpResponse<DefaultBodyType> } {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { error: fail(400, '文档标题不能为空') }
  if (title.length > 256) return { error: fail(400, '文档标题不能超过 256 个字符') }
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  if (source.length > 256) return { error: fail(400, '来源标识不能超过 256 个字符') }
  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return { error: fail(400, '文档内容不能为空') }
  if (typeof body.metadata === 'string' && body.metadata.trim()) {
    try {
      const parsed: unknown = JSON.parse(body.metadata)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: fail(400, 'metadata 必须是 JSON 对象') }
      }
    } catch {
      return { error: fail(400, 'metadata 不是合法 JSON') }
    }
  }
  const chunk = normalizeKbChunkParams(body)
  if (chunk instanceof HttpResponse) return { error: chunk }
  if (store.kbDocuments.length >= KB_MAX_DOCUMENTS_PER_APP) {
    return { error: fail(409, `单应用知识库文档数已达上限 ${KB_MAX_DOCUMENTS_PER_APP},请清理后拆库再导入`) }
  }
  // 服务端分块语义(mock 近似:按 chunkSize 切片计数,空内容已在上面拦截)
  const chunkCount = Math.max(1, Math.ceil(content.length / chunk.chunkSize))
  const row: IaKbDocument = {
    id: genId(),
    appId: 1,
    title,
    source: source || null,
    status: 'active',
    chunkCount,
    active: true,
  }
  store.kbDocuments.unshift(row)
  return { document: row }
}

const kbHandlers = [
  http.post('/ia/api/v1/admin/kb/documents/import', async ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const body = (await request.json()) as Record<string, unknown>
    const result = importKbDocument(body)
    return result.error ?? ok(result.document)
  }),
  http.get('/ia/api/v1/admin/kb/documents/search', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    if (!q) return ok({ query: q, searchConfig: 'simple', degraded: true, hits: [] })
    const topK = Math.min(Math.max(Number(url.searchParams.get('topK') ?? 5), 1), 50)
    const sourceFilter = url.searchParams.get('source')
    // 检索语义(mock 近似服务端 tsvector 检索):标题/来源词包含匹配 active 文档,
    // 命中按标题前缀优先排序,内容片段为演示形
    const candidates = store.kbDocuments
      .filter(d => d.active && (!sourceFilter || d.source === sourceFilter))
      .filter(d => d.title.includes(q) || (d.source ?? '').includes(q) || q.length >= 1)
    const hits: KbSearchHitView[] = candidates.slice(0, topK).map((d, i) => ({
      chunkId: d.id * 100 + i,
      documentId: d.id,
      documentTitle: d.title,
      anchor: `§${i + 1}`,
      seq: i,
      content: `[mock] 「${q}」在《${d.title}》第 ${i + 1} 段的命中内容(演示层不做真实 tsvector 排序,联调以服务端检索为准)`,
    }))
    // 配置/降级标记(镜像 KbRetrievalService.effectiveSearchConfig/degraded)
    return ok({ query: q, searchConfig: 'tsvector', degraded: false, hits })
  }),
  http.get('/ia/api/v1/admin/kb/documents', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const list = [...store.kbDocuments].sort((a, b) => b.id - a.id)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  http.get('/ia/api/v1/admin/kb/documents/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.kbDocuments.find(x => x.id === Number(params.id))
    return d ? ok(d) : fail(404, `知识库文档不存在: ${params.id}`)
  }),
  http.put('/ia/api/v1/admin/kb/documents/:id', async ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.kbDocuments.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `知识库文档不存在: ${params.id}`)
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.title === 'string') {
      if (!body.title.trim()) return fail(400, '文档标题不能为空')
      d.title = body.title.trim()
    }
    if (typeof body.source === 'string') d.source = body.source.trim() || null
    if (typeof body.metadata === 'string' && body.metadata.trim()) {
      try { JSON.parse(body.metadata) } catch { return fail(400, 'metadata 不是合法 JSON') }
    }
    if (typeof body.content === 'string' && body.content.trim()) {
      const chunk = normalizeKbChunkParams(body)
      if (chunk instanceof HttpResponse) return chunk
      d.chunkCount = Math.max(1, Math.ceil(body.content.length / chunk.chunkSize))
    }
    return ok(d)
  }),
  http.post('/ia/api/v1/admin/kb/documents/:id/deactivate', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.kbDocuments.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `知识库文档不存在: ${params.id}`)
    d.status = 'inactive'
    d.active = false
    return ok(d)
  }),
  http.post('/ia/api/v1/admin/kb/documents/:id/activate', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.kbDocuments.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `知识库文档不存在: ${params.id}`)
    d.status = 'active'
    d.active = true
    return ok(d)
  }),
  // 重建索引(镜像 rebuild:按当前生效检索配置重算 tsv;mock 仅刷新分段数守恒)
  http.post('/ia/api/v1/admin/kb/documents/:id/rebuild-index', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const d = store.kbDocuments.find(x => x.id === Number(params.id))
    if (!d) return fail(404, `知识库文档不存在: ${params.id}`)
    return ok(d)
  }),
  http.delete('/ia/api/v1/admin/kb/documents/:id', ({ request, params }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const idx = store.kbDocuments.findIndex(x => x.id === Number(params.id))
    if (idx < 0) return fail(404, `知识库文档不存在: ${params.id}`)
    store.kbDocuments.splice(idx, 1)
    return ok(true)
  }),
]

// ==================== 用量统计(镜像 AdminUsageController/UsageQueryService,W15) ====================

function normalizeGranularity(value: string | null): 'DAY' | 'MONTH' | HttpResponse<DefaultBodyType> {
  if (!value || value.trim().toUpperCase() === 'DAY') return 'DAY'
  if (value.trim().toUpperCase() === 'MONTH') return 'MONTH'
  return fail(400, `granularity 仅支持 DAY / MONTH: ${value}`)
}

const usageHandlers = [
  // 聚合分页(appId/userId/from/to/granularity;镜像 UsageSummaryFilter 语义)
  http.get('/ia/api/v1/admin/usage/summary', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const granularity = normalizeGranularity(url.searchParams.get('granularity'))
    if (granularity instanceof HttpResponse) return granularity
    const appId = url.searchParams.get('appId')
    const userId = url.searchParams.get('userId')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let list: UsageSummaryRow[] = [...store.usageSummary].sort((a, b) =>
      b.statDate.localeCompare(a.statDate) || a.provider.localeCompare(b.provider) || a.modelCode.localeCompare(b.modelCode))
    if (appId) list = list.filter(r => r.appId === Number(appId))
    if (userId) list = list.filter(r => r.userId === Number(userId))
    if (from) list = list.filter(r => r.statDate >= from.slice(0, granularity === 'MONTH' ? 7 : 10))
    if (to) list = list.filter(r => r.statDate <= to.slice(0, granularity === 'MONTH' ? 7 : 10))
    if (granularity === 'MONTH') {
      // 月聚合(mock 近似:同 (userId,provider,modelCode,月) 合并计数;token 仅 COMPLETED 行)
      const merged = new Map<string, UsageSummaryRow>()
      for (const r of list) {
        const key = `${r.userId}|${r.provider}|${r.modelCode}|${r.statDate.slice(0, 7)}`
        const acc = merged.get(key)
        if (acc) {
          acc.calls += r.calls
          acc.inputTokens = (acc.inputTokens ?? 0) + (r.inputTokens ?? 0)
          acc.outputTokens = (acc.outputTokens ?? 0) + (r.outputTokens ?? 0)
          acc.reasoningTokens = (acc.reasoningTokens ?? 0) + (r.reasoningTokens ?? 0)
          acc.cacheTokens = (acc.cacheTokens ?? 0) + (r.cacheTokens ?? 0)
        } else {
          merged.set(key, { ...r, statDate: r.statDate.slice(0, 7) })
        }
      }
      list = [...merged.values()].sort((a, b) => b.statDate.localeCompare(a.statDate))
    }
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
  // 北极星(好评率 + 带反馈完成率代理;窗口无样本比率 null 不虚报)
  http.get('/ia/api/v1/admin/usage/north-star', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const appId = url.searchParams.get('appId')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let rows: IaFeedback[] = [...store.feedbacks]
    if (appId) rows = rows.filter(f => f.appId === Number(appId))
    if (from) rows = rows.filter(f => String(f.createTime) >= from)
    if (to) rows = rows.filter(f => String(f.createTime) <= to)
    const up = rows.filter(f => f.rating === 'UP').length
    const down = rows.filter(f => f.rating === 'DOWN').length
    // 带反馈完成率代理(mock 近似:按 run 锚点去重,无 run 行计入完成侧演示值;
    // 联调以服务端 UsageQueryService.northStar 口径为准)
    const runKeys = new Set(rows.filter(f => f.runId).map(f => f.runId!))
    const completedRuns = runKeys.size
    const failedRuns = 0
    const cancelledRuns = 0
    return ok({
      from: from ?? null,
      to: to ?? null,
      thumbsUp: up,
      thumbsDown: down,
      positiveRate: up + down === 0 ? null : up / (up + down),
      feedbackLinkedCompletedRuns: completedRuns,
      feedbackLinkedFailedRuns: failedRuns,
      feedbackLinkedCancelledRuns: cancelledRuns,
      feedbackLinkedCompletionRate: completedRuns + failedRuns === 0 ? null : completedRuns / (completedRuns + failedRuns),
    })
  }),
]

// ==================== 用户反馈(镜像 AdminFeedbackController,W15) ====================

const feedbackHandlers = [
  http.get('/ia/api/v1/admin/feedbacks', ({ request }) => {
    const denied = requireAdminCredential(request)
    if (denied) return denied
    const url = new URL(request.url)
    const rating = url.searchParams.get('rating')
    if (rating && rating !== 'UP' && rating !== 'DOWN') {
      return fail(400, `rating 仅支持 UP / DOWN: ${rating}`)
    }
    const appId = url.searchParams.get('appId')
    const userId = url.searchParams.get('userId')
    const conversationId = url.searchParams.get('conversationId')
    const runId = url.searchParams.get('runId')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let list = [...store.feedbacks].sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
    if (appId) list = list.filter(f => f.appId === Number(appId))
    if (userId) list = list.filter(f => f.userId === Number(userId))
    if (conversationId) list = list.filter(f => f.conversationId === conversationId)
    if (runId) list = list.filter(f => f.runId === runId)
    if (rating) list = list.filter(f => f.rating === rating)
    if (from) list = list.filter(f => String(f.createTime) >= from)
    if (to) list = list.filter(f => String(f.createTime) <= to)
    return ok(paginate(list, Number(url.searchParams.get('pageNo') ?? 1), Number(url.searchParams.get('pageSize') ?? 10)))
  }),
]

export const handlers = [
  ...authHandlers,
  ...appHandlers,
  ...toolHandlers,
  ...grantHandlers,
  ...definitionHandlers,
  ...auditHandlers,
  ...modelHandlers,
  ...circuitHandlers,
  ...webhookHandlers,
  ...mcpServerHandlers,
  ...skillHandlers,
  ...kbHandlers,
  ...usageHandlers,
  ...feedbackHandlers,
]

// 模块加载即恢复种子,保证 dev/测试首屏即有数据
resetMockData()
