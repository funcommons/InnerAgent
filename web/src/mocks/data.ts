/**
 * [new] msw mock 数据种子与内存存储。
 * 时间锚定 2026-09-20(契约时间基线);动作类 handler 直接改写内存数组。
 * resetMockData() 在每条用例后恢复种子(setup.ts 调用)。
 */
import type {
  CircuitBreakerEvent,
  IaApp,
  IaAuditLog,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  ResourceLimits,
  WebhookConfig,
  WebhookDelivery,
} from '@/api/types'

export const MOCK_TIME = '2026-09-20T08:00:00Z'

let nextId = 1000
export function genId(): number {
  return nextId++
}

// ==================== 应用 ====================

export const seedApps: IaApp[] = [
  {
    id: 1,
    appKey: 'demo-app',
    name: '演示宿主应用',
    status: 1,
    signPublicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAdemo\n-----END PUBLIC KEY-----',
    signKeyFingerprint: 'sha256:1a2b3c4d5e6f7081',
    signKeyUpdatedAt: '2026-09-10T02:00:00Z',
    retentionDays: 180,
    emergencyStopped: false,
    emergencyStopReason: null,
    webhookUrl: 'https://demo.example.com/ia/callback',
    webhookSecretMasked: 'whsec-••••9f2e',
    webhookEnabled: true,
    remark: '内置演练宿主(demo-host)',
    createTime: '2026-09-01T00:00:00Z',
    updateTime: '2026-09-10T02:00:00Z',
  },
  {
    id: 2,
    appKey: 'shop-app',
    name: '商城后台',
    status: 1,
    signPublicKey: null,
    signKeyFingerprint: null,
    signKeyUpdatedAt: null,
    retentionDays: 90,
    emergencyStopped: false,
    emergencyStopReason: null,
    webhookUrl: null,
    webhookSecretMasked: null,
    webhookEnabled: false,
    remark: '待登记公钥,embed token 尚不可用',
    createTime: '2026-09-12T00:00:00Z',
    updateTime: '2026-09-12T00:00:00Z',
  },
  {
    id: 3,
    appKey: 'legacy-app',
    name: '旧版归档应用',
    status: 0,
    signPublicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8Aold\n-----END PUBLIC KEY-----',
    signKeyFingerprint: 'sha256:ffff00001111',
    signKeyUpdatedAt: '2026-08-01T00:00:00Z',
    retentionDays: 180,
    emergencyStopped: true,
    emergencyStopReason: '成本异常演练',
    webhookUrl: null,
    webhookSecretMasked: null,
    webhookEnabled: false,
    remark: null,
    createTime: '2026-07-01T00:00:00Z',
    updateTime: '2026-09-18T09:30:00Z',
  },
]

// ==================== 工具注册表 ====================

function tool(partial: Partial<IaToolRegistry> & Pick<IaToolRegistry, 'id' | 'serverKey' | 'toolName'>): IaToolRegistry {
  const fqn = `mcp__${partial.serverKey}__${partial.toolName}`
  return {
    appId: 1,
    serverName: partial.serverKey === 'demo_host' ? '演示宿主 MCP' : 'CRM 系统 MCP',
    endpoint: partial.serverKey === 'demo_host' ? 'http://demo-host:8080/ia-mcp' : 'http://crm:9090/mcp',
    transport: 'streamable_http',
    credentialMasked: '••••',
    fqn,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    schemaFingerprint: `sha256:${String(partial.id).padStart(4, '0')}fp`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    riskLevel: 'medium',
    writeOperation: true,
    adminPolicy: 'default',
    resumeSafe: false,
    healthStatus: 'healthy',
    healthMessage: null,
    lastSyncedAt: MOCK_TIME,
    status: 1,
    createTime: '2026-09-05T00:00:00Z',
    updateTime: MOCK_TIME,
    ...partial,
  }
}

