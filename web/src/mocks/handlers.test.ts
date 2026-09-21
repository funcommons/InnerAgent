/**
 * [new] mock 后端(handler)契约测试:分页/过滤/动作语义/认证守卫。
 * P2 对齐:apps/tools/grants 断言与真实控制器行为一致(HTTP 状态=业务码、
 * 信封 msg 字段、错误语义 409/400/404);每域含「请求形=真实契约」断言。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { setAdminKeyGetter } from '@/api/request'
import {
  appAdminApi,
  auditAdminApi,
  circuitAdminApi,
  definitionAdminApi,
  feedbackAdminApi,
  kbAdminApi,
  mcpServerAdminApi,
  modelConfigAdminApi,
  skillAdminApi,
  toolAdminApi,
  toolGrantAdminApi,
  usageAdminApi,
  webhookAdminApi,
} from '@/api/admin'
import { ApiError } from '@/api/errorCodes'
import type { CommonResult } from '@/api/common'
import type { IaSkill, SkillPreviewView } from '@/api/types'

describe('mock 后端:认证守卫', () => {
  it('缺少 X-IA-Admin-Key → 403(对齐 AdminTokenFilter 缺省封闭,msg 透出)', async () => {
    setAdminKeyGetter(() => '')
    const err = await appAdminApi.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(403)
    expect(apiErr.code).toBe(403)
    expect(apiErr.message).toContain('X-IA-Admin-Key')
    expect(apiErr.isAuthError()).toBe(true)
  })
})

describe('mock 后端:应用管理(真实契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('list 返回全量数组(3 个种子;真实契约:无分页/过滤)', async () => {
    const all = await appAdminApi.list()
    expect(Array.isArray(all)).toBe(true)
    expect(all).toHaveLength(3)
    expect(all.map(a => a.appKey)).toContain('demo-app')
    // 行形 = P2-key AppView:回指纹/轮换时间/密钥掩码;明文 webhookSecret 永不回显
    expect(all[0]).toHaveProperty('conversationRetentionDays')
    expect(all[0]).toHaveProperty('signKeyFingerprint')
    expect(all[0]).toHaveProperty('signKeyRotatedAt')
    expect(all[0]!.webhookSecretMasked).toContain('••••')
    const raw = all[0] as unknown as Record<string, unknown>
    expect(raw['webhookSecret']).toBeUndefined()
    expect(raw['deleted']).toBeUndefined()
  })

  it('创建应用:请求形=真实契约(必含 signPublicKey);appKey 重复 → 409', async () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nNEW\n-----END PUBLIC KEY-----'
    const created = await appAdminApi.create({ appKey: 'new-app', name: '新应用', signPublicKey: pem })
    expect(created.status).toBe(1)
    expect(created.conversationRetentionDays).toBe(180)
    expect(created.signPublicKey).toBe(pem)
    // 首次登记不算轮换(P2-key:rotatedAt 为 null,指纹已生成)
    expect(created.signKeyRotatedAt).toBeNull()
    expect(created.signKeyFingerprint).toMatch(/^[0-9a-f]{16}$/)

    const err = await appAdminApi.create({ appKey: 'new-app', name: '重复', signPublicKey: pem }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toContain('appKey 已存在')
  })

  it('非法 PEM → 400(对齐 AdminAppService.parseRsaPublicKey)', async () => {
    const err = await appAdminApi.create({ appKey: 'bad-pem', name: 'x', signPublicKey: 'not-a-pem' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(400)
    expect((err as ApiError).message).toContain('RSA 公钥 PEM')
  })

  it('公钥登记/轮换:PUT signPublicKey 同一端点;V9 轮换语义(同值不算轮换);status 仅 0/1 生效', async () => {
    const target = (await appAdminApi.list()).find(a => !a.signPublicKey)!
    const registered = await appAdminApi.updateSignKey(target.id, '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----')
    expect(registered.signPublicKey).toContain('BEGIN PUBLIC KEY')
    const rotated = await appAdminApi.updateSignKey(target.id, '-----BEGIN PUBLIC KEY-----\nBBB\n-----END PUBLIC KEY-----')
    expect(rotated.signPublicKey).toContain('BBB')
    // PUT 值变化即轮换(镜像 rotateSignKey:current=null 亦视为变化,rotatedAt=now)
    expect(rotated.signKeyRotatedAt).toBeTruthy()
    const fingerprintBefore = rotated.signKeyFingerprint
    // 同值重复 PUT 不算轮换(P2-key rotateSignKey 语义)
    const again = await appAdminApi.updateSignKey(target.id, '-----BEGIN PUBLIC KEY-----\nBBB\n-----END PUBLIC KEY-----')
    expect(again.signKeyRotatedAt).toBe(rotated.signKeyRotatedAt)
    expect(again.signKeyFingerprint).toBe(fingerprintBefore)
    // 非法状态值不生效(服务端仅 0/1 写入)
    const untouched = await appAdminApi.update(target.id, { status: 5 as never })
    expect(untouched.status).toBe(1)
  })

  it('注销应用:DELETE 后列表不再包含', async () => {
    await appAdminApi.remove(3)
    const rest = await appAdminApi.list()
    expect(rest.find(a => a.id === 3)).toBeUndefined()
    await expect(appAdminApi.get(3)).rejects.toMatchObject({ status: 404 })
  })
})

describe('mock 后端:工具注册(真实契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('list 返回全量数组(9 把);serverKey/enabled 过滤(真实 query 形)', async () => {
    const all = await toolAdminApi.list()
    expect(all).toHaveLength(9)
    const crm = await toolAdminApi.list({ serverKey: 'crm' })
    expect(crm.every(t => t.serverKey === 'crm')).toBe(true)
    const disabled = await toolAdminApi.list({ enabled: false })
    expect(disabled.map(t => t.fqn)).toEqual(['mcp__demo_host__export_users'])
    // 行形 = ia_tool_registry 真实列(V17 起含体检三列;旧自拟 schemaFingerprint 不存在)
    expect(all[0]).toHaveProperty('schemaSha256')
    expect(all[0]).toHaveProperty('revalidateRequired')
    expect(all[0]).not.toHaveProperty('schemaFingerprint')
    expect(all[0]).toHaveProperty('healthStatus')
  })

  it('register:请求形=真实契约(单条注册);FQN 重复 → 409;serverKey 非法 → 400', async () => {
    const entry = await toolAdminApi.register({
      serverKey: 'new-host', toolName: 'get_status', source: 'host_app',
      description: '查询状态', parametersSchema: '{"type":"object","properties":{"id":{"type":"string"}}}',
      annotationsJson: '{"readOnlyHint":true,"idempotentHint":true}',
    })
    expect(entry.fqn).toBe('mcp__new-host__get_status')
    expect(entry.riskLevel).toBe('low') // 注解默认 + readOnly
    expect(entry.resumeSafe).toBe(true) // 默认取 idempotentHint
    expect(entry.enabled).toBe(true)

    await expect(toolAdminApi.register({
      serverKey: 'new-host', toolName: 'get_status', source: 'host_app',
    })).rejects.toMatchObject({ status: 409 })

    await expect(toolAdminApi.register({
      serverKey: 'bad_key', toolName: 'x', source: 'host_app',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('凭据/删除类关键词强制高危(register 不传 riskLevel)', async () => {
    const entry = await toolAdminApi.register({
      serverKey: 'vault', toolName: 'rotate_password', source: 'third_party',
      endpointUrl: 'https://vault.example.com/mcp',
    })
    expect(entry.riskLevel).toBe('high')
  })

  it('refreshSchema 分诊:unchanged/compatible 自动生效/breaking 暂存+级联失效', async () => {
    // 无新 schema → unchanged(静默刷新,指纹不动)
    const unchanged = await toolAdminApi.refreshSchema(2)
    expect(unchanged.verdict).toBe('unchanged')
    expect(unchanged.revalidateRequired).toBe(false)
    // 纯增量(不含 required)→ compatible 自动生效
    const compatible = await toolAdminApi.refreshSchema(2, {
      parametersSchema: '{"type":"object","properties":{"id":{"type":"string"},"email":{"type":"string"}}}',
    })
    expect(compatible.verdict).toBe('compatible')
    expect(compatible.revalidateRequired).toBe(false)
    const after = await toolAdminApi.get(2)
    expect(after.schemaSha256).toBe(compatible.effectiveSchemaSha256)
    // 新增必填参数 → breaking:暂存 pending + revalidateRequired + 级联失效(schema_breaking)
    const breaking = await toolAdminApi.refreshSchema(2, {
      parametersSchema: '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}',
    })
    expect(breaking.verdict).toBe('breaking')
    expect(breaking.revalidateRequired).toBe(true)
    expect(breaking.pendingSchemaSha256).toBeTruthy()
    const grants = await toolGrantAdminApi.list({ toolName: 'update_user', activeOnly: false })
    expect(grants.every(g => g.invalidated && g.invalidatedReason === 'schema_breaking')).toBe(true)
  })

  it('schema/confirm 应用暂存;schema/reject 保持旧 schema;无待确认 → 400', async () => {
    await toolAdminApi.refreshSchema(4, {
      parametersSchema: '{"type":"object","required":["days"],"properties":{"days":{"type":"number"}}}',
    })
    const rejected = await toolAdminApi.rejectSchema(4)
    expect(rejected.revalidateRequired).toBe(false)
    expect(rejected.schemaSha256).toBe('sha256:0004fp') // 旧 schema 继续生效

    await toolAdminApi.refreshSchema(4, {
      parametersSchema: '{"type":"object","required":["days"],"properties":{"days":{"type":"number"}}}',
    })
    const confirmed = await toolAdminApi.confirmSchema(4)
    expect(confirmed.revalidateRequired).toBe(false)
    expect(confirmed.schemaSha256).not.toBe('sha256:0004fp')
    await expect(toolAdminApi.confirmSchema(4)).rejects.toMatchObject({ status: 400 })
  })

  it('schema-history:分诊留痕(unchanged/compatible/breaking 全记录)', async () => {
    await toolAdminApi.refreshSchema(8)
    await toolAdminApi.refreshSchema(8, { parametersSchema: '{"type":"object","properties":{"scope":{"type":"string"}}}' })
    const history = await toolAdminApi.schemaHistory(8)
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history.map(h => h.outcome)).toContain('silent_refresh')
    expect(history.map(h => h.outcome)).toContain('applied')
    expect(history.every(h => h.toolId === 8)).toBe(true)
  })

  it('update:风险上调级联失效授权(risk_upgrade);强制高危下调 → 400', async () => {
    await toolGrantAdminApi.grant({ userId: 55501, toolName: 'get_user', scope: 'permanent', decisionNote: '测试' })
    await toolAdminApi.update(1, { riskLevel: 'high' })
    const grants = await toolGrantAdminApi.list({ toolName: 'get_user', activeOnly: false })
    expect(grants.every(g => g.invalidated && g.invalidatedReason === 'risk_upgrade')).toBe(true)

    await expect(toolAdminApi.update(3, { riskLevel: 'low' })) // reset_password 凭据类
      .rejects.toMatchObject({ status: 400 })
  })

  it('disable:停用并级联失效授权(tool_disabled);enable 恢复;remove 级联 tool_deleted', async () => {
    await toolAdminApi.disable(2) // update_user:2 条有效授权
    const t = await toolAdminApi.get(2)
    expect(t.enabled).toBe(false)
    const invalid = await toolGrantAdminApi.list({ toolName: 'update_user', activeOnly: false })
    expect(Array.isArray(invalid)).toBe(true) // 真实形:数组,无分页
    expect(invalid.every(g => g.invalidated && g.invalidatedReason === 'tool_disabled')).toBe(true)
    await toolAdminApi.enable(2)
    expect((await toolAdminApi.get(2)).enabled).toBe(true)

    await toolAdminApi.remove(8)
    await expect(toolAdminApi.get(8)).rejects.toMatchObject({ status: 404 })
  })
})

describe('mock 后端:工具授权(真实契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('list 默认仅有效授权(activeOnly 默认 true);传 false 全量;行形=真实列', async () => {
    const valid = await toolGrantAdminApi.list()
    expect(valid).toHaveLength(2)
    const all = await toolGrantAdminApi.list({ activeOnly: false })
    expect(all).toHaveLength(5)
    expect(all[0]).toHaveProperty('riskAtGrant')
    expect(all[0]).toHaveProperty('invalidatedReason')
    expect(all[0]).not.toHaveProperty('grantedRiskLevel')
    expect(all[0]).not.toHaveProperty('invalidReason')
    expect(typeof all[0]!.userId).toBe('number')
  })

  it('grant:请求形=真实契约(toolName 非化名);conversation 必携会话;重复 → 409', async () => {
    const granted = await toolGrantAdminApi.grant({
      userId: 99999, toolName: 'update_user', scope: 'conversation',
      conversationId: 'conv-888', decisionNote: '管理站代授',
    })
    expect(granted.conversationId).toBe('conv-888')
    expect(granted.riskAtGrant).toBe('high')
    expect(granted.schemaSha256).toBeTruthy()
    expect(granted.source).toBe('admin')

    // 排序 id 倒序(镜像 orderByDesc)
    const list = await toolGrantAdminApi.list()
    expect(list[0]!.id).toBe(granted.id)

    // permanent 携带会话 → 400;conversation 缺会话 → 400
    await expect(toolGrantAdminApi.grant({ userId: 1, toolName: 'update_user', scope: 'permanent', conversationId: 'conv-x' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(toolGrantAdminApi.grant({ userId: 1, toolName: 'update_user', scope: 'conversation' }))
      .rejects.toMatchObject({ status: 400 })
    // 工具未注册 → 404;已停用 → 400
    await expect(toolGrantAdminApi.grant({ userId: 1, toolName: 'no_such_tool', scope: 'permanent' }))
      .rejects.toMatchObject({ status: 404 })
    await expect(toolGrantAdminApi.grant({ userId: 1, toolName: 'export_users', scope: 'permanent' }))
      .rejects.toMatchObject({ status: 400 })
    // 同用户同工具 permanent 重复 → 409
    await expect(toolGrantAdminApi.grant({ userId: 12993, toolName: 'update_user', scope: 'permanent' }))
      .rejects.toMatchObject({ status: 409 })
  })

  it('revoke 后列表不再包含(逻辑删除);userId/toolName 过滤生效', async () => {
    await toolGrantAdminApi.revoke(21, { decisionNote: '误授撤销' })
    const all = await toolGrantAdminApi.list({ activeOnly: false })
    expect(all.find(g => g.id === 21)).toBeUndefined()

    const ofUser = await toolGrantAdminApi.list({ userId: 12993 })
    expect(ofUser.every(g => g.userId === 12993)).toBe(true)
    const ofTool = await toolGrantAdminApi.list({ toolName: 'update_user' })
    expect(ofTool.every(g => g.toolFqn === 'mcp__demo_host__update_user')).toBe(true)
  })
})

describe('mock 后端:审计查询(mock 域,行形=ia_audit_log 真实列)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('按时间倒序;decisionSource 过滤;行形无自拟字段', async () => {
    const page = await auditAdminApi.page({ pageSize: 20 })
    expect(page.total).toBe(12)
    const dates = page.list.map(l => l.createTime ?? '')
    expect([...dates].sort().reverse()).toEqual(dates)
    const live = await auditAdminApi.page({ decisionSource: 'live-confirm', pageSize: 20 })
    expect(live.total).toBe(2)
    expect(live.list.every(l => l.decisionSource === 'live-confirm')).toBe(true)
    const first = page.list[0] as unknown as Record<string, unknown>
    expect(first['resultStatus']).toBeUndefined()
    expect(first['confirmedBy']).toBeUndefined()
    expect(first['latencyMs']).toBeUndefined()
  })

  it('decision + 时间范围 + userId 组合过滤(字段名对齐真实列)', async () => {
    const denied = await auditAdminApi.page({ decision: 'denied', pageSize: 20 })
    expect(denied.total).toBe(4)
    const page = await auditAdminApi.page({
      userId: 12993,
      from: '2026-09-19T00:00:00Z',
      to: '2026-09-20T23:59:59Z',
      pageSize: 20,
    })
    expect(page.total).toBe(5)
    expect(page.list.every(l => l.userId === 12993)).toBe(true)
  })
})

describe('mock 后端:模型配置(依赖并行任务,联调时核对)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('种子 4 条;密钥只回显掩码', async () => {
    const page = await modelConfigAdminApi.page({ pageSize: 10 })
    expect(page.total).toBe(4)
    expect(page.list[0]!.apiKeyMasked).toContain('••••')
    // 类型上不存在 apiKey 明文字段(编译期保证);运行时确认响应无明文
    const raw = page.list[0] as unknown as Record<string, unknown>
    expect(raw['apiKey']).toBeUndefined()
  })

  it('create/update 掩码新密钥;delete 生效;test 返回连通', async () => {
    const created = await modelConfigAdminApi.create({ name: '测试配置', platform: 'openai_compatible', apiKey: 'sk-1234567890abcdef' })
    expect(created.apiKeyMasked).toBe('sk-1••••cdef')
    const updated = await modelConfigAdminApi.update(created.id, { id: created.id, name: '改名', platform: 'openai_compatible', apiKey: 'sk-ffffffffffffffff' })
    expect(updated.apiKeyMasked).toBe('sk-f••••ffff')
    const test = await modelConfigAdminApi.test(created.id)
    expect(test.ok).toBe(true)
    await modelConfigAdminApi.delete(created.id)
    const page = await modelConfigAdminApi.page({ pageSize: 10 })
    expect(page.list.find(m => m.id === created.id)).toBeUndefined()
  })
})

describe('mock 后端:熔断与 webhook(AdminCircuitBreakerController/WebhookConfig 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('上限默认值符合《02-技术方案》§4.7', async () => {
    const state = await circuitAdminApi.getState()
    expect(state.limits).toEqual({
      maxToolCallsPerRun: 32,
      maxTokensPerRun: 300000,
      maxRunDurationMinutes: 30,
      toolRetryLimit: 2,
      mcpConcurrency: 8,
      mcpQps: 20,
      confirmTimeoutHours: 24,
    })
  })

  it('紧急停用 → 状态翻转 + 事件入流;resume 恢复', async () => {
    await circuitAdminApi.emergencyStop({ reason: '失控循环演练' })
    const stopped = await circuitAdminApi.getState()
    expect(stopped.emergencyStopped).toBe(true)
    expect(stopped.recentEvents[0]!.type).toBe('emergency-stop')
    await circuitAdminApi.resume()
    const resumed = await circuitAdminApi.getState()
    expect(resumed.emergencyStopped).toBe(false)
  })

  it('updateLimits 部分更新生效', async () => {
    const limits = await circuitAdminApi.updateLimits({ limits: { maxToolCallsPerRun: 64 } })
    expect(limits.maxToolCallsPerRun).toBe(64)
    expect(limits.mcpQps).toBe(20)
  })

  it('webhook 配置保存密钥掩码;deliveries(#18b 真路径)按 status 过滤(契约偏差 #7)', async () => {
    const saved = await webhookAdminApi.saveConfig({ url: 'https://new.example.com/cb', secret: 'whsec-new-secret-9999' })
    expect(saved.secretMasked).toBe('whse••••9999')
    const failed = await webhookAdminApi.deliveries({ status: 'FAILED', pageSize: 10 })
    expect(failed.total).toBe(1)
    expect(failed.list[0]!.attempt).toBe(3)
    expect(failed.list[0]!.nextRetryAt).toBeTruthy()
    expect(failed.list[0]!.nextRetryAt!).toContain('T')
  })
})

describe('mock 后端:契约稳健性', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('不存在的资源 → 404(HTTP 状态=业务码,msg 透出)', async () => {
    await expect(appAdminApi.get(99999)).rejects.toBeInstanceOf(ApiError)
    const err = await appAdminApi.get(99999).catch((e: unknown) => e) as ApiError
    expect(err.status).toBe(404)
    expect(err.code).toBe(404)
    expect(err.message).toContain('应用不存在')
  })
})

describe('mock 后端:tools/grants 分页兼容形(P2-W5)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('tools:无分页参数 → 数组;带 pageNo/pageSize → PageResult(排序 serverKey,toolName)', async () => {
    // 兼容形:数组全量(旧形不破)
    const all = await toolAdminApi.list()
    expect(Array.isArray(all)).toBe(true)
    expect(all).toHaveLength(9)
    // 分页形:任一参数出现即 PageResult
    const page = await toolAdminApi.page({ pageNo: 1, pageSize: 4 })
    expect(page.total).toBe(9)
    expect(page.list).toHaveLength(4)
    expect(page.pageNo).toBe(1)
    expect(page.pageSize).toBe(4)
    // 排序镜像 orderByAsc(serverKey, toolName):crm < demo_host
    expect(page.list.map(t => t.serverKey)).toEqual(['crm', 'crm', 'demo_host', 'demo_host'])
    // 过滤与分页同发:enabled=false 仅 1 行
    const disabled = await toolAdminApi.page({ enabled: false, pageNo: 1, pageSize: 10 })
    expect(disabled.total).toBe(1)
    expect(disabled.list[0]!.fqn).toBe('mcp__demo_host__export_users')
  })

  it('grants:无分页参数 → 数组;带分页参数 → PageResult(activeOnly 默认 true)', async () => {
    const all = await toolGrantAdminApi.list()
    expect(Array.isArray(all)).toBe(true)
    expect(all).toHaveLength(2) // 默认仅有效授权
    const page = await toolGrantAdminApi.page({ activeOnly: false, pageNo: 1, pageSize: 2 })
    expect(page.total).toBe(5)
    expect(page.list).toHaveLength(2)
    expect(page.list[0]!.id).toBeGreaterThan(page.list[1]!.id) // id 倒序
    const valid = await toolGrantAdminApi.page({ pageNo: 1, pageSize: 10 })
    expect(valid.total).toBe(2)
  })
})

describe('mock 后端:工具体检(V17 检查矩阵)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('check:宿主清单缺失 → degraded(tool_present 漂移+advice);结论落库可查', async () => {
    const result = await toolAdminApi.checkHealth(7) // crm update_customer_note 不在宿主清单
    expect(result.status).toBe('degraded')
    expect(result.fqn).toBe('mcp__crm__update_customer_note')
    const present = result.checks.find(c => c.check === 'tool_present')!
    expect(present.status).toBe('drift')
    expect(present.advice).toContain('宿主可能已下线')
    expect(result.detailJson).toContain('"status":"degraded"')
    // 结论与明细落库(GET /admin/tools/{id} 可回读)
    const row = await toolAdminApi.get(7)
    expect(row.healthStatus).toBe('degraded')
    expect(row.lastCheckedAt).toBeTruthy()
    expect(JSON.parse(row.healthDetailJson!).checks).toHaveLength(2)
  })

  it('check:指纹漂移/注解漂移 → degraded(分项矩阵);全过 → ok', async () => {
    // refresh_cache:宿主清单携带不同 schemaSha256 → 指纹漂移
    const drift = await toolAdminApi.checkHealth(8)
    expect(drift.status).toBe('degraded')
    expect(drift.checks.find(c => c.check === 'schema_fingerprint')!.status).toBe('drift')
    expect(drift.checks.find(c => c.check === 'annotations_diff')!.status).toBe('pass')
    // delete_flow:宿主注解不再上报 destructiveHint → 注解漂移
    const annotations = await toolAdminApi.checkHealth(5)
    expect(annotations.status).toBe('degraded')
    expect(annotations.checks.find(c => c.check === 'annotations_diff')!.status).toBe('drift')
    expect(annotations.checks.find(c => c.check === 'annotations_diff')!.advice).toContain('复核风险级')
    // get_user:四项全过 → ok
    const okCase = await toolAdminApi.checkHealth(1)
    expect(okCase.status).toBe('ok')
    expect(okCase.checks).toHaveLength(4)
    expect(okCase.checks.every(c => c.status === 'pass')).toBe(true)
  })

  it('check:third_party endpoint 含 down → unreachable(后续检查跳过)', async () => {
    const t = await toolAdminApi.register({
      serverKey: 'downstream', toolName: 'ping', source: 'third_party',
      endpointUrl: 'http://down.example.com/mcp',
    })
    const result = await toolAdminApi.checkHealth(t.id)
    expect(result.status).toBe('unreachable')
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]!.check).toBe('endpoint_reachable')
    expect(result.checks[0]!.status).toBe('drift')
    expect((await toolAdminApi.get(t.id)).healthStatus).toBe('unreachable')
  })

  it('check-batch:全量受理回执 + 逐行落库;ids 指定含未知 → skipped', async () => {
    const receipt = await toolAdminApi.checkHealthBatch()
    expect(receipt.accepted).toBe(true)
    expect(receipt.total).toBe(9)
    expect(receipt.skipped).toEqual([])
    // mock 同步执行完:全部行已落体检位
    const page = await toolAdminApi.page({ pageNo: 1, pageSize: 100 })
    expect(page.list.every(t => t.healthStatus !== null && t.lastCheckedAt !== null)).toBe(true)

    const partial = await toolAdminApi.checkHealthBatch([1, 999])
    expect(partial.total).toBe(1)
    expect(partial.skipped).toEqual([999])
    await expect(toolAdminApi.checkHealth(99999)).rejects.toMatchObject({ status: 404 })
  })

  it('字典端点扩档:decision_source 含 admin;decision 含 definition-updated/definition-imported', async () => {
    const dict = await auditAdminApi.dictionary()
    expect(dict.decisionSources.map(s => s.code)).toContain('admin')
    const decisions = dict.decisions.map(d => d.code)
    expect(decisions).toContain('definition-updated')
    expect(decisions).toContain('definition-imported')
  })
})

describe('mock 后端:Agent 定义管理域(P2-W5)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('列表:缺省即分页形(agentKey 升序);详情 404 兜底', async () => {
    const page = await definitionAdminApi.page({ pageNo: 1, pageSize: 2 })
    expect(page.total).toBe(4)
    expect(page.list).toHaveLength(2)
    expect(page.list.map(d => d.agentType)).toEqual(['ai_media', 'demo']) // 升序
    const row = page.list[0]!
    expect(row.prompts.systemPrompt).toBeTruthy()
    expect(row.spec).toHaveProperty('kind')
    await expect(definitionAdminApi.get(99999)).rejects.toMatchObject({ status: 404 })
  })

  it('updatePrompt:三槽编辑生效;systemPrompt 空白/未知槽位 → 400;审计留痕 definition-updated/admin', async () => {
    const updated = await definitionAdminApi.updatePrompt(82, { slot: 'greeting', content: '新问候语' })
    expect(updated.prompts.greeting).toBe('新问候语')
    // 清空槽位:传空字符串合法(instructionTemplate 原本有值)
    const cleared = await definitionAdminApi.updatePrompt(82, { slot: 'instructionTemplate', content: '' })
    expect(cleared.prompts.instructionTemplate).toBe('')
    // systemPrompt 空白 → 400;未知槽位 → 400;content 缺失 → 400
    await expect(definitionAdminApi.updatePrompt(82, { slot: 'systemPrompt', content: '   ' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(definitionAdminApi.updatePrompt(82, { slot: 'defaultUserMessage' as never, content: 'x' }))
      .rejects.toMatchObject({ status: 400 })
    // 审计留痕:旧值快照进 params_masked_json(decision=definition-updated,source=admin)
    const audit = await auditAdminApi.page({ decision: 'definition-updated', decisionSource: 'admin', pageSize: 10 })
    expect(audit.total).toBeGreaterThanOrEqual(2)
    const snapshot = JSON.parse(audit.list[0]!.paramsMaskedJson!)
    expect(snapshot).toHaveProperty('slot')
    expect(snapshot).toHaveProperty('oldContent')
    expect(audit.list[0]!.toolFqn).toBe('agent-definition:demo')
  })

  it('export:全量 bundle(schemaVersion=1 + 三槽);ids 过滤;未知 id 静默忽略', async () => {
    const full = await definitionAdminApi.export()
    expect(full.schemaVersion).toBe(1)
    expect(full.exportedAt).toBeTruthy()
    expect(full.definitions).toHaveLength(4)
    const entry = full.definitions.find(d => d.agentType === 'demo')!
    expect(entry.definitionId).toBe(82)
    expect(entry.prompts.map(p => p.slot)).toEqual(['systemPrompt', 'instructionTemplate', 'greeting'])
    expect(entry.specJson).toHaveProperty('toolWhitelist')

    const partial = await definitionAdminApi.export({ ids: [82, 999] })
    expect(partial.definitions).toHaveLength(1)
    expect(partial.definitions[0]!.agentType).toBe('demo')
  })

  it('import:dryRun 预演零副作用;skip 冲突计数;errors[] 收条目级校验', async () => {
    const bundle = {
      schemaVersion: 1,
      exportedAt: '2026-09-21T00:00:00Z',
      definitions: [
        { agentType: 'demo', name: '演示助手(改)', prompts: [{ slot: 'greeting', content: '覆盖问候' }] },
        { agentType: 'brand_new_agent', name: '全新定义', prompts: [{ slot: 'systemPrompt', content: '你是全新定义' }] },
        { agentType: 'bad_entry', name: '', prompts: [] }, // name 缺失 → 条目级错误
        { agentType: 'no_prompt_agent', name: '缺系统提示词', prompts: [] }, // 新定义无 systemPrompt → 错误
      ],
    }
    const preview = await definitionAdminApi.import({ bundle, conflictPolicy: 'skip', dryRun: true })
    expect(preview.dryRun).toBe(true)
    expect(preview.created).toBe(1) // brand_new_agent
    expect(preview.updated).toBe(0)
    expect(preview.skipped).toBe(1) // demo 冲突按 skip
    expect(preview.errors).toHaveLength(2)
    expect(preview.errors.map(e => e.agentType)).toEqual(['bad_entry', 'no_prompt_agent'])
    // 预演零副作用:库行数与内容不变
    const after = await definitionAdminApi.page({ pageSize: 50 })
    expect(after.total).toBe(4)
    expect(after.list.find(d => d.agentType === 'demo')!.name).toBe('InnerAgent 演示助手')
  })

  it('import:正式导入 overwrite 覆盖+审计;bundle 级校验失败 400', async () => {
    const bundle = {
      schemaVersion: 1,
      exportedAt: '2026-09-21T00:00:00Z',
      definitions: [
        { agentType: 'demo', name: '演示助手(覆盖)', prompts: [{ slot: 'greeting', content: '覆盖问候' }] },
        { agentType: 'brand_new_agent', name: '全新定义', prompts: [{ slot: 'systemPrompt', content: '你是全新定义' }] },
      ],
    }
    const result = await definitionAdminApi.import({ bundle, conflictPolicy: 'overwrite', dryRun: false })
    expect(result.dryRun).toBe(false)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    // overwrite:bundle 出现的槽位覆盖,未出现的槽位(systemPrompt)保持现值
    const demo = (await definitionAdminApi.page({ pageSize: 50 })).list.find(d => d.agentType === 'demo')!
    expect(demo.name).toBe('演示助手(覆盖)')
    expect(demo.prompts.greeting).toBe('覆盖问候')
    expect(demo.prompts.systemPrompt).toContain('演示助手')
    // created:新定义已落库
    const created = (await definitionAdminApi.page({ pageSize: 50 })).list.find(d => d.agentType === 'brand_new_agent')!
    expect(created.kind).toBe('main')
    expect(created.prompts.systemPrompt).toBe('你是全新定义')
    // 审计:definition-imported(admin)1 条
    const importedAudit = await auditAdminApi.page({ decision: 'definition-imported', decisionSource: 'admin', pageSize: 10 })
    expect(importedAudit.total).toBe(1)
    expect(importedAudit.list[0]!.toolFqn).toBe('agent-definition:brand_new_agent')

    // bundle 级校验:schemaVersion 不符/definitions 非数组/conflictPolicy 非法 → 400
    await expect(definitionAdminApi.import({ bundle: { schemaVersion: 2, definitions: [] }, conflictPolicy: 'skip' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(definitionAdminApi.import({ bundle: { schemaVersion: 1, definitions: {} }, conflictPolicy: 'skip' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(definitionAdminApi.import({ bundle, conflictPolicy: 'merge' as never }))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ==================== P4 批次(2026-09-21 web 接线):五域契约镜像 ====================

/** 构造 mock Skill 包文本(演示层:JSON 文本承载包结构,真实端点为 multipart zip) */
function skillZipText(manifest: Record<string, unknown>, files: Array<{ path: string; content?: string }> = []): string {
  return JSON.stringify({
    manifest,
    files: files.map(f => ({ path: f.path, encoding: 'utf-8', content: f.content ?? '' })),
  })
}

