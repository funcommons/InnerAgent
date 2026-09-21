/**
 * [new] msw mock 数据种子与内存存储。
 * 时间锚定 2026-09-20(契约时间基线);动作类 handler 直接改写内存数组。
 * resetMockData() 在每条用例后恢复种子(setup.ts 调用)。
 * 种子形 = 服务端真实响应视图形(AppRegistration/ToolRegistryEntry/
 * ToolGrant/ia_audit_log 列);circuit/webhook 状态含 activeRuns 等扩展字段。
 */
import type {
  CircuitBreakerEvent,
  IaApp,
  IaAuditLog,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  IaToolSchemaHistory,
  ResourceLimits,
  WebhookConfig,
  WebhookDelivery,
} from '@/api/types'

export const MOCK_TIME = '2026-09-20T08:00:00Z'

let nextId = 1000
export function genId(): number {
  return nextId++
}

const PEM_DEMO = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAdemo\n-----END PUBLIC KEY-----'
const PEM_LEGACY = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8Aold\n-----END PUBLIC KEY-----'

// ==================== 应用(ia_app 响应视图形,P2-key AppView) ====================

export const seedApps: IaApp[] = [
  {
    id: 1,
    appKey: 'demo-app',
    name: '演示宿主应用',
    signPublicKey: PEM_DEMO,
    signKeyFingerprint: 'a1b2c3d4e5f60718',
    signKeyRotatedAt: '2026-09-10T02:00:00Z',
    webhookUrl: 'https://demo.example.com/ia/callback',
    webhookSecretMasked: 'whse••••9f2e',
    conversationRetentionDays: 180,
    status: 1,
    createTime: '2026-09-01T00:00:00Z',
    updateTime: '2026-09-10T02:00:00Z',
  },
  {
    id: 2,
    appKey: 'shop-app',
    name: '商城后台',
    signPublicKey: null,
    signKeyFingerprint: null,
    signKeyRotatedAt: null,
    webhookUrl: null,
    webhookSecretMasked: null,
    conversationRetentionDays: 180,
    status: 1,
    createTime: '2026-09-12T00:00:00Z',
    updateTime: '2026-09-12T00:00:00Z',
  },
  {
    id: 3,
    appKey: 'legacy-app',
    name: '旧版归档应用',
    signPublicKey: PEM_LEGACY,
    signKeyFingerprint: '0f9e8d7c6b5a4321',
    signKeyRotatedAt: '2026-07-01T00:00:00Z',
    webhookUrl: null,
    webhookSecretMasked: null,
    conversationRetentionDays: 180,
    status: 0,
    createTime: '2026-07-01T00:00:00Z',
    updateTime: '2026-09-18T09:30:00Z',
  },
]

// ==================== 工具注册表(ia_tool_registry 真实列形) ====================

function tool(partial: Partial<IaToolRegistry> & Pick<IaToolRegistry, 'id' | 'serverKey' | 'toolName'>): IaToolRegistry {
  const fqn = `mcp__${partial.serverKey}__${partial.toolName}`
  return {
    appId: 1,
    fqn,
    description: '',
    parametersSchema: '{"type":"object","properties":{}}',
    annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}',
    riskLevel: 'medium',
    adminPolicy: null,
    resumeSafe: false,
    concurrencySafe: false,
    source: partial.serverKey === 'crm' ? 'third_party' : 'host_app',
    endpointUrl: partial.serverKey === 'crm' ? 'http://crm:9090/mcp' : null,
    credentialsEnc: null,
    schemaSha256: `sha256:${String(partial.id).padStart(4, '0')}fp`,
    toolVersion: null,
    revalidateRequired: false,
    pendingSchema: null,
    pendingAnnotationsJson: null,
    pendingSchemaSha256: null,
    pendingRefreshAt: null,
    enabled: true,
    lastTestStatus: null,
    createTime: '2026-09-05T00:00:00Z',
    updateTime: MOCK_TIME,
    deleted: false,
    ...partial,
  }
}