export const seedTools: IaToolRegistry[] = [
  tool({ id: 1, serverKey: 'demo_host', toolName: 'get_user', description: '按 ID 查询用户信息', riskLevel: 'low', writeOperation: false, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, resumeSafe: true }),
  tool({ id: 2, serverKey: 'demo_host', toolName: 'update_user', description: '更新用户资料字段', riskLevel: 'high', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }),
  tool({ id: 3, serverKey: 'demo_host', toolName: 'reset_password', description: '重置用户密码(高危:凭据类)', riskLevel: 'critical', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }),
  tool({ id: 4, serverKey: 'demo_host', toolName: 'list_login_records', description: '查询登录记录(只读)', riskLevel: 'low', writeOperation: false, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, resumeSafe: true }),
  tool({ id: 5, serverKey: 'demo_host', toolName: 'delete_flow', description: '删除流程(高危:删除类)', riskLevel: 'critical', adminPolicy: 'force-ask', healthStatus: 'unhealthy', healthMessage: '连通性测试超时(2026-09-19)', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }),
  tool({ id: 6, serverKey: 'crm', toolName: 'search_customers', description: '检索客户(三方 MCP,一律确认)', serverName: 'CRM 系统 MCP', endpoint: 'http://crm:9090/mcp', riskLevel: 'medium', writeOperation: false, adminPolicy: 'force-ask', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }),
  tool({ id: 7, serverKey: 'crm', toolName: 'update_customer_note', description: '写入 CRM 客户备注', serverName: 'CRM 系统 MCP', endpoint: 'http://crm:9090/mcp', riskLevel: 'high', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }),
  tool({ id: 8, serverKey: 'demo_host', toolName: 'refresh_cache', description: '刷新宿主缓存(幂等写)', riskLevel: 'medium', resumeSafe: true, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }),
  tool({ id: 9, serverKey: 'demo_host', toolName: 'export_users', description: '导出用户清单(停用示例)', riskLevel: 'medium', status: 0, healthStatus: 'unknown', healthMessage: '已停用', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }),
]

// ==================== 工具授权 ====================

export const seedGrants: IaToolGrant[] = [
  { id: 21, appId: 1, userId: 'user-12993', toolFqn: 'mcp__demo_host__update_user', scope: 'permanent', conversationId: null, grantedRiskLevel: 'high', schemaFingerprint: 'sha256:0002fp', source: 'user-grant', invalid: false, invalidReason: null, grantedAt: '2026-09-08T10:00:00Z' },
  { id: 22, appId: 1, userId: 'user-20001', toolFqn: 'mcp__demo_host__update_user', scope: 'session', conversationId: 'conv-777', grantedRiskLevel: 'high', schemaFingerprint: 'sha256:0002fp', source: 'user-grant', invalid: false, invalidReason: null, grantedAt: '2026-09-19T14:20:00Z' },
  { id: 23, appId: 1, userId: 'user-12993', toolFqn: 'mcp__demo_host__reset_password', scope: 'permanent', conversationId: null, grantedRiskLevel: 'medium', schemaFingerprint: 'sha256:0003fp', source: 'user-grant', invalid: true, invalidReason: 'risk-upgraded', grantedAt: '2026-09-02T08:00:00Z' },
  { id: 24, appId: 1, userId: 'user-30077', toolFqn: 'mcp__crm__update_customer_note', scope: 'permanent', conversationId: null, grantedRiskLevel: 'high', schemaFingerprint: 'sha256:old-fp', source: 'user-grant', invalid: true, invalidReason: 'schema-changed', grantedAt: '2026-09-06T09:00:00Z' },
  { id: 25, appId: 1, userId: 'user-30077', toolFqn: 'mcp__demo_host__export_users', scope: 'permanent', conversationId: null, grantedRiskLevel: 'medium', schemaFingerprint: 'sha256:0009fp', source: 'user-grant', invalid: true, invalidReason: 'tool-disabled', grantedAt: '2026-09-05T09:00:00Z' },
]

// ==================== 审计日志 ====================

function audit(partial: Partial<IaAuditLog> & Pick<IaAuditLog, 'id' | 'toolFqn' | 'decisionSource' | 'resultStatus'>): IaAuditLog {
  return {
    appId: 1,
    appKey: 'demo-app',
    userId: 'user-12993',
    tenantId: 'tenant-a',
    conversationId: `conv-${1000 + (partial.id ?? 0)}`,
    runId: `run-${2000 + (partial.id ?? 0)}`,
    paramsMasked: '{"userId":"12993","password":"••••••••"}',
    errorMessage: null,
    riskLevel: 'medium',
    confirmedBy: null,
    latencyMs: 420,
    occurredAt: MOCK_TIME,
    ...partial,
  }
}

