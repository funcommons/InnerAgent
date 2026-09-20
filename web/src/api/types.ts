/**
 * [new] InnerAgent 管理 API 契约类型(`/ia/api/v1/admin/*`)。
 *
 * 依据:《02-技术方案》§5.1 ia_ 表清单、§7.1 API 清单、§4.7 资源上限默认值;
 * PRD §6.2.1 工具策略字段、§6.2.4 授权存储、§6.9 审计 decision_source。
 *
 * ── 契约空缺 / 自拟字段清单(留给 P2 正式任务对齐)──────────────────────────
 * 技术方案仅给出 `/ia/api/v1/admin/*` 资源域名(定义/工具/模型/审计/熔断/webhook),
 * 未给出具体路径与字段。以下为本脚手架自拟,后端落地时逐条核对:
 *  1. 路径自拟:资源名复数(admin/apps|tools|tool-grants|audit-logs|model-configs|
 *     circuit-breaker|webhooks),分页 query 为 pageNo/pageSize(融光形)。
 *  2. ia_app.signKeyUpdatedAt/signKeyFingerprint:公钥登记/轮换 UI 需要,自拟。
 *  3. ia_tool_registry.fqn 格式 `mcp__<serverKey>__<tool>`(方案 §4.3 已定,字段名自拟);
 *     annotations 为 MCP hints 缓存(方案已定),healthStatus/lastSyncedAt 为工具体检 UI 所需,自拟。
 *  4. ia_tool_grant.invalidReason('risk-upgraded'|'schema-changed'|'tool-disabled'):
 *     授权自动失效展示所需,自拟(方案 S10 只定行为未定字段)。
 *  5. ia_audit_log.resultStatus('success'|'failed'|'denied'|'timeout')与
 *     confirmedBy/latencyMs/sensitiveMasked:PRD §6.8 审计列表展示所需,自拟。
 *  6. 熔断域拆为 resource-limits(§4.7 七参数)+ circuit-breaker(总开关/单运行终止/事件流),
 *     方案 §4.7 只定参数与行为,API 形态自拟。
 *  7. webhook:config(url/secret/events/enabled,挂 ia_app)+ deliveries 投递记录,
 *     方案 §7.1 webhook HMAC + 5 次退避、Q5 双密钥 72h 未建模,自拟 deliveries 便于 P2 对齐。
 *  8. 所有 id 用 number 自增(融光形);appId 单应用部署(ADR-10)仍强制携带。
 */
import type { IsoDateTime, PageQuery } from './common'

// ==================== 应用(ia_app,方案 §5.1) ====================

export interface IaApp {
  id: number
  /** 应用唯一键(embed token aud/iss 关联) */
  appKey: string
  name: string
  /** 1=启用 0=停用 */
  status: number
  /** embed token 签发验签公钥(RSA PEM,《02-技术方案》§6.1) */
  signPublicKey: string | null
  /** 公钥指纹(sha256,自拟,供列表展示与轮换比对) */
  signKeyFingerprint: string | null
  signKeyUpdatedAt: IsoDateTime | null
  /** 会话/消息/运行保留天数(ADR-9:默认 180,应用级可配) */
  retentionDays: number
  /** 应用级 Agent 总开关(紧急停用,§4.7) */
  emergencyStopped: boolean
  emergencyStopReason: string | null
  /** 终态 webhook 配置(方案 §5.1 ia_app 含 webhook 配置) */
  webhookUrl: string | null
  /** HMAC 签名密钥(仅回显掩码) */
  webhookSecretMasked: string | null
  webhookEnabled: boolean
  remark: string | null
  createTime: IsoDateTime
  updateTime: IsoDateTime
}

export interface IaAppCreateReq {
  appKey: string
  name: string
  retentionDays?: number
  remark?: string
}

export interface IaAppUpdateReq {
  name?: string
  status?: number
  retentionDays?: number
  webhookUrl?: string
  webhookSecret?: string
  webhookEnabled?: boolean
  remark?: string
}

/** RSA 公钥登记/轮换请求 */
export interface IaAppPublicKeyReq {
  publicKey: string
}

/** 公钥登记/轮换响应 */
export interface IaAppPublicKeyResp {
  fingerprint: string
  updatedAt: IsoDateTime
}

export interface IaAppPageReq extends PageQuery {
  keyword?: string
  status?: number
}

// ==================== 工具注册(ia_tool_registry,方案 §4.3/§5.1) ====================

/** MCP 工具注解缓存(仅可信宿主采信,作策略软输入) */
export interface ToolAnnotations {
  readOnlyHint: boolean | null
  destructiveHint: boolean | null
  idempotentHint: boolean | null
  openWorldHint: boolean | null
}

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** 管理员策略(优先级高于用户授权,PRD §6.2.1) */
export type ToolAdminPolicy = 'default' | 'force-ask' | 'force-allow' | 'deny'