export const seedTools: IaToolRegistry[] = [
  tool({ id: 1, serverKey: 'demo_host', toolName: 'get_user', description: '按 ID 查询用户信息', riskLevel: 'low', resumeSafe: true, annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}' }),
  tool({ id: 2, serverKey: 'demo_host', toolName: 'update_user', description: '更新用户资料字段', riskLevel: 'high' }),
  // 凭据类关键词(password)强制高危,且管理员不可下调(服务端 400)
  tool({ id: 3, serverKey: 'demo_host', toolName: 'reset_password', description: '重置用户密码(高危:凭据类)', riskLevel: 'high', annotationsJson: '{"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false}' }),
  tool({ id: 4, serverKey: 'demo_host', toolName: 'list_login_records', description: '查询登录记录(只读)', riskLevel: 'low', resumeSafe: true, annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}' }),
  // 删除类关键词(delete)强制高危;lastTestStatus 为最近体检结果(真实列)
  tool({ id: 5, serverKey: 'demo_host', toolName: 'delete_flow', description: '删除流程(高危:删除类)', riskLevel: 'high', adminPolicy: 'force-ask', lastTestStatus: '连通性测试超时(2026-09-19)', annotationsJson: '{"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false}' }),
  tool({ id: 6, serverKey: 'crm', toolName: 'search_customers', description: '检索客户(三方 MCP,一律确认)', riskLevel: 'medium', adminPolicy: 'force-ask', annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":true}' }),
  tool({ id: 7, serverKey: 'crm', toolName: 'update_customer_note', description: '写入 CRM 客户备注', riskLevel: 'high', annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":true}' }),
  tool({ id: 8, serverKey: 'demo_host', toolName: 'refresh_cache', description: '刷新宿主缓存(幂等写)', riskLevel: 'medium', resumeSafe: true, annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}' }),
  tool({ id: 9, serverKey: 'demo_host', toolName: 'export_users', description: '导出用户清单(停用示例)', riskLevel: 'medium', enabled: false }),
]

// ==================== 工具授权(ia_tool_grant 真实列形) ====================

export const seedGrants: IaToolGrant[] = [
  { id: 21, appId: 1, userId: 12993, toolFqn: 'mcp__demo_host__update_user', scope: 'permanent', conversationId: null, riskAtGrant: 'high', schemaSha256: 'sha256:0002fp', source: 'live-confirm', invalidated: false, invalidatedReason: null, decisionNote: '用户在确认卡选择「总是允许」', tenantId: 0, createTime: '2026-09-08T10:00:00Z', updateTime: '2026-09-08T10:00:00Z', deleted: false },
  { id: 22, appId: 1, userId: 20001, toolFqn: 'mcp__demo_host__update_user', scope: 'conversation', conversationId: 'conv-777', riskAtGrant: 'high', schemaSha256: 'sha256:0002fp', source: 'live-confirm', invalidated: false, invalidatedReason: null, decisionNote: '本会话允许', tenantId: 0, createTime: '2026-09-19T14:20:00Z', updateTime: '2026-09-19T14:20:00Z', deleted: false },
  { id: 23, appId: 1, userId: 12993, toolFqn: 'mcp__demo_host__reset_password', scope: 'permanent', conversationId: null, riskAtGrant: 'medium', schemaSha256: 'sha256:0003fp', source: 'admin', invalidated: true, invalidatedReason: 'risk_upgrade', decisionNote: '管理站代授(后风险升级失效)', tenantId: 0, createTime: '2026-09-02T08:00:00Z', updateTime: '2026-09-10T08:00:00Z', deleted: false },
  { id: 24, appId: 1, userId: 30077, toolFqn: 'mcp__crm__update_customer_note', scope: 'permanent', conversationId: null, riskAtGrant: 'high', schemaSha256: 'sha256:old-fp', source: 'live-confirm', invalidated: true, invalidatedReason: 'schema_breaking', decisionNote: null, tenantId: 0, createTime: '2026-09-06T09:00:00Z', updateTime: '2026-09-12T09:00:00Z', deleted: false },
  { id: 25, appId: 1, userId: 30077, toolFqn: 'mcp__demo_host__export_users', scope: 'permanent', conversationId: null, riskAtGrant: 'medium', schemaSha256: 'sha256:0009fp', source: 'admin', invalidated: true, invalidatedReason: 'tool_disabled', decisionNote: '工具停用级联失效', tenantId: 0, createTime: '2026-09-05T09:00:00Z', updateTime: '2026-09-06T09:00:00Z', deleted: false },
]

// ==================== 审计日志(ia_audit_log 真实列形,镜像 AdminAuditController) ====================

function audit(partial: Partial<IaAuditLog> & Pick<IaAuditLog, 'id' | 'toolFqn' | 'decisionSource' | 'decision'>): IaAuditLog {
  return {
    appId: 1,
    tenantId: 0,
    userId: 12993,
    conversationId: `conv-${1000 + (partial.id ?? 0)}`,
    runId: `run-${2000 + (partial.id ?? 0)}`,
    paramsMaskedJson: '{"userId":"12993","password":"••••••••"}',
    resultSummary: null,
    errorText: null,
    riskLevel: 'medium',
    durationMs: 420,
    createTime: MOCK_TIME,
    ...partial,
  }
}

export const seedAuditLogs: IaAuditLog[] = [
  audit({ id: 31, toolFqn: 'mcp__demo_host__get_user', decisionSource: 'mode-default', decision: 'allowed', riskLevel: 'low', paramsMaskedJson: '{"userId":"12993"}', resultSummary: '查询完成', createTime: '2026-09-20T07:59:00Z' }),
  audit({ id: 32, toolFqn: 'mcp__demo_host__reset_password', decisionSource: 'live-confirm', decision: 'allowed', riskLevel: 'high', resultSummary: '确认卡批准后执行', createTime: '2026-09-20T07:58:30Z' }),
  audit({ id: 33, toolFqn: 'mcp__demo_host__delete_flow', decisionSource: 'forced-policy', decision: 'denied', riskLevel: 'high', errorText: '用户拒绝:记录未被修改', durationMs: null, createTime: '2026-09-19T18:12:00Z' }),
  audit({ id: 34, toolFqn: 'mcp__demo_host__update_user', decisionSource: 'user-grant', decision: 'allowed', riskLevel: 'high', resultSummary: '命中「总是允许」授权', createTime: '2026-09-19T16:40:00Z' }),
  audit({ id: 35, toolFqn: 'mcp__demo_host__get_user', decisionSource: 'mode-default', decision: 'allowed', riskLevel: 'low', paramsMaskedJson: '{"userId":"12993"}', errorText: '宿主 MCP 超时(执行失败)', durationMs: 30000, createTime: '2026-09-19T15:02:00Z' }),
  audit({ id: 36, toolFqn: 'mcp__crm__search_customers', decisionSource: 'forced-policy', decision: 'allowed', riskLevel: 'medium', userId: 30077, resultSummary: '检索返回 8 条', createTime: '2026-09-18T11:00:00Z' }),
  audit({ id: 37, toolFqn: 'mcp__demo_host__list_login_records', decisionSource: 'mode-default', decision: 'allowed', riskLevel: 'low', userId: 20001, paramsMaskedJson: '{"userId":"20001","days":30}', createTime: '2026-09-18T10:30:00Z' }),
  audit({ id: 38, toolFqn: 'mcp__demo_host__refresh_cache', decisionSource: 'mode-default', decision: 'allowed', riskLevel: 'medium', createTime: '2026-09-17T09:00:00Z' }),
  // 确认等待超时:decision_source=expired(V8 档;run 终态 CANCELLED 自动拒绝)
  audit({ id: 39, toolFqn: 'mcp__demo_host__delete_flow', decisionSource: 'expired', decision: 'denied', riskLevel: 'high', errorText: '确认等待超时(24h)自动拒绝(confirmation-expired)', durationMs: null, createTime: '2026-09-16T08:00:00Z' }),
  audit({ id: 40, toolFqn: 'mcp__demo_host__update_user', decisionSource: 'full-access', decision: 'allowed', riskLevel: 'high', userId: 20001, resultSummary: 'FULL_ACCESS 一次性确认已审计', createTime: '2026-09-15T13:00:00Z' }),
  audit({ id: 41, toolFqn: 'mcp__crm__update_customer_note', decisionSource: 'live-confirm', decision: 'denied', riskLevel: 'high', userId: 30077, errorText: '用户拒绝:备注未写入', durationMs: null, createTime: '2026-09-14T10:00:00Z' }),
  audit({ id: 42, toolFqn: 'mcp__demo_host__reset_password', decisionSource: 'user-grant', decision: 'denied', riskLevel: 'high', errorText: '授权已失效(risk_upgrade)', durationMs: null, createTime: '2026-09-13T08:00:00Z' }),
]

// ==================== 模型配置(依赖并行任务,联调时核对) ====================

export const seedModelConfigs: IaModelApiConfig[] = [
  { id: 51, name: 'DeepSeek 生产', platform: 'openai_compatible', textProtocol: 'openai_compatible', apiUrl: 'https://api.deepseek.com', autoAppendV1Path: true, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: 'sk-d1••••7a9f', status: 1, remark: '默认主模型配置', createTime: '2026-09-01T00:00:00Z', updateTime: '2026-09-15T00:00:00Z' },
  { id: 52, name: '通义千问(DashScope)', platform: 'dashscope', textProtocol: null, apiUrl: 'https://dashscope.aliyuncs.com', autoAppendV1Path: false, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: 'sk-qw••••3cd2', status: 1, remark: '国内生产推荐(PRD §6.3)', createTime: '2026-09-01T00:00:00Z', updateTime: '2026-09-10T00:00:00Z' },
  { id: 53, name: 'Claude(Anthropic)', platform: 'anthropic', textProtocol: 'openai_compatible', apiUrl: 'https://api.anthropic.com', autoAppendV1Path: false, proxyType: 'http', proxyHost: 'proxy.internal', proxyPort: 3128, proxyUsername: 'ia-proxy', apiKeyMasked: 'sk-an••••11bb', status: 1, remark: '海外业务调试', createTime: '2026-09-02T00:00:00Z', updateTime: '2026-09-02T00:00:00Z' },
  { id: 54, name: '本地 Ollama', platform: 'ollama', textProtocol: null, apiUrl: 'http://localhost:11434', autoAppendV1Path: false, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: '', status: 0, remark: '私有化备用(停用中)', createTime: '2026-09-03T00:00:00Z', updateTime: '2026-09-03T00:00:00Z' },
]

// ==================== 熔断与资源上限(§4.7 默认值;镜像 AdminCircuitBreakerController) ====================

export const seedLimits: ResourceLimits = {
  maxToolCallsPerRun: 32,
  maxTokensPerRun: 300000,
  maxRunDurationMinutes: 30,
  toolRetryLimit: 2,
  mcpConcurrency: 8,
  mcpQps: 20,
  confirmTimeoutHours: 24,
}

export const seedCircuitEvents: CircuitBreakerEvent[] = [
  { id: 61, type: 'limit-triggered', runId: 'run-2042', reason: '单运行工具调用次数超限(32)', operator: 'system', occurredAt: '2026-09-19T17:00:00Z' },
  { id: 62, type: 'emergency-stop', runId: null, reason: '成本异常演练', operator: 'admin', occurredAt: '2026-09-18T09:30:00Z' },
  { id: 63, type: 'resume', runId: null, reason: '人工恢复', operator: 'admin', occurredAt: '2026-09-18T10:00:00Z' },
]

// ==================== Webhook(deliveries=#18b;config=AdminWebhookConfigController 镜像) ====================

export const seedWebhookConfig: WebhookConfig = {
  appId: 1,
  url: 'https://demo.example.com/ia/callback',
  secretMasked: 'whsec-••••9f2e',
  enabled: true,
  events: ['run.finished', 'run.failed', 'run.cancelled'],
}

/** 种子覆盖投递状态机全集:PENDING/FAILED/SUCCESS(含重试后成功) */
export const seedDeliveries: WebhookDelivery[] = [
  { id: 71, appId: 1, event: 'run.finished', runId: 'run-2040', url: 'https://demo.example.com/ia/callback', success: true, status: 'SUCCESS', attempt: 1, maxAttempts: 5, httpStatus: 200, responseSummary: 'OK', nextRetryAt: null, deliveredAt: '2026-09-20T07:58:35Z' },
  { id: 72, appId: 1, event: 'run.failed', runId: 'run-2041', url: 'https://demo.example.com/ia/callback', success: false, status: 'FAILED', attempt: 3, maxAttempts: 5, httpStatus: 503, responseSummary: 'Service Unavailable', nextRetryAt: '2026-09-20T08:16:00Z', deliveredAt: null },
  { id: 73, appId: 1, event: 'run.cancelled', runId: 'run-2042', url: 'https://demo.example.com/ia/callback', success: true, status: 'SUCCESS', attempt: 2, maxAttempts: 5, httpStatus: 200, responseSummary: 'OK(重试 1 次后成功)', nextRetryAt: null, deliveredAt: '2026-09-19T17:02:00Z' },
  { id: 74, appId: 1, event: 'run.finished', runId: 'run-2043', url: 'https://demo.example.com/ia/callback', success: false, status: 'PENDING', attempt: 0, maxAttempts: 5, httpStatus: null, responseSummary: null, nextRetryAt: null, deliveredAt: null },
]

// ==================== 内存存储与重置 ====================

export interface MockStore {
  apps: IaApp[]
  tools: IaToolRegistry[]
  /** schema 指纹变更历史(ia_tool_schema_history,仅追加) */
  schemaHistory: IaToolSchemaHistory[]
  grants: IaToolGrant[]
  auditLogs: IaAuditLog[]
  modelConfigs: IaModelApiConfig[]
  limits: ResourceLimits
  circuitEvents: CircuitBreakerEvent[]
  circuitState: { emergencyStopped: boolean; stoppedAt: string | null; stopReason: string | null; activeRuns: number }
  webhookConfig: WebhookConfig
  deliveries: WebhookDelivery[]
}

export const store: MockStore = {
  apps: [],
  tools: [],
  schemaHistory: [],
  grants: [],
  auditLogs: [],
  modelConfigs: [],
  limits: { ...seedLimits },
  circuitEvents: [],
  circuitState: { emergencyStopped: false, stoppedAt: null, stopReason: null, activeRuns: 1 },
  webhookConfig: { ...seedWebhookConfig },
  deliveries: [],
}

/** 深拷贝种子 → 内存存储(每条用例后调用,保证确定性) */
export function resetMockData(): void {
  store.apps = structuredClone(seedApps)
  store.tools = structuredClone(seedTools)
  store.schemaHistory = []
  store.grants = structuredClone(seedGrants)
  store.auditLogs = structuredClone(seedAuditLogs)
  store.modelConfigs = structuredClone(seedModelConfigs)
  store.limits = { ...seedLimits }
  store.circuitEvents = structuredClone(seedCircuitEvents)
  store.circuitState = { emergencyStopped: false, stoppedAt: null, stopReason: null, activeRuns: 1 }
  store.webhookConfig = structuredClone(seedWebhookConfig)
  store.deliveries = structuredClone(seedDeliveries)
  nextId = 1000
}

/** 密钥掩码(对齐 utils/api-config.ts maskSecret 语义) */
export function maskKey(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

/**
 * 公钥指纹(mock 不做真 DER 摘要;镜像 AdminAppService.fingerprintOf 输出形:
 * 公钥 DER SHA-256 hex 前 16 位)
 */
export function fakeFingerprint(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (const ch of seed) {
    h1 = ((h1 ^ ch.charCodeAt(0)) * 0x01000193) >>> 0
    h2 = ((h2 + ch.charCodeAt(0)) * 0x85ebca6b) >>> 0
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0').slice(0, 16)
}

/** 模拟 sha256 指纹(mock 不做真哈希,保证格式一致;服务端为 canonical JSON SHA-256) */
export function fakeSha256(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `sha256:${h.toString(16).padStart(8, '0')}${seed.length.toString(16).padStart(4, '0')}`
}