export const seedAuditLogs: IaAuditLog[] = [
  audit({ id: 31, toolFqn: 'mcp__demo_host__get_user', decisionSource: 'mode-default', resultStatus: 'success', riskLevel: 'low', paramsMasked: '{"userId":"12993"}', occurredAt: '2026-09-20T07:59:00Z' }),
  audit({ id: 32, toolFqn: 'mcp__demo_host__reset_password', decisionSource: 'live-confirm', resultStatus: 'success', riskLevel: 'critical', confirmedBy: 'user-12993', occurredAt: '2026-09-20T07:58:30Z' }),
  audit({ id: 33, toolFqn: 'mcp__demo_host__delete_flow', decisionSource: 'forced-policy', resultStatus: 'denied', riskLevel: 'critical', errorMessage: '用户拒绝:记录未被修改', confirmedBy: 'user-12993', occurredAt: '2026-09-19T18:12:00Z' }),
  audit({ id: 34, toolFqn: 'mcp__demo_host__update_user', decisionSource: 'user-grant', resultStatus: 'success', riskLevel: 'high', occurredAt: '2026-09-19T16:40:00Z' }),
  audit({ id: 35, toolFqn: 'mcp__demo_host__get_user', decisionSource: 'mode-default', resultStatus: 'failed', riskLevel: 'low', errorMessage: '宿主 MCP 超时', latencyMs: 30000, occurredAt: '2026-09-19T15:02:00Z' }),
  audit({ id: 36, toolFqn: 'mcp__crm__search_customers', decisionSource: 'forced-policy', resultStatus: 'success', riskLevel: 'medium', userId: 'user-30077', occurredAt: '2026-09-18T11:00:00Z' }),
  audit({ id: 37, toolFqn: 'mcp__demo_host__list_login_records', decisionSource: 'mode-default', resultStatus: 'success', riskLevel: 'low', userId: 'user-20001', paramsMasked: '{"userId":"20001","days":30}', occurredAt: '2026-09-18T10:30:00Z' }),
  audit({ id: 38, toolFqn: 'mcp__demo_host__refresh_cache', decisionSource: 'mode-default', resultStatus: 'success', riskLevel: 'medium', occurredAt: '2026-09-17T09:00:00Z' }),
  audit({ id: 39, toolFqn: 'mcp__demo_host__delete_flow', decisionSource: 'forced-policy', resultStatus: 'timeout', riskLevel: 'critical', errorMessage: '确认等待超时(24h)自动拒绝', occurredAt: '2026-09-16T08:00:00Z' }),
  audit({ id: 40, toolFqn: 'mcp__demo_host__update_user', decisionSource: 'full-access', resultStatus: 'success', riskLevel: 'high', errorMessage: 'FULL_ACCESS 一次性确认已审计', userId: 'user-20001', occurredAt: '2026-09-15T13:00:00Z' }),
  audit({ id: 41, toolFqn: 'mcp__crm__update_customer_note', decisionSource: 'live-confirm', resultStatus: 'denied', riskLevel: 'high', userId: 'user-30077', errorMessage: '用户拒绝:备注未写入', confirmedBy: 'user-30077', occurredAt: '2026-09-14T10:00:00Z' }),
  audit({ id: 42, toolFqn: 'mcp__demo_host__reset_password', decisionSource: 'user-grant', resultStatus: 'denied', riskLevel: 'critical', errorMessage: '授权已失效(risk-upgraded)', occurredAt: '2026-09-13T08:00:00Z' }),
]

// ==================== 模型配置 ====================

