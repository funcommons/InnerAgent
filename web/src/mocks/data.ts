/**
 * [new] msw mock 数据种子与内存存储。
 * 时间锚定 2026-09-20(契约时间基线);动作类 handler 直接改写内存数组。
 * resetMockData() 在每条用例后恢复种子(setup.ts 调用)。
 * 种子形 = 服务端真实响应视图形(AppRegistration/ToolRegistryEntry/
 * ToolGrant/ia_audit_log 列);circuit/webhook 状态含 activeRuns 等扩展字段。
 * P4 批次扩档:三方 MCP 服务器 / Skill 目录 / mini 知识库 / 用量聚合 /
 * 用户反馈(种子形逐列镜像对应 VO/record,见各段注释)。
 */
import type {
  CircuitBreakerEvent,
  IaAgentDefinition,
  IaApp,
  IaAuditLog,
  IaFeedback,
  IaKbDocument,
  IaMcpServer,
  IaModelApiConfig,
  IaSkill,
  IaToolGrant,
  IaToolRegistry,
  IaToolSchemaHistory,
  ResourceLimits,
  UsageSummaryRow,
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
  const base: Omit<IaToolRegistry, 'id' | 'serverKey' | 'toolName'> = {
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
    // 工具体检位(V17):种子默认未体检(NULL);体检演示行见 seedTools 覆盖
    healthStatus: null,
    lastCheckedAt: null,
    healthDetailJson: null,
    enabled: true,
    lastTestStatus: null,
    createTime: '2026-09-05T00:00:00Z',
    updateTime: MOCK_TIME,
    deleted: false,
  }
  return { ...base, ...partial }
}

export const seedTools: IaToolRegistry[] = [
  tool({
    id: 1, serverKey: 'demo_host', toolName: 'get_user', description: '按 ID 查询用户信息', riskLevel: 'low', resumeSafe: true,
    annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}',
    // 体检演示行:全项通过 → ok(结论与明细同源,镜像 ToolHealthService.detailJson)
    healthStatus: 'ok', lastCheckedAt: '2026-09-19T22:00:00Z',
    healthDetailJson: JSON.stringify({
      status: 'ok',
      checks: [
        { check: 'endpoint_reachable', status: 'pass', detail: 'MCP initialize/listTools 握手成功' },
        { check: 'tool_present', status: 'pass', detail: 'toolName 在宿主清单中' },
        { check: 'schema_fingerprint', status: 'pass', detail: '指纹一致: sha256:0001fp' },
        { check: 'annotations_diff', status: 'pass', detail: '注解一致' },
      ],
    }),
  }),
  tool({ id: 2, serverKey: 'demo_host', toolName: 'update_user', description: '更新用户资料字段', riskLevel: 'high' }),
  // 凭据类关键词(password)强制高危,且管理员不可下调(服务端 400)
  tool({ id: 3, serverKey: 'demo_host', toolName: 'reset_password', description: '重置用户密码(高危:凭据类)', riskLevel: 'high', annotationsJson: '{"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false}' }),
  tool({ id: 4, serverKey: 'demo_host', toolName: 'list_login_records', description: '查询登录记录(只读)', riskLevel: 'low', resumeSafe: true, annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}' }),
  // 删除类关键词(delete)强制高危;lastTestStatus 为最近连通性测试结果(真实列)
  tool({ id: 5, serverKey: 'demo_host', toolName: 'delete_flow', description: '删除流程(高危:删除类)', riskLevel: 'high', adminPolicy: 'force-ask', lastTestStatus: '连通性测试超时(2026-09-19)', annotationsJson: '{"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false}' }),
  tool({ id: 6, serverKey: 'crm', toolName: 'search_customers', description: '检索客户(三方 MCP,一律确认)', riskLevel: 'medium', adminPolicy: 'force-ask', annotationsJson: '{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":true}' }),
  // 体检演示行:宿主清单缺失该工具 → tool_present 漂移 → degraded(体检历史)
  tool({
    id: 7, serverKey: 'crm', toolName: 'update_customer_note', description: '写入 CRM 客户备注', riskLevel: 'high',
    annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":true}',
    healthStatus: 'degraded', lastCheckedAt: '2026-09-19T21:30:00Z',
    healthDetailJson: JSON.stringify({
      status: 'degraded',
      checks: [
        { check: 'endpoint_reachable', status: 'pass', detail: 'MCP initialize/listTools 握手成功' },
        { check: 'tool_present', status: 'drift', detail: '宿主清单 1 个工具中不含 update_customer_note', advice: '宿主可能已下线/改名该工具:核对宿主,或注销注册行(v1 归入 degraded 档)' },
      ],
    }),
  }),
  tool({ id: 8, serverKey: 'demo_host', toolName: 'refresh_cache', description: '刷新宿主缓存(幂等写)', riskLevel: 'medium', resumeSafe: true, annotationsJson: '{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}' }),
  tool({ id: 9, serverKey: 'demo_host', toolName: 'export_users', description: '导出用户清单(停用示例)', riskLevel: 'medium', enabled: false }),
]

