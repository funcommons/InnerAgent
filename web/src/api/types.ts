/**
 * [new] InnerAgent 管理 API 契约类型(`/ia/api/v1/admin/*`)。
 *
 * 契约来源(P2 对齐,任务 #13;以服务端代码为准,禁改服务端):
 *   - com/inneragent/server/admin/AdminAppController(ia_app CRUD;公钥登记/轮换=PUT signPublicKey)
 *   - com/inneragent/server/admin/AdminToolController(ia_tool_registry 注册/活刷新分诊/启停/schema 历史)
 *   - com/inneragent/server/admin/AdminGrantController(ia_tool_grant 授予/列表/撤销)
 *   - 实体形:AppRegistration / ToolRegistryEntry / ToolGrant / ToolSchemaHistory;
 *     审计列形:ia_audit_log(ToolAuditLog);信封 CommonResult{code,msg,data},
 *     错误 HTTP 状态=业务 code(400/403/404/409…)。
 *
 * ── 「契约空缺 / 自拟字段清单」裁决沿革(随服务端落地滚动更新)────────────────
 *  1. 路径:apps/tools/grants/audit-logs/model-configs 已全部对齐真实控制器。
 *     apps/tools/grants 列表返回数组、无服务端分页(分页在管理站客户端完成);
 *     audit-logs/model-configs/webhook-deliveries 为服务端 PageResult 分页。
 *  2. ia_app 公钥轮换(V9 已落地):PUT /apps/{id} {signPublicKey} 即登记/轮换,
 *     响应回 signKeyFingerprint/signKeyRotatedAt;旧公钥进入 72h 验签宽限期
 *     (inneragent.auth.embed-key-grace,双公钥并存,见 AdminAppService/DbAppSigningKeyProvider)。
 *  3. ia_tool_registry:fqn ✓(`mcp__<serverKey>__<toolName>`);注解为原始 JSON
 *     字符串 annotationsJson;自拟的 serverName/transport/credentialMasked/
 *     healthStatus/lastSyncedAt/writeOperation → 删(真实形:credentialsEnc 加密
 *     密文、lastTestStatus、revalidateRequired/pending* 分诊列)。
 *  4. ia_tool_grant:invalid→invalidated;invalidReason→invalidatedReason
 *     (risk_upgrade/schema_breaking/tool_disabled/tool_deleted);grantedRiskLevel
 *     →riskAtGrant;schemaFingerprint→schemaSha256;grantedAt→createTime;
 *     scope∈conversation|permanent(原 'session' → 'conversation');source∈
 *     live-confirm|admin(原 'admin-grant' → 'admin');userId 为 number;
 *     授予请求按 toolName(服务端解析 FQN),非 toolFqn。
 *  5. ia_audit_log:查询端点已落地(AdminAuditController,W5):分页/过滤/字典
 *     端点字段名对齐真实列 decision/decision_source/params_masked_json/
 *     error_text/duration_ms/create_time;decision_source 值域含 V8 增补的
 *     expired(以 GET /audit-logs/dictionary 下发值域为准)。
 *  6. 熔断与资源上限:管理端点待服务端落地(跟踪:test-report/2026-09-21-02/
 *     99-优化建议.md #2),api 层按 mock 形状调用,失败时 UI 显「服务端能力未开通」。
 *  7. webhook:deliveries 已落地(WebhookDeliveryAdminController,任务 #18b,
 *     路径 /admin/webhook-deliveries + POST /{id}/redeliver);config 域配置本体
 *     在 ia_app(webhookUrl/webhookSecret 走 apps 域),/webhooks/config 端点
 *     待服务端落地(跟踪:99-优化建议.md #2)。
 *  8. id 为数据库自增 number ✓;appId 单应用部署(ADR-10)由服务端行级拦截器注入,
 *     管理站请求体不再强制携带。
 */
import type { IsoDateTime, PageQuery } from './common'

// ==================== 应用(ia_app,AdminAppController) ====================

/**
 * ia_app 响应视图(P2-key AdminAppService.AppView 契约形):
 * - webhookSecret 为 write-only,任何响应不回明文,仅回 webhookSecretMasked 掩码;
 * - signKeyFingerprint/signKeyRotatedAt 由服务端 V9 轮换语义回显
 *   (PEM → DER SHA-256 hex 前 16 位;rotatedAt 为轮换时刻,首次登记为 null)。
 */