export type ToolHealthStatus = 'healthy' | 'unhealthy' | 'unknown'

export interface IaToolRegistry {
  id: number
  appId: number
  /** 服务器键(FQN 前缀,避用下划线,方案 §4.3) */
  serverKey: string
  serverName: string
  endpoint: string
  transport: 'streamable_http' | 'sse'
  /** 凭据仅回显掩码 */
  credentialMasked: string
  /** 原始工具名(宿主 MCP 侧) */
  toolName: string
  /** 模型可见名 `mcp__<serverKey>__<tool>` */
  fqn: string
  description: string
  inputSchema: Record<string, unknown>
  /** schema 指纹(sha256,内核快照锁定与活刷新分诊依据) */
  schemaFingerprint: string
  annotations: ToolAnnotations
  /** 注解生成默认 + 人工覆盖 */
  riskLevel: ToolRiskLevel
  /** true = 写操作(需确认流) */
  writeOperation: boolean
  adminPolicy: ToolAdminPolicy
  /** 可被 continue 重执行(默认取 idempotentHint) */
  resumeSafe: boolean
  healthStatus: ToolHealthStatus
  healthMessage: string | null
  lastSyncedAt: IsoDateTime | null
  /** 1=启用 0=停用(停用级联清除授权,PRD §6.2.1) */
  status: number
  createTime: IsoDateTime
  updateTime: IsoDateTime
}

/** 注册请求:管理站录入 MCP 端点后由服务端 list_tools 拉取清单 */
export interface ToolRegisterReq {
  serverKey: string
  serverName: string
  endpoint: string
  transport: IaToolRegistry['transport']
  credential?: string
}

/** 注册响应:拉取到的工具清单(模拟一次 list_tools 快照) */
export interface ToolRegisterResp {
  registered: number
  tools: IaToolRegistry[]
}

/** 活刷新分诊响应(方案 §4.3:纯增量自动接受,安全差异强制重确认) */
export interface ToolRefreshResp {
  fqn: string
  schemaFingerprint: string
  diffKind: 'none' | 'additive' | 'security-related'
  /** additive 自动接受;security-related 需重新确认后生效 */
  applied: boolean
  message: string
}

export interface ToolPolicyUpdateReq {
  riskLevel?: ToolRiskLevel
  adminPolicy?: ToolAdminPolicy
  resumeSafe?: boolean
}

export interface ToolPageReq extends PageQuery {
  keyword?: string
  riskLevel?: ToolRiskLevel
  status?: number
  serverKey?: string
}

// ==================== 工具授权(ia_tool_grant,PRD §6.2.4) ====================

export type GrantScope = 'session' | 'permanent'

export type GrantSource = 'user-grant' | 'admin-grant'

/** 自动失效原因(自拟展示字段,行为依据方案 S10) */
export type GrantInvalidReason = 'risk-upgraded' | 'schema-changed' | 'tool-disabled'

export interface IaToolGrant {
  id: number
  appId: number
  userId: string
  toolFqn: string
  scope: GrantScope
  /** session 作用域锚定的会话(随会话结束失效) */
  conversationId: string | null
  /** 授予时风险等级(升级即失效) */
  grantedRiskLevel: ToolRiskLevel
  /** 授予时 schema 指纹(安全相关变更即失效) */
  schemaFingerprint: string
  source: GrantSource
  invalid: boolean
  invalidReason: GrantInvalidReason | null
  grantedAt: IsoDateTime
}

export interface ToolGrantCreateReq {
  userId: string
  toolFqn: string
  scope: GrantScope
  conversationId?: string
}

export interface ToolGrantPageReq extends PageQuery {
  toolFqn?: string
  userId?: string
  scope?: GrantScope
  includeInvalid?: boolean
}

// ==================== 审计(ia_audit_log,PRD §6.9/§6.8) ====================

/** 决策来源:「高危 100% 确认」的日志证明锚点(PRD §6.9) */
export type DecisionSource = 'mode-default' | 'user-grant' | 'forced-policy' | 'live-confirm' | 'full-access'

export type AuditResultStatus = 'success' | 'failed' | 'denied' | 'timeout'

export interface IaAuditLog {
  id: number
  appId: number
  appKey: string
  userId: string
  tenantId: string | null
  conversationId: string
  runId: string
  toolFqn: string
  /** 工具参数(敏感字段已脱敏:password/token/secret/key 存掩码或哈希) */
  paramsMasked: string
  resultStatus: AuditResultStatus
  errorMessage: string | null
  riskLevel: ToolRiskLevel
  decisionSource: DecisionSource
  /** 拒绝/确认人(resultStatus=denied 时为拒绝者) */
  confirmedBy: string | null
  latencyMs: number
  occurredAt: IsoDateTime
}

