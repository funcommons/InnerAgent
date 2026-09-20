/**
 * [new] mock 后端(handler)契约测试:分页/过滤/动作语义/认证守卫。
 * P2 对齐:apps/tools/grants 断言与真实控制器行为一致(HTTP 状态=业务码、
 * 信封 msg 字段、错误语义 409/400/404);每域含「请求形=真实契约」断言。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setAdminKeyGetter } from '@/api/request'
import {
  appAdminApi,
  auditAdminApi,
  circuitAdminApi,
  modelConfigAdminApi,
  toolAdminApi,
  toolGrantAdminApi,
  webhookAdminApi,
} from '@/api/admin'
import { ApiError } from '@/api/errorCodes'

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
    // 行形 = ia_tool_registry 真实列
    expect(all[0]).toHaveProperty('schemaSha256')
    expect(all[0]).toHaveProperty('revalidateRequired')
    expect(all[0]).not.toHaveProperty('schemaFingerprint')
    expect(all[0]).not.toHaveProperty('healthStatus')
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

describe('mock 后端:熔断与 webhook(mock 域,服务端未实现)', () => {
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

  it('webhook 配置保存密钥掩码;deliveries(#18b 真路径)过滤失败投递', async () => {
    const saved = await webhookAdminApi.saveConfig({ url: 'https://new.example.com/cb', secret: 'whsec-new-secret-9999' })
    expect(saved.secretMasked).toBe('whse••••9999')
    const failed = await webhookAdminApi.deliveries({ success: false, pageSize: 10 })
    // PENDING(待投递)与 FAILED(退避中)都属「未成功」;时间字段已归一为 ISO
    expect(failed.total).toBe(2)
    expect(failed.list.map(d => d.status)).toContain('FAILED')
    expect(failed.list.map(d => d.status)).toContain('PENDING')
    const backoff = failed.list.find(d => d.attempt === 3)!
    expect(backoff.nextRetryAt).toBeTruthy()
    expect(backoff.nextRetryAt!).toContain('T')
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