export const seedModelConfigs: IaModelApiConfig[] = [
  { id: 51, name: 'DeepSeek 生产', platform: 'openai_compatible', apiUrl: 'https://api.deepseek.com', autoAppendV1Path: true, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: 'sk-d1••••7a9f', status: 1, remark: '默认主模型配置', createTime: '2026-09-01T00:00:00Z', updateTime: '2026-09-15T00:00:00Z' },
  { id: 52, name: '通义千问(DashScope)', platform: 'dashscope', apiUrl: 'https://dashscope.aliyuncs.com', autoAppendV1Path: false, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: 'sk-qw••••3cd2', status: 1, remark: '国内生产推荐(PRD §6.3)', createTime: '2026-09-01T00:00:00Z', updateTime: '2026-09-10T00:00:00Z' },
  { id: 53, name: 'Claude(Anthropic)', platform: 'anthropic', apiUrl: 'https://api.anthropic.com', autoAppendV1Path: false, proxyType: 'http', proxyHost: 'proxy.internal', proxyPort: 3128, proxyUsername: 'ia-proxy', apiKeyMasked: 'sk-an••••11bb', status: 1, remark: '海外业务调试', createTime: '2026-09-02T00:00:00Z', updateTime: '2026-09-02T00:00:00Z' },
  { id: 54, name: '本地 Ollama', platform: 'ollama', apiUrl: 'http://localhost:11434', autoAppendV1Path: false, proxyType: 'none', proxyHost: null, proxyPort: null, proxyUsername: null, apiKeyMasked: '', status: 0, remark: '私有化备用(停用中)', createTime: '2026-09-03T00:00:00Z', updateTime: '2026-09-03T00:00:00Z' },
]

// ==================== 熔断与资源上限(§4.7 默认值) ====================

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

// ==================== Webhook ====================

export const seedWebhookConfig: WebhookConfig = {
  appId: 1,
  url: 'https://demo.example.com/ia/callback',
  secretMasked: 'whsec-••••9f2e',
  enabled: true,
  events: ['run.finished', 'run.failed', 'run.cancelled'],
}

export const seedDeliveries: WebhookDelivery[] = [
  { id: 71, event: 'run.finished', runId: 'run-2040', url: 'https://demo.example.com/ia/callback', success: true, attempt: 1, maxAttempts: 5, httpStatus: 200, responseSummary: 'OK', nextRetryAt: null, deliveredAt: '2026-09-20T07:58:35Z' },
  { id: 72, event: 'run.failed', runId: 'run-2041', url: 'https://demo.example.com/ia/callback', success: false, attempt: 3, maxAttempts: 5, httpStatus: 503, responseSummary: 'Service Unavailable', nextRetryAt: '2026-09-20T08:16:00Z', deliveredAt: '2026-09-20T07:59:10Z' },
  { id: 73, event: 'run.cancelled', runId: 'run-2042', url: 'https://demo.example.com/ia/callback', success: true, attempt: 2, maxAttempts: 5, httpStatus: 200, responseSummary: 'OK(重试 1 次后成功)', nextRetryAt: null, deliveredAt: '2026-09-19T17:02:00Z' },
]

// ==================== 内存存储与重置 ====================

export interface MockStore {
  apps: IaApp[]
  tools: IaToolRegistry[]
  grants: IaToolGrant[]
  auditLogs: IaAuditLog[]
  modelConfigs: IaModelApiConfig[]
  limits: ResourceLimits
  circuitEvents: CircuitBreakerEvent[]
  circuitState: { emergencyStopped: boolean; stoppedAt: string | null; stopReason: string | null }
  webhookConfig: WebhookConfig
  deliveries: WebhookDelivery[]
}

export const store: MockStore = {
  apps: [],
  tools: [],
  grants: [],
  auditLogs: [],
  modelConfigs: [],
  limits: { ...seedLimits },
  circuitEvents: [],
  circuitState: { emergencyStopped: false, stoppedAt: null, stopReason: null },
  webhookConfig: { ...seedWebhookConfig },
  deliveries: [],
}

/** 深拷贝种子 → 内存存储(每条用例后调用,保证确定性) */
export function resetMockData(): void {
  store.apps = structuredClone(seedApps)
  store.tools = structuredClone(seedTools)
  store.grants = structuredClone(seedGrants)
  store.auditLogs = structuredClone(seedAuditLogs)
  store.modelConfigs = structuredClone(seedModelConfigs)
  store.limits = { ...seedLimits }
  store.circuitEvents = structuredClone(seedCircuitEvents)
  store.circuitState = { emergencyStopped: false, stoppedAt: null, stopReason: null }
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

/** 模拟 sha256 指纹(mock 不做真哈希,保证格式一致) */
export function fakeSha256(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `sha256:${h.toString(16).padStart(8, '0')}${seed.length.toString(16).padStart(4, '0')}`
}
