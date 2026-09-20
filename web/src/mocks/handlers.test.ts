/**
 * [new] mock 后端(handler)契约测试:分页/过滤/动作语义/认证守卫。
 * 同时充当 P2 真实后端实现的对齐样本(动作语义注释见 handlers.ts)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setAdminKeyGetter } from '@/api/request'
import { ApiErrorCode } from '@/api/errorCodes'
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
  it('缺少 X-IA-Admin-Key → 401(HTTP 错误,code=HTTP 状态)', async () => {
    setAdminKeyGetter(() => '')
    const err = await appAdminApi.page().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(401)
    expect(apiErr.code).toBe(401)
    expect(apiErr.message).toContain('X-IA-Admin-Key')
    expect(apiErr.isAuthError()).toBe(true)
  })
})

describe('mock 后端:应用管理', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('种子 3 个应用;keyword/status 过滤生效', async () => {
    const all = await appAdminApi.page({ pageSize: 10 })
    expect(all.total).toBe(3)
    const filtered = await appAdminApi.page({ keyword: '商城', status: 1 })
    expect(filtered.total).toBe(1)
    expect(filtered.list[0]!.appKey).toBe('shop-app')
  })

  it('创建应用:appKey 重复 → 10401;成功返回完整结构', async () => {
    await expect(appAdminApi.create({ appKey: 'demo-app', name: '重复' }))
      .rejects.toMatchObject({ code: ApiErrorCode.DATA_ALREADY_EXISTS })
    const created = await appAdminApi.create({ appKey: 'new-app', name: '新应用' })
    expect(created.retentionDays).toBe(180)
    expect(created.signPublicKey).toBeNull()
    expect(created.status).toBe(1)
  })

  it('公钥登记:非 PEM → 400;合法 PEM 登记指纹;rotate 换指纹', async () => {
    await expect(appAdminApi.registerPublicKey(2, { publicKey: 'not-a-pem' }))
      .rejects.toMatchObject({ status: 400 })
    const first = await appAdminApi.registerPublicKey(2, { publicKey: '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----' })
    expect(first.fingerprint).toMatch(/^sha256:/)
    const rotated = await appAdminApi.rotateKey(2, { publicKey: '-----BEGIN PUBLIC KEY-----\nBBB\n-----END PUBLIC KEY-----' })
    expect(rotated.fingerprint).not.toBe(first.fingerprint)
    expect(rotated.updatedAt >= first.updatedAt).toBe(true)
  })
})

describe('mock 后端:工具注册', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('种子 9 把工具;riskLevel/status 过滤生效', async () => {
    const all = await toolAdminApi.page({ pageSize: 20 })
    expect(all.total).toBe(9)
    const critical = await toolAdminApi.page({ riskLevel: 'critical', pageSize: 20 })
    expect(critical.total).toBe(2)
    const disabled = await toolAdminApi.page({ status: 0, pageSize: 20 })
    expect(disabled.list.map(t => t.fqn)).toEqual(['mcp__demo_host__export_users'])
  })

  it('register:一次拉取两把工具并生成 FQN/指纹', async () => {
    const resp = await toolAdminApi.register({
      serverKey: 'new_host', serverName: '新宿主', endpoint: 'http://nh/ia-mcp', transport: 'streamable_http',
    })
    expect(resp.registered).toBe(2)
    expect(resp.tools.map(t => t.fqn)).toEqual(['mcp__new_host__get_status', 'mcp__new_host__apply_change'])
    expect(resp.tools[0]!.schemaFingerprint).toMatch(/^sha256:/)
    expect(resp.tools[1]!.writeOperation).toBe(true)
  })

  it('refresh 分诊:偶数 id 自动接受;奇数 id 安全相关不生效', async () => {
    const additive = await toolAdminApi.refresh(2)
    expect(additive.diffKind).toBe('additive')
    expect(additive.applied).toBe(true)
    const security = await toolAdminApi.refresh(3)
    expect(security.diffKind).toBe('security-related')
    expect(security.applied).toBe(false)
    const after = await toolAdminApi.get(3)
    expect(after.schemaFingerprint).toBe('sha256:0003fp')
  })

  it('disable:停用工具并级联失效其授权(export_users 已有 1 条)', async () => {
    await toolAdminApi.disable(1) // get_user
    const t = await toolAdminApi.get(1)
    expect(t.status).toBe(0)
    const grants = await toolGrantAdminApi.page({ toolFqn: 'mcp__demo_host__get_user', includeInvalid: true })
    // 种子中 get_user 无授权;用 update_user 验证级联
    void grants
    await toolAdminApi.disable(2) // update_user:种子 2 条有效授权
    const invalid = await toolGrantAdminApi.page({ toolFqn: 'mcp__demo_host__update_user', includeInvalid: true })
    expect(invalid.total).toBe(2)
    expect(invalid.list.every(g => g.invalid && g.invalidReason === 'tool-disabled')).toBe(true)
  })

  it('updatePolicy 风险升级:存量授权自动失效(risk-upgraded)', async () => {
    await toolAdminApi.updatePolicy(2, { riskLevel: 'critical' })
    const grants = await toolGrantAdminApi.page({ toolFqn: 'mcp__demo_host__update_user', includeInvalid: true })
    expect(grants.list.every(g => g.invalid && g.invalidReason === 'risk-upgraded')).toBe(true)
  })
})

describe('mock 后端:工具授权', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('默认不含失效授权;includeInvalid=true 全量;种子失效 3 条', async () => {
    const valid = await toolGrantAdminApi.page({ pageSize: 20 })
    expect(valid.total).toBe(2)
    const all = await toolGrantAdminApi.page({ includeInvalid: true, pageSize: 20 })
    expect(all.total).toBe(5)
  })

  it('grant:重复授予 → 10401;session 作用域锚定会话', async () => {
    await expect(toolGrantAdminApi.grant({ userId: 'user-12993', toolFqn: 'mcp__demo_host__update_user', scope: 'permanent' }))
      .rejects.toMatchObject({ code: ApiErrorCode.DATA_ALREADY_EXISTS })
    const granted = await toolGrantAdminApi.grant({ userId: 'user-99999', toolFqn: 'mcp__demo_host__update_user', scope: 'session' })
    expect(granted.conversationId).toBeTruthy()
    expect(granted.grantedRiskLevel).toBe('high')
    expect(granted.source).toBe('admin-grant')
  })

  it('revoke 后列表不再包含', async () => {
    await toolGrantAdminApi.revoke(21)
    const all = await toolGrantAdminApi.page({ includeInvalid: true, pageSize: 20 })
    expect(all.list.find(g => g.id === 21)).toBeUndefined()
  })
})

describe('mock 后端:审计查询', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('按时间倒序;decisionSource 过滤', async () => {
    const page = await auditAdminApi.page({ pageSize: 20 })
    expect(page.total).toBe(12)
    const dates = page.list.map(l => l.occurredAt)
    expect([...dates].sort().reverse()).toEqual(dates)
    const live = await auditAdminApi.page({ decisionSource: 'live-confirm', pageSize: 20 })
    expect(live.total).toBe(2)
    expect(live.list.every(l => l.decisionSource === 'live-confirm')).toBe(true)
  })

  it('时间范围 + appKey + userId 组合过滤', async () => {
    const page = await auditAdminApi.page({
      userId: 'user-12993',
      from: '2026-09-19T00:00:00Z',
      to: '2026-09-20T23:59:59Z',
      pageSize: 20,
    })
    expect(page.total).toBe(5)
    expect(page.list.every(l => l.userId === 'user-12993')).toBe(true)
  })
})

describe('mock 后端:模型配置', () => {
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

describe('mock 后端:熔断与 webhook', () => {
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

  it('webhook 配置保存密钥掩码;deliveries 过滤失败投递', async () => {
    const saved = await webhookAdminApi.saveConfig({ url: 'https://new.example.com/cb', secret: 'whsec-new-secret-9999' })
    expect(saved.secretMasked).toBe('whse••••9999')
    const failed = await webhookAdminApi.deliveries({ success: false, pageSize: 10 })
    expect(failed.total).toBe(1)
    expect(failed.list[0]!.attempt).toBe(3)
    expect(failed.list[0]!.nextRetryAt).toBeTruthy()
  })
})

describe('mock 后端:契约稳健性', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('不存在的资源 → 10400', async () => {
    await expect(appAdminApi.get(99999)).rejects.toBeInstanceOf(ApiError)
    await expect(appAdminApi.get(99999)).rejects.toMatchObject({ code: ApiErrorCode.RESOURCE_NOT_FOUND })
  })
})