export interface IaApp {
  id: number
  /** 应用唯一标识(embed token iss;唯一约束冲突 → 409) */
  appKey: string
  name: string
  /** embed token 验签公钥(RSA PEM,X509/PKCS#8;非法 PEM → 400) */
  signPublicKey: string | null
  /** 公钥指纹(公钥 DER 的 SHA-256 hex 前 16 位;宿主侧比对锚点,见 AdminAppService.fingerprintOf) */
  signKeyFingerprint: string | null
  /** 最近一次公钥轮换时间(同值重复 PUT 不算轮换;首次登记为 null) */
  signKeyRotatedAt: IsoDateTime | null
  /** 终态通知 Webhook 回调地址(可空) */
  webhookUrl: string | null
  /** Webhook 签名密钥掩码(明文 write-only 永不回显;仅创建时一次性可见) */
  webhookSecretMasked: string | null
  /** 会话保留天数(超期物理清理,默认 180,ADR-9;注册固定 180,不可经 API 修改) */
  conversationRetentionDays: number
  /** 0-禁用 1-启用 */
  status: number
  createTime: IsoDateTime | null
  updateTime: IsoDateTime | null
}

export interface IaAppCreateReq {
  appKey: string
  name: string
  /** 必填:注册时即须上传验签公钥(服务端 @NotBlank + RSA 解析强校验) */
  signPublicKey: string
  webhookUrl?: string
  webhookSecret?: string
}

/** 更新应用(公钥轮换/webhook/状态;全字段可选,服务端按非空生效) */
export interface IaAppUpdateReq {
  name?: string
  signPublicKey?: string
  webhookUrl?: string
  webhookSecret?: string
  status?: number
}

// ==================== 工具注册(ia_tool_registry,AdminToolController) ====================

/** MCP 注解(服务端存原始 JSON;此为解析后的展示形) */
export interface ToolAnnotations {
  readOnlyHint: boolean | null
  destructiveHint: boolean | null
  idempotentHint: boolean | null
  openWorldHint: boolean | null
}

/** 风险等级(落库小写码值;无 critical——删除/资金/凭据类强制 high 且不可下调) */
export type ToolRiskLevel = 'low' | 'medium' | 'high'

/** 管理员策略(NULL=不强制;服务端校验仅支持 force-ask/force-allow/deny) */
export type ToolAdminPolicy = 'force-ask' | 'force-allow' | 'deny'

/** 工具来源(注册仅支持 host_app/third_party;builtin 为内置保留) */
export type ToolSource = 'host_app' | 'third_party' | 'builtin'

/** 活刷新分诊结论(V14) */
export type SchemaTriageVerdict = 'unchanged' | 'compatible' | 'breaking'

export interface IaToolRegistry {
  id: number
  /** 所属应用(单应用部署固定 1,服务端行级拦截器注入) */
  appId: number
  serverKey: string
  /** 工具名(MCP tools/list 的 name;应用内唯一,冲突 → 409) */
  toolName: string
  /** 工具全限定名 mcp__<serverKey>__<toolName>(app_id+fqn 唯一) */
  fqn: string
  description: string | null
  /** 入参 JSON Schema(canonical JSON 字符串,非对象) */
  parametersSchema: string | null
  /** MCP 注解原始 JSON(readOnlyHint/destructiveHint/idempotentHint/openWorldHint) */
  annotationsJson: string | null
  /** 注解生成默认 + 人工覆盖;删除/资金/凭据类强制 high */
  riskLevel: ToolRiskLevel
  adminPolicy: ToolAdminPolicy | null
  /** 可被 continue 重执行(默认取 idempotentHint) */
  resumeSafe: boolean
  concurrencySafe: boolean
  source: ToolSource
  /** 三方 MCP 端点(host_app 经宿主桥暴露时为空) */
  endpointUrl: string | null
  /** 三方凭证(加密存储密文;明文不出服务端) */
  credentialsEnc: string | null
  /** schema SHA-256 指纹(canonical JSON;V14 分诊基准) */
  schemaSha256: string | null
  toolVersion: string | null
  /** 存在安全相关差异待重新确认(TRUE 时旧 schema 继续生效) */
  revalidateRequired: boolean
  /** BREAKING 分诊暂存的新 schema(confirm 后生效,reject 后清除) */
  pendingSchema: string | null
  pendingAnnotationsJson: string | null
  pendingSchemaSha256: string | null
  pendingRefreshAt: IsoDateTime | null
  /** 是否启用(停用级联失效授权;布尔,非 0/1) */
  enabled: boolean
  /** 最近一次工具体检/连通性测试结果 */
  lastTestStatus: string | null
  createTime: IsoDateTime | null
  updateTime: IsoDateTime | null
  deleted: boolean
}