export interface AuditLogPageReq extends PageQuery {
  appKey?: string
  userId?: string
  decisionSource?: DecisionSource
  toolFqn?: string
  resultStatus?: AuditResultStatus
  /** ISO-8601 起止(含) */
  from?: IsoDateTime
  to?: IsoDateTime
}

// ==================== 模型配置(ia_model_api_config,方案 §4.4) ====================

/** 文本协议五类(与参考实现对齐,PRD §6.3);图像/视频列已剥离 */
export type ModelPlatform = 'openai_compatible' | 'anthropic' | 'gemini' | 'dashscope' | 'ollama'

export interface IaModelApiConfig {
  id: number
  name: string
  platform: ModelPlatform
  apiUrl: string | null
  autoAppendV1Path: boolean
  proxyType: string | null
  proxyHost: string | null
  proxyPort: number | null
  proxyUsername: string | null
  /** 密钥仅回显掩码;写入走 apiKey(只写) */
  apiKeyMasked: string
  status: number
  remark: string | null
  createTime: IsoDateTime
  updateTime: IsoDateTime
}

export interface ModelApiConfigSaveReq {
  id?: number
  name: string
  platform: ModelPlatform
  apiUrl?: string
  autoAppendV1Path?: boolean
  proxyType?: string
  proxyHost?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
  /** 只写:为空/缺省表示不修改密钥 */
  apiKey?: string
  status?: number
  remark?: string
}

export interface ModelApiConfigPageReq extends PageQuery {
  name?: string
  platform?: ModelPlatform
  status?: number
}

/** 连通性测试结果 */
export interface ModelConnectivityResult {
  configId: number
  ok: boolean
  responseText: string
  durationMs: number
  testedAt: IsoDateTime
}

// ==================== 熔断与资源上限(方案 §4.7) ====================

/** 单运行/宿主 MCP 资源上限(§4.7 全套默认值) */
export interface ResourceLimits {
  /** 单运行最大工具调用次数 */
  maxToolCallsPerRun: number
  /** 单运行最大 token(输入+输出累计) */
  maxTokensPerRun: number
  /** 单运行最长时长(分钟) */
  maxRunDurationMinutes: number
  /** 工具失败重试上限(仅幂等只读) */
  toolRetryLimit: number
  /** 单宿主 MCP 并发上限 */
  mcpConcurrency: number
  /** 单宿主 MCP QPS 上限 */
  mcpQps: number
  /** 确认等待超时(小时,PRD 默认 24h) */
  confirmTimeoutHours: number
}

/** 熔断事件(紧急停用/单运行终止/上限触发,展示用,自拟) */
export interface CircuitBreakerEvent {
  id: number
  type: 'limit-triggered' | 'emergency-stop' | 'resume' | 'run-terminated'
  runId: string | null
  reason: string
  operator: string
  occurredAt: IsoDateTime
}

export interface CircuitBreakerState {
  emergencyStopped: boolean
  stoppedAt: IsoDateTime | null
  stopReason: string | null
  limits: ResourceLimits
  recentEvents: CircuitBreakerEvent[]
}

export interface CircuitBreakerUpdateReq {
  limits?: Partial<ResourceLimits>
}

/** 紧急停用(应用级总开关,生效延迟 ≤5s 经 Redis 取消通道) */
export interface EmergencyStopReq {
  reason: string
}

/** 单运行终止 */
export interface TerminateRunReq {
  runId: string
  reason: string
}

// ==================== Webhook(终态通知,方案 §7.1/Q5) ====================

export interface WebhookConfig {
  appId: number
  url: string
  /** HMAC 签名密钥(仅回显掩码) */
  secretMasked: string
  enabled: boolean
  /** 订阅事件(run 终态全集,方案 §7.1) */
  events: WebhookEvent[]
}

export type WebhookEvent = 'run.finished' | 'run.failed' | 'run.cancelled' | 'run.resource-limit'

export interface WebhookConfigSaveReq {
  url: string
  /** 只写:为空表示不修改 */
  secret?: string
  enabled?: boolean
  events?: WebhookEvent[]
}

/** 投递记录(签名验证与 5 次指数退避重试的可观测面,自拟) */
export interface WebhookDelivery {
  id: number
  event: WebhookEvent
  runId: string
  url: string
  /** 本次投递是否成功 */
  success: boolean
  attempt: number
  /** 最大 5 次(方案 §7.1) */
  maxAttempts: number
  httpStatus: number | null
  responseSummary: string | null
  nextRetryAt: IsoDateTime | null
  deliveredAt: IsoDateTime
}

export interface WebhookDeliveryPageReq extends PageQuery {
  event?: WebhookEvent
  success?: boolean
}