// ==================== Agent 定义(ia_agent_definition,DefinitionView 视图形) ====================

/**
 * 定义种子(镜像 AgentDefinitionSeeder 播种后的库行:agentType 取自
 * AiAgentRegistry 内置定义;kind=被 subAgentTools 引用者为 sub)。列表/详情
 * 出参含提示词三槽与规格 spec(与 bundle specJson 同构)。
 */
function definition(partial: Partial<IaAgentDefinition> & Pick<IaAgentDefinition, 'id' | 'agentType' | 'name'>): IaAgentDefinition {
  const base: Omit<IaAgentDefinition, 'id' | 'agentType' | 'name'> = {
    appId: 1,
    kind: 'main',
    enabled: true,
    prompts: { systemPrompt: null, instructionTemplate: null, greeting: null },
    spec: { kind: 'main', enabled: true, modelId: null, toolWhitelist: null, subAgentTools: null, contextTemplate: null },
    modelId: null,
  }
  const merged = { ...base, ...partial } as IaAgentDefinition
  // spec.kind/enabled 与列保持一致(镜像 specJsonOf 装配)
  merged.spec = { ...(merged.spec ?? {}), kind: merged.kind, enabled: merged.enabled }
  return merged
}

export const seedDefinitions: IaAgentDefinition[] = [
  definition({
    id: 81, agentType: 'ai_media', name: '默认助手',
    prompts: { systemPrompt: '你是 InnerAgent 默认助手,以安全可控的方式协助宿主用户完成任务。', instructionTemplate: null, greeting: '你好,我是默认助手,有什么可以帮你?' },
    spec: { kind: 'main', enabled: true, modelId: null, toolWhitelist: null, subAgentTools: null, contextTemplate: null },
  }),
  definition({
    id: 82, agentType: 'demo', name: 'InnerAgent 演示助手',
    prompts: { systemPrompt: '你是 InnerAgent 演示助手,负责演示工具调用与确认流(高危工具一律确认)。', instructionTemplate: '收到请求后先复述目标,再选择工具执行。', greeting: '演示开始:试试让我查询或更新用户资料。' },
    spec: { kind: 'main', enabled: true, modelId: null, toolWhitelist: ['get_user', 'update_user'], subAgentTools: null, contextTemplate: null },
  }),
  definition({
    id: 83, agentType: 'script_assistant', name: '剧本对话助手',
    prompts: { systemPrompt: '你是剧本对话助手,基于宿主上传的剧本回答结构与场次问题。', instructionTemplate: null, greeting: null },
    spec: { kind: 'main', enabled: true, modelId: null, toolWhitelist: null, subAgentTools: null, contextTemplate: null },
  }),
  definition({
    id: 84, agentType: 'storyboard_frame_executor', kind: 'sub', name: '分镜首尾帧生成执行器',
    prompts: { systemPrompt: '你是分镜首尾帧生成执行器(子代理),仅响应宿主委派的帧生成任务。', instructionTemplate: null, greeting: null },
    spec: { kind: 'sub', enabled: true, modelId: null, toolWhitelist: null, subAgentTools: null, contextTemplate: null },
  }),
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

// ==================== 三方 MCP 服务器(ia_mcp_server_config,镜像 McpServerRespVO) ====================

/** 种子覆盖:启用+静态头(打码)/停用(端点不可达演示)/展示名缺省行 */
export const seedMcpServers: IaMcpServer[] = [
  { id: 91, serverKey: 'crm-mcp', name: 'CRM 三方服务', endpointUrl: 'http://crm-mcp:9090/mcp', transport: 'streamable-http', authType: 'STATIC_HEADER', headerName: 'X-Api-Key', credentialsMasked: 'sk***', timeoutSeconds: 30, enabled: true, updateTime: '2026-09-18T10:00:00Z' },
  { id: 92, serverKey: 'weather', name: '天气查询(三方)', endpointUrl: 'http://weather.internal:8080/mcp/down', transport: 'streamable-http', authType: 'STATIC_HEADER', headerName: 'Authorization', credentialsMasked: 'Be***', timeoutSeconds: 60, enabled: false, updateTime: '2026-09-17T09:00:00Z' },
  { id: 93, serverKey: 'docs-search', name: null, endpointUrl: 'https://docs.example.com/mcp', transport: 'streamable-http', authType: 'STATIC_HEADER', headerName: 'X-Token', credentialsMasked: null, timeoutSeconds: 30, enabled: true, updateTime: '2026-09-19T14:00:00Z' },
]

// ==================== Skill 目录(ia_skill,镜像 AppSkillCatalogService.SkillView) ====================

/**
 * Skill 种子:应用内同时激活上限 8(PRD 缺省)——此处预置 8 个 active +
 * 1 个 inactive,激活第 9 个时 handler 报 409(镜像 AppSkillCatalogService
 * activate 的上限校验,管理站可呈现友好报错)。id 降序分页。
 */
function skill(partial: Pick<IaSkill, 'id' | 'name'> & Partial<IaSkill>): IaSkill {
  return {
    appId: 1,
    displayName: null,
    description: null,
    version: '1.0.0',
    status: 'active',
    source: 'import',
    contentSha256: `sha256:skill${String(partial.id).padStart(4, '0')}`,
    active: true,
    ...partial,
  }
}

export const seedSkills: IaSkill[] = [
  skill({ id: 111, name: 'week-report', displayName: '周报生成', description: '按模板聚合本周工作项生成周报', version: '1.2.0' }),
  skill({ id: 112, name: 'sql-analyst', displayName: 'SQL 分析', description: '自然语言转 SQL 并解读查询结果' }),
  skill({ id: 113, name: 'meeting-notes', displayName: '会议纪要', description: '会议录音转写稿提炼决议与待办' }),
  skill({ id: 114, name: 'code-reviewer', displayName: '代码评审', description: '按团队规范输出评审意见' }),
  skill({ id: 115, name: 'doc-writer', displayName: '文档撰写', description: '技术方案/接口文档骨架生成' }),
  skill({ id: 116, name: 'data-cleanup', displayName: '数据清洗', description: '表格数据去重与格式归一' }),
  skill({ id: 117, name: 'slide-maker', displayName: '幻灯片生成', description: '大纲转 PPT 结构' }),
  skill({ id: 118, name: 'i18n-checker', displayName: '文案走查', description: '多语言文案缺翻检查' }),
  skill({ id: 119, name: 'legacy-migrate', displayName: '迁移助手(停用)', description: '老系统数据迁移脚本生成', status: 'inactive', active: false }),
]

// ==================== mini 知识库(ia_kb_document,镜像 KbIngestService.KbDocumentView) ====================

export const seedKbDocuments: IaKbDocument[] = [
  { id: 121, appId: 1, title: '员工手册.md', source: 'upload', status: 'active', chunkCount: 42, active: true },
  { id: 122, appId: 1, title: '产品 FAQ(9 月版)', source: 'api', status: 'active', chunkCount: 18, active: true },
  { id: 123, appId: 1, title: '旧版退款政策(已失效)', source: 'upload', status: 'inactive', chunkCount: 7, active: false },
]

// ==================== 用量统计(ia_model_call 聚合,镜像 UsageSummaryRow) ====================

/** 聚合种子:3 天 × 2 模型 × 2 用户(DAY 粒度),覆盖 FAILED 行 token 为空形 */
export const seedUsageSummary: UsageSummaryRow[] = [
  { appId: 1, userId: 12993, statDate: '2026-09-20', provider: 'deepseek', modelCode: 'deepseek-chat', calls: 23, inputTokens: 51_200, outputTokens: 8_640, reasoningTokens: 1_020, cacheTokens: 12_800 },
  { appId: 1, userId: 20001, statDate: '2026-09-20', provider: 'deepseek', modelCode: 'deepseek-chat', calls: 11, inputTokens: 24_100, outputTokens: 3_120, reasoningTokens: 460, cacheTokens: 6_400 },
  { appId: 1, userId: 12993, statDate: '2026-09-20', provider: 'anthropic', modelCode: 'claude-sonnet', calls: 4, inputTokens: 18_000, outputTokens: 2_400, reasoningTokens: 800, cacheTokens: 0 },
  { appId: 1, userId: 30077, statDate: '2026-09-20', provider: 'dashscope', modelCode: 'qwen-plus', calls: 6, inputTokens: 12_000, outputTokens: 1_800, reasoningTokens: 0, cacheTokens: 0 },
  { appId: 1, userId: 12993, statDate: '2026-09-19', provider: 'deepseek', modelCode: 'deepseek-chat', calls: 31, inputTokens: 66_400, outputTokens: 9_800, reasoningTokens: 1_640, cacheTokens: 18_200 },
  { appId: 1, userId: 20001, statDate: '2026-09-19', provider: 'anthropic', modelCode: 'claude-sonnet', calls: 2, inputTokens: 9_600, outputTokens: 1_100, reasoningTokens: 300, cacheTokens: 0 },
  { appId: 1, userId: 30077, statDate: '2026-09-19', provider: 'dashscope', modelCode: 'qwen-plus', calls: 3, inputTokens: 5_400, outputTokens: 620, reasoningTokens: 0, cacheTokens: 0 },
  { appId: 1, userId: 12993, statDate: '2026-09-19', provider: 'deepseek', modelCode: 'deepseek-reasoner', calls: 1, inputTokens: 3_200, outputTokens: 900, reasoningTokens: 2_100, cacheTokens: 0 },
  { appId: 1, userId: 20001, statDate: '2026-09-18', provider: 'deepseek', modelCode: 'deepseek-chat', calls: 17, inputTokens: 33_500, outputTokens: 5_400, reasoningTokens: 780, cacheTokens: 9_600 },
  { appId: 1, userId: 12993, statDate: '2026-09-18', provider: 'anthropic', modelCode: 'claude-sonnet', calls: 1, inputTokens: 4_800, outputTokens: 520, reasoningTokens: 120, cacheTokens: 0 },
  { appId: 1, userId: 30077, statDate: '2026-09-18', provider: 'ollama', modelCode: 'qwen2.5:14b', calls: 5, inputTokens: 7_700, outputTokens: 1_050, reasoningTokens: 0, cacheTokens: 0 },
  // FAILED 行:仅计入调用次数,token 列为空(镜像聚合口径)
  { appId: 1, userId: 20001, statDate: '2026-09-18', provider: 'deepseek', modelCode: 'deepseek-chat', calls: 9, inputTokens: null, outputTokens: null, reasoningTokens: null, cacheTokens: null },
]

// ==================== 用户反馈(ia_agent_feedback,镜像 FeedbackRespVO) ====================

export const seedFeedbacks: IaFeedback[] = [
  { id: 141, appId: 1, userId: 12993, conversationId: 'conv-1001', runId: 'run-2001', messageId: 'msg-3001', rating: 'UP', comment: '查询结果准确,直接可用', createTime: '2026-09-20T07:50:00Z', updateTime: '2026-09-20T07:50:00Z' },
  { id: 142, appId: 1, userId: 20001, conversationId: 'conv-1002', runId: 'run-2002', messageId: null, rating: 'DOWN', comment: '改错了字段,把昵称当成了姓名', createTime: '2026-09-19T18:30:00Z', updateTime: '2026-09-19T18:30:00Z' },
  { id: 143, appId: 1, userId: 30077, conversationId: 'conv-1003', runId: 'run-2003', messageId: 'msg-3003', rating: 'UP', comment: '周报结构很清晰', createTime: '2026-09-19T16:10:00Z', updateTime: '2026-09-19T16:10:00Z' },
  { id: 144, appId: 1, userId: 12993, conversationId: 'conv-1001', runId: 'run-2001', messageId: null, rating: 'UP', comment: null, createTime: '2026-09-19T10:00:00Z', updateTime: '2026-09-20T07:49:30Z' },
  { id: 145, appId: 1, userId: 20001, conversationId: 'conv-1004', runId: 'run-2004', messageId: 'msg-3004', rating: 'DOWN', comment: '等了很久超时了,也没提示重试', createTime: '2026-09-18T14:20:00Z', updateTime: '2026-09-18T14:20:00Z' },
  { id: 146, appId: 1, userId: 30077, conversationId: 'conv-1005', runId: 'run-2005', messageId: null, rating: 'UP', comment: '能正确引用知识库条目', createTime: '2026-09-18T09:05:00Z', updateTime: '2026-09-18T09:05:00Z' },
]

// ==================== 内存存储与重置 ====================

export interface MockStore {
  apps: IaApp[]
  tools: IaToolRegistry[]
  /** schema 指纹变更历史(ia_tool_schema_history,仅追加) */
  schemaHistory: IaToolSchemaHistory[]
  grants: IaToolGrant[]
  /** Agent 定义(ia_agent_definition,P2-W5 定义管理域) */
  definitions: IaAgentDefinition[]
  auditLogs: IaAuditLog[]
  modelConfigs: IaModelApiConfig[]
  limits: ResourceLimits
  circuitEvents: CircuitBreakerEvent[]
  circuitState: { emergencyStopped: boolean; stoppedAt: string | null; stopReason: string | null; activeRuns: number }
  webhookConfig: WebhookConfig
  deliveries: WebhookDelivery[]
  /** 三方 MCP 服务器(P4-W13) */
  mcpServers: IaMcpServer[]
  /** Skill 目录(P4-W13) */
  skills: IaSkill[]
  /** mini 知识库文档(P4-W14) */
  kbDocuments: IaKbDocument[]
  /** 用量聚合行(W15) */
  usageSummary: UsageSummaryRow[]
  /** 用户反馈(W15) */
  feedbacks: IaFeedback[]
}

export const store: MockStore = {
  apps: [],
  tools: [],
  schemaHistory: [],
  grants: [],
  definitions: [],
  auditLogs: [],
  modelConfigs: [],
  limits: { ...seedLimits },
  circuitEvents: [],
  circuitState: { emergencyStopped: false, stoppedAt: null, stopReason: null, activeRuns: 1 },
  webhookConfig: { ...seedWebhookConfig },
  deliveries: [],
  mcpServers: [],
  skills: [],
  kbDocuments: [],
  usageSummary: [],
  feedbacks: [],
}

/** 深拷贝种子 → 内存存储(每条用例后调用,保证确定性) */
export function resetMockData(): void {
  store.apps = structuredClone(seedApps)
  store.tools = structuredClone(seedTools)
  store.schemaHistory = []
  store.definitions = structuredClone(seedDefinitions)
  store.grants = structuredClone(seedGrants)
  store.auditLogs = structuredClone(seedAuditLogs)
  store.modelConfigs = structuredClone(seedModelConfigs)
  store.limits = { ...seedLimits }
  store.circuitEvents = structuredClone(seedCircuitEvents)
  store.circuitState = { emergencyStopped: false, stoppedAt: null, stopReason: null, activeRuns: 1 }
  store.webhookConfig = structuredClone(seedWebhookConfig)
  store.deliveries = structuredClone(seedDeliveries)
  store.mcpServers = structuredClone(seedMcpServers)
  store.skills = structuredClone(seedSkills)
  store.kbDocuments = structuredClone(seedKbDocuments)
  store.usageSummary = structuredClone(seedUsageSummary)
  store.feedbacks = structuredClone(seedFeedbacks)
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