/** 注册工具(单条注册,非端点清单拉取;FQN 重复 → 409) */
export interface ToolRegisterReq {
  serverKey: string
  toolName: string
  description?: string
  parametersSchema?: string
  annotationsJson?: string
  riskLevel?: ToolRiskLevel
  adminPolicy?: ToolAdminPolicy
  resumeSafe?: boolean
  concurrencySafe?: boolean
  /** 必填:host_app/third_party */
  source: ToolSource
  endpointUrl?: string
  toolVersion?: string
  enabled?: boolean
}

/** 更新治理元数据(风险上调级联失效授权;强制高危不可下调 → 400) */
export interface ToolUpdateReq {
  description?: string
  riskLevel?: ToolRiskLevel
  /** null/空串 = 清除强制策略(服务端落 NULL) */
  adminPolicy?: ToolAdminPolicy | null
  resumeSafe?: boolean
  concurrencySafe?: boolean
  toolVersion?: string
}

/** 活刷新分诊请求(宿主重发 schema/注解) */
export interface ToolRefreshSchemaReq {
  parametersSchema?: string
  annotationsJson?: string
  toolVersion?: string
}

/** 活刷新分诊响应(V14:unchanged 静默/compatible 自动生效/breaking 转待确认) */
export interface ToolTriageResp {
  toolId: number
  fqn: string
  verdict: SchemaTriageVerdict
  reasons: string[]
  revalidateRequired: boolean
  effectiveSchemaSha256: string | null
  pendingSchemaSha256: string | null
}

/** schema 指纹变更历史(ia_tool_schema_history,仅追加留痕) */
export interface IaToolSchemaHistory {
  id: number
  appId: number
  toolId: number
  fqn: string
  /** 变更前指纹(首次注册为 NULL) */
  previousSha256: string | null
  newSha256: string | null
  triage: SchemaTriageVerdict
  /** 处理结果:silent_refresh/applied/pending_review/rejected */
  outcome: 'silent_refresh' | 'applied' | 'pending_review' | 'rejected'
  actor: string | null
  /** 差异明细(分诊理由列表 JSON) */
  detail: string | null
  createTime: IsoDateTime | null
}

/** 工具列表过滤(服务端仅此两项;其余过滤由管理站客户端完成) */
export interface ToolListQuery {
  serverKey?: string
  enabled?: boolean
}

// ==================== 工具授权(ia_tool_grant,AdminGrantController) ====================

/** 授权作用域(真实码值:conversation-本会话 permanent-永久) */
export type GrantScope = 'conversation' | 'permanent'

/** 授权来源:live-confirm(确认流)/admin(管理站代授) */
export type GrantSource = 'live-confirm' | 'admin'

/** 自动失效原因(risk_upgrade/schema_breaking/tool_disabled/tool_deleted) */
export type GrantInvalidatedReason = 'risk_upgrade' | 'schema_breaking' | 'tool_disabled' | 'tool_deleted'

export interface IaToolGrant {
  id: number
  appId: number
  /** 被授权用户 ID(number,宿主侧数字标识) */
  userId: number
  /** 工具全限定名(ia_tool_registry.fqn) */
  toolFqn: string
  scope: GrantScope
  /** scope=conversation 时必填;permanent 时为 NULL */
  conversationId: string | null
  /** 授予时风险等级快照(升级即失效) */
  riskAtGrant: ToolRiskLevel
  /** 授予时 schema 指纹快照(breaking 变更即失效) */
  schemaSha256: string | null
  source: GrantSource
  /** 自动失效(区别于 deleted 主动撤销) */
  invalidated: boolean
  invalidatedReason: GrantInvalidatedReason | null
  /** 授予决策记录 */
  decisionNote: string | null
  tenantId: number | null
  /** 授予时间(BaseEntity createTime,无独立 grantedAt 列) */
  createTime: IsoDateTime | null
  updateTime: IsoDateTime | null
  deleted: boolean
}