/**
 * 手工构造 multipart 请求(测试环境 jsdom File 字节经 undici 序列化会丢失,
 * api 层 FormData 组装另有捕获式断言;此处直接以合法 multipart 字节走线上形)。
 * 返回原始信封 {status, body}。
 */
async function postMultipart(
  path: string,
  fileName: string,
  content: string,
  query = '',
): Promise<{ status: number; body: CommonResult<unknown> }> {
  const boundary = `----iatest-${Math.random().toString(16).slice(2)}`
  const raw = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    'Content-Type: application/zip',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const resp = await fetch(`/ia/api/v1/admin/skills${path}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-IA-Admin-Key': 'k' },
    body: raw,
  })
  return { status: resp.status, body: await resp.json() as CommonResult<unknown> }
}

describe('mock 后端:三方 MCP 服务器(P4-W13 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('list:数组形含停用;credentialsMasked 打码形(前 2 字符+***)不回显明文', async () => {
    const list = await mcpServerAdminApi.list()
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.map(s => s.serverKey)).toContain('crm-mcp')
    expect(list.map(s => s.enabled)).toContain(false)
    const masked = list.find(s => s.credentialsMasked)!
    expect(masked.credentialsMasked).toMatch(/^\S{0,2}\*\*\*$/)
    const raw = masked as unknown as Record<string, unknown>
    expect(raw['credentials']).toBeUndefined()
    expect(masked.transport).toBe('streamable-http')
  })

  it('register:serverKey 字符集校验 400(仅字母/数字/连字符);STATIC_HEADER 头名/值必填;OAUTH → 501', async () => {
    const okRow = await mcpServerAdminApi.register({
      serverKey: 'crm-mcp-2', name: 'CRM 备用', endpointUrl: 'https://mcp2.example.com/mcp',
      authType: 'STATIC_HEADER', headerName: 'X-Api-Key', credentials: 'secret-value-9f', timeoutSeconds: 45,
    })
    expect(okRow.enabled).toBe(true)
    expect(okRow.timeoutSeconds).toBe(45)
    expect(okRow.credentialsMasked).toBe('se***')
    // serverKey 字符集(下划线拒绝;镜像 SERVER_KEY Pattern)
    await expect(mcpServerAdminApi.register({
      serverKey: 'bad_key', name: 'x', endpointUrl: 'https://a.example.com/mcp',
      headerName: 'h', credentials: 'v',
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('仅允许字母/数字/连字符') })
    // OAUTH → 501(P4-W13 仅枚举位)
    await expect(mcpServerAdminApi.register({
      serverKey: 'oauth-srv', name: 'x', endpointUrl: 'https://a.example.com/mcp',
      authType: 'OAUTH', headerName: 'h', credentials: 'v',
    })).rejects.toMatchObject({ status: 501, message: expect.stringContaining('暂未实现') })
    // STATIC_HEADER 头值缺失 → 400(整对象字面量缺 credentials 字段,断言走线上 400)
    await expect(mcpServerAdminApi.register({
      serverKey: 'no-cred', name: 'x', endpointUrl: 'https://a.example.com/mcp', headerName: 'h',
    } as never)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('静态头值') })
    // timeoutSeconds 越界 → 400
    await expect(mcpServerAdminApi.register({
      serverKey: 'timeout-bad', name: 'x', endpointUrl: 'https://a.example.com/mcp',
      headerName: 'h', credentials: 'v', timeoutSeconds: 601,
    })).rejects.toMatchObject({ status: 400 })
  })

  it('防遮蔽冲突域:本表唯一 409;与宿主注册表工具 serverKey 冲突 409', async () => {
    await expect(mcpServerAdminApi.register({
      serverKey: 'crm-mcp', name: '重复', endpointUrl: 'https://a.example.com/mcp', headerName: 'h', credentials: 'v',
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('已被应用级三方 MCP 服务占用') })
    // 宿主注册表种子含 serverKey='crm'(mcp__crm__* 工具)
    await expect(mcpServerAdminApi.register({
      serverKey: 'crm', name: '遮蔽宿主', endpointUrl: 'https://a.example.com/mcp', headerName: 'h', credentials: 'v',
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('防遮蔽') })
  })

  it('update:全表单语义(与注册同一 normalize,credentials 缺省 → 400);启停/删除 404', async () => {
    const before = (await mcpServerAdminApi.list()).find(s => s.serverKey === 'crm-mcp')!
    const updated = await mcpServerAdminApi.update(before.id, {
      serverKey: before.serverKey, name: 'CRM 三方服务(改)', endpointUrl: 'https://crm-mcp.example.com/mcp',
      headerName: 'X-Api-Key', credentials: 'brand-new-key', timeoutSeconds: 90,
    })
    expect(updated.name).toContain('改')
    expect(updated.credentialsMasked).toBe('br***')
    expect(updated.enabled).toBe(true)
    // 全表单语义:credentials 空 → 400(镜像服务端 update 走同一 normalize)
    await expect(mcpServerAdminApi.update(before.id, {
      serverKey: before.serverKey, name: updated.name!, endpointUrl: updated.endpointUrl,
      headerName: 'X-Api-Key', credentials: '', timeoutSeconds: 90,
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('静态头值') })
    const disabled = await mcpServerAdminApi.disable(before.id)
    expect(disabled.enabled).toBe(false)
    const enabled = await mcpServerAdminApi.enable(before.id)
    expect(enabled.enabled).toBe(true)
    await expect(mcpServerAdminApi.enable(999999)).rejects.toMatchObject({ status: 404 })
  })
})

describe('mock 后端:Skill 目录(P4-W13 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('api 层:preview/import 走 multipart 形(preview 无 query;import 带 overwrite/displayName)', async () => {
    const seen: Array<{ url: string; method: string; multipart: boolean }> = []
    server.use(
      mswHttp.post('/ia/api/v1/admin/skills/import/preview', ({ request }) => {
        seen.push({
          url: new URL(request.url).pathname,
          method: request.method,
          multipart: (request.headers.get('content-type') ?? '').includes('multipart/form-data'),
        })
        return HttpResponse.json({ code: 0, msg: 'success', data: null })
      }),
      mswHttp.post('/ia/api/v1/admin/skills/import', ({ request }) => {
        const url = new URL(request.url)
        seen.push({
          url: `${url.pathname}?${url.searchParams}`,
          method: request.method,
          multipart: (request.headers.get('content-type') ?? '').includes('multipart/form-data'),
        })
        return HttpResponse.json({ code: 0, msg: 'success', data: null })
      }),
    )
    const file = new File([skillZipText({ name: 'api-shape' })], 'shape.zip')
    await skillAdminApi.preview(file, 'shape.zip')
    await skillAdminApi.importSkill({ file, fileName: 'shape.zip', displayName: '名', overwrite: true })
    expect(seen).toEqual([
      { url: '/ia/api/v1/admin/skills/import/preview', method: 'POST', multipart: true },
      { url: '/ia/api/v1/admin/skills/import?displayName=%E5%90%8D&overwrite=true', method: 'POST', multipart: true },
    ])
  })

  it('preview:dryRun 零落库;返回清单+文件+警告;invalid 仍 200(errors 非空)', async () => {
    const totalBefore = (await skillAdminApi.page({ pageSize: 100 })).total
    const previewResp = await postMultipart('/import/preview', 'preview-skill.zip',
      skillZipText({ name: 'preview-skill', displayName: '预览技能', description: 'd', version: '1.0.0' },
        [{ path: 'SKILL.md', content: '正文' }]))
    expect(previewResp.status).toBe(200)
    const preview = previewResp.body.data as SkillPreviewView
    expect(preview.valid).toBe(true)
    expect(preview.manifest!.name).toBe('preview-skill')
    expect(preview.files.map(f => f.path)).toContain('SKILL.md')
    // 预览零副作用:总数不变
    expect((await skillAdminApi.page({ pageSize: 100 })).total).toBe(totalBefore)
    // 无 SKILL.md → 警告不阻断;name 非法 → invalid(errors 非空,HTTP 仍 200)
    const warned = (await postMultipart('/import/preview', 'x.zip', skillZipText({ name: 'no-doc-skill' }, [{ path: 'a.txt' }]))).body.data as SkillPreviewView
    expect(warned.valid).toBe(true)
    expect(warned.warnings.join()).toContain('SKILL.md')
    const invalid = (await postMultipart('/import/preview', 'y.zip', skillZipText({ name: 'Bad_Name' }))).body.data as SkillPreviewView
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join()).toContain('仅允许小写字母/数字/连字符')
    expect((await skillAdminApi.page({ pageSize: 100 })).total).toBe(totalBefore)
  })

  it('import:确认入库;同名活跃行缺省 409;inactive 同名按复活/覆盖;invalid → 400', async () => {
    const createdResp = await postMultipart('/import', 'imported-skill.zip',
      skillZipText({ name: 'imported-skill', displayName: '导入技能', description: 'd' }, [{ path: 'SKILL.md', content: 'x' }]))
    expect(createdResp.status).toBe(200)
    const created = createdResp.body.data as IaSkill
    expect(created.name).toBe('imported-skill')
    expect(created.status).toBe('inactive') // 导入后未激活
    // 同名再导入(仍是 inactive → 复活/覆盖语义,非 409;镜像:同名活跃行才 409)
    const again = (await postMultipart('/import', 'imported-skill.zip',
      skillZipText({ name: 'imported-skill', displayName: '导入技能2' }, [{ path: 'SKILL.md', content: 'y' }]))).body.data as IaSkill
    expect(again.displayName).toBe('导入技能2')
    // 同名活跃种子行(week-report)缺省导入 → 409;overwrite=true → 覆盖
    const conflict = await postMultipart('/import', 'imported-skill.zip',
      skillZipText({ name: 'week-report' }, [{ path: 'SKILL.md', content: 'z' }]))
    expect(conflict.status).toBe(409)
    expect(conflict.body.msg).toContain('同名 Skill 已存在')
    const overwrite = await postMultipart('/import', 'imported-skill.zip',
      skillZipText({ name: 'imported-skill', displayName: '覆盖版' }, [{ path: 'SKILL.md', content: 'w' }]), '?overwrite=true')
    expect(overwrite.status).toBe(200)
    // 校验不过 → 400(服务端重校验,不信任客户端回显)
    const bad = await postMultipart('/import', 'bad.zip', skillZipText({}))
    expect(bad.status).toBe(400)
    expect(bad.body.msg).toContain('未通过校验')
  })

  it('activate:上限 8(种子已 8 激活,再激活 → 409 友好文案);deactivate/删除', async () => {
    const page = await skillAdminApi.page({ pageSize: 100 })
    expect(page.pageNo).toBe(1)
    expect(page.total).toBeGreaterThanOrEqual(9) // 8 active + 1 inactive
    const inactive = page.list.find(s => s.status === 'inactive')!
    // 种子 8 个 active 已达上限 → 激活第 9 个 409(错误文案与真实 service 一致)
    const err = await skillAdminApi.activate(inactive.id).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toContain('已达上限 8')
    // 停用一个 → 腾出名额 → 激活成功
    await skillAdminApi.deactivate(inactive.id)
    const anyActive = (await skillAdminApi.page({ pageSize: 100 })).list.find(s => s.status === 'active')!
    const deactivated = await skillAdminApi.deactivate(anyActive.id)
    expect(deactivated.active).toBe(false)
    await skillAdminApi.activate(inactive.id)
    expect((await skillAdminApi.get(inactive.id)).skill.status).toBe('active')
    // 详情含文件清单
    const detail = await skillAdminApi.get(inactive.id)
    expect(detail.files.length).toBeGreaterThan(0)
    // 删除(逻辑):列表不再返回
    await skillAdminApi.remove(anyActive.id)
    expect((await skillAdminApi.page({ pageSize: 100 })).list.find(s => s.id === anyActive.id)).toBeUndefined()
  })
})

describe('mock 后端:mini 知识库(P4-W14 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('import:文本导入(标题/来源/分块参数);校验 400 语义齐全', async () => {
    const doc = await kbAdminApi.importDocument({ title: '接入指南', source: 'upload', content: 'a'.repeat(1200), chunkSize: 500, chunkOverlap: 50 })
    expect(doc.status).toBe('active')
    expect(doc.chunkCount).toBe(3) // ceil(1200/500)
    await expect(kbAdminApi.importDocument({ title: '', content: 'x' })).rejects.toMatchObject({ status: 400 })
    await expect(kbAdminApi.importDocument({ title: 't', content: '  ' })).rejects.toMatchObject({ status: 400 })
    await expect(kbAdminApi.importDocument({ title: 't', content: 'c', chunkSize: 100, chunkOverlap: 100 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('chunkOverlap') })
    await expect(kbAdminApi.importDocument({ title: 't', content: 'c', metadata: '{bad' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('metadata') })
    await expect(kbAdminApi.importDocument({ title: 't', content: 'c', metadata: '[1]' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('JSON 对象') })
  })

  it('search:检索调试(top-k/降级标记);空查询 → simple 降级空命中', async () => {
    const result = await kbAdminApi.search({ q: '员工', topK: 2 })
    expect(result.searchConfig).toBe('tsvector')
    expect(result.degraded).toBe(false)
    expect(result.hits.length).toBeLessThanOrEqual(2)
    expect(result.hits[0]).toHaveProperty('documentTitle')
    expect(result.hits[0]).toHaveProperty('anchor')
    const degraded = await kbAdminApi.search({ q: '' })
    expect(degraded.degraded).toBe(true)
    expect(degraded.searchConfig).toBe('simple')
    expect(degraded.hits).toHaveLength(0)
  })

  it('状态门控/inactive 不参与检索;rebuild-index;更新重分块;删除', async () => {
    const doc = await kbAdminApi.importDocument({ title: '门控文档', content: 'x' })
    // deactivate → 检索不再命中
    const deactivated = await kbAdminApi.deactivate(doc.id)
    expect(deactivated.status).toBe('inactive')
    expect(deactivated.active).toBe(false)
    const afterOff = await kbAdminApi.search({ q: '门控文档' })
    expect(afterOff.hits.find(h => h.documentId === doc.id)).toBeUndefined()
    // activate 恢复
    const activated = await kbAdminApi.activate(doc.id)
    expect(activated.active).toBe(true)
    // 重建索引(回写行)
    const rebuilt = await kbAdminApi.rebuildIndex(doc.id)
    expect(rebuilt.id).toBe(doc.id)
    // 更新带 content → 重分块
    const updated = await kbAdminApi.update(doc.id, { title: '门控文档(改)', content: 'b'.repeat(900), chunkSize: 400 })
    expect(updated.title).toContain('改')
    expect(updated.chunkCount).toBe(3) // ceil(900/400)
    await kbAdminApi.remove(doc.id)
    await expect(kbAdminApi.get(doc.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('mock 后端:用量统计(W15 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('summary:分页聚合行(statDate/provider/modelCode/calls/token 列);DAY 缺省', async () => {
    const page = await usageAdminApi.summary({ pageNo: 1, pageSize: 5 })
    expect(page.total).toBe(12)
    expect(page.list).toHaveLength(5)
    const row = page.list[0]!
    expect(row).toHaveProperty('statDate')
    expect(row).toHaveProperty('provider')
    expect(row).toHaveProperty('modelCode')
    expect(row).toHaveProperty('calls')
    // statDate 降序
    expect(page.list[0]!.statDate >= page.list[4]!.statDate).toBe(true)
    // FAILED 行 token 列为空形保留(种子 2026-09-18 deepseek-chat 行)
    const full = await usageAdminApi.summary({ pageSize: 100 })
    expect(full.list.some(r => r.inputTokens === null)).toBe(true)
  })

  it('summary:granularity=MONTH 聚合合并;非法 granularity → 400;userId 过滤', async () => {
    const month = await usageAdminApi.summary({ granularity: 'MONTH', pageSize: 100 })
    for (const row of month.list) expect(row.statDate).toBe('2026-09')
    expect(month.total).toBeLessThan(12)
    await expect(usageAdminApi.summary({ granularity: 'WEEK' as never })).rejects.toMatchObject({ status: 400 })
    const userOnly = await usageAdminApi.summary({ userId: 12993, pageSize: 100 })
    expect(userOnly.list.every(r => r.userId === 12993)).toBe(true)
  })

  it('north-star:好评率=👍÷(👍+👎);带反馈完成率;无样本 → null 不虚报', async () => {
    const ns = await usageAdminApi.northStar()
    // 种子 6 条反馈:4 UP / 2 DOWN
    expect(ns.thumbsUp).toBe(4)
    expect(ns.thumbsDown).toBe(2)
    expect(ns.positiveRate).toBeCloseTo(4 / 6, 5)
    expect(ns.feedbackLinkedCompletedRuns).toBeGreaterThan(0)
    expect(ns.feedbackLinkedCompletionRate).toBeCloseTo(1, 5)
    // 时间窗过滤到空 → 比率 null
    const empty = await usageAdminApi.northStar({ from: '2020-01-01T00:00:00', to: '2020-01-02T00:00:00' })
    expect(empty.thumbsUp).toBe(0)
    expect(empty.positiveRate).toBeNull()
    expect(empty.feedbackLinkedCompletionRate).toBeNull()
  })
})

describe('mock 后端:用户反馈(W15 契约形)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('page:分页行形(维度锚点/rating/comment/双时间);rating 过滤', async () => {
    const page = await feedbackAdminApi.page({ pageNo: 1, pageSize: 4 })
    expect(page.total).toBe(6)
    expect(page.list).toHaveLength(4)
    const row = page.list[0]!
    expect(['UP', 'DOWN']).toContain(row.rating)
    expect(row).toHaveProperty('conversationId')
    expect(row).toHaveProperty('runId')
    expect(row).toHaveProperty('messageId')
    expect(row).toHaveProperty('comment')
    expect(row).toHaveProperty('createTime')
    expect(row).toHaveProperty('updateTime')
    // createTime 降序(最新在前)
    expect(String(row.createTime) >= String(page.list[3]!.createTime)).toBe(true)
    const downs = await feedbackAdminApi.page({ rating: 'DOWN' })
    expect(downs.total).toBe(2)
    expect(downs.list.every(f => f.rating === 'DOWN')).toBe(true)
  })

  it('page:rating 非法值 → 400(镜像 AdminFeedbackController);runId 锚点过滤', async () => {
    await expect(feedbackAdminApi.page({ rating: 'LEFT' as never })).rejects.toMatchObject({ status: 400 })
    const byRun = await feedbackAdminApi.page({ runId: 'run-2001' })
    expect(byRun.total).toBe(2)
    expect(byRun.list.every(f => f.runId === 'run-2001')).toBe(true)
  })
})