/** 授予授权(appId+toolName+scope+决策记录;重复同作用域有效授权 → 409) */
export interface ToolGrantCreateReq {
  userId: number
  /** 工具名(服务端解析 FQN),非 toolFqn */
  toolName: string
  scope: GrantScope
  /** scope=conversation 必填;permanent 携带 → 400 */
  conversationId?: string
  decisionNote?: string
}

/** 撤销授权请求体(可省略) */
export interface ToolGrantRevokeReq {
  decisionNote?: string
}

/** 授权列表过滤(activeOnly 默认 true:仅未撤销未失效) */
export interface ToolGrantListQuery {
  userId?: number
  toolName?: string
  scope?: GrantScope
  activeOnly?: boolean
}

// ==================== 审计(ia_audit_log;查询端点服务端未实现,域保持 mock) ====================

/** 决策来源(V22 真实码值;「高危 100% 确认」的日志证明锚点) */
export type DecisionSource = 'mode-default' | 'user-grant' | 'forced-policy' | 'live-confirm' | 'full-access'

/**
 * 裁决结果(ia_audit_log.decision 真实码值):
 * 工具调用 allowed/denied;授权生命周期 granted/revoked/invalidated;
 * 级联事件 risk_upgraded/tool_disabled/schema_compatible/schema_breaking。
 */
export type AuditDecision =
  | 'allowed'
  | 'denied'
  | 'granted'
  | 'revoked'
  | 'invalidated'
  | 'risk_upgraded'
  | 'tool_disabled'
  | 'schema_compatible'
  | 'schema_breaking'

/** 审计行(列形对齐 ia_audit_log/ToolAuditLog) */
export interface IaAuditLog {
  id: number
  appId: number
  /** 租户 ID(无租户上下文落 DDL 默认 0) */
  tenantId: number
  userId: number | null
  /** 会话 UUID(可空:授权生命周期行) */
  conversationId: string | null
  runId: string | null
  toolFqn: string | null
  decision: AuditDecision
  decisionSource: DecisionSource
  riskLevel: ToolRiskLevel | null
  /** 工具入参(敏感字段脱敏后 JSON) */
  paramsMaskedJson: string | null
  /** 执行结果摘要 */
  resultSummary: string | null
  /** 失败错误信息 */
  errorText: string | null
  /** 工具执行耗时(毫秒) */
  durationMs: number | null
  createTime: IsoDateTime | null
}

/** 审计过滤(对齐 AdminAuditController 查询参数;from/to 为 ISO 本地日期时间,无时区后缀) */
export interface AuditLogQuery extends PageQuery {
  appId?: number
  userId?: number
  decisionSource?: DecisionSource
  decision?: AuditDecision
  toolFqn?: string
  /** ISO-8601 起止(含) */
  from?: IsoDateTime
  to?: IsoDateTime
}

// ==================== 模型配置(ia_model_api_config,方案 §4.4) ====================
// 已落地(AdminModelConfigController):GET/POST /admin/model-configs、
// PUT/DELETE /{id}、POST /{id}/test;apiKey/appSecret/proxyPassword write-only 掩码。

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
// 管理端点待服务端落地(跟踪:test-report/2026-09-21-02/99-优化建议.md #2);
// api 层按下方形状调用真端点,联调 404 时 UI 显「服务端能力未开通」占位。

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

/** 熔断事件(紧急停用/单运行终止/上限触发,展示用;端点待服务端落地,见上) */
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
// deliveries 已落地(WebhookDeliveryAdminController,任务 #18b):分页形见下,
// 时间字段为 epoch 毫秒(api 层归一为 ISO);config 端点待服务端落地
// (跟踪:99-优化建议.md #2),配置本体在 ia_app(webhookUrl/webhookSecret,apps 域)。

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

/** 投递记录(签名验证与 5 次指数退避重试的可观测面;任务 #18b 真实契约形) */
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
