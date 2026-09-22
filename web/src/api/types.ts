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
 *  1. 路径:apps/tools/grants/audit-logs/model-configs/definitions 已全部对齐真实控制器。
 *     P2-W5 起 tools/grants 列表为「兼容模式」:请求不带 pageNo/pageSize → 数组
 *     全量(旧形不破);任一出现 → PageResult(list/total/pageNo/pageSize,单页
 *     上限 100)。管理站主动走分页形(page 方法);audit-logs/model-configs/
 *     webhook-deliveries/definitions 为服务端 PageResult 分页(definitions 缺省
 *     即分页形,无数组兼容档)。
 *  1b. Agent 定义管理域(AdminAgentDefinitionController,P2-W5):GET 分页列表/
 *     GET {id} 详情/PUT {id}/prompt(单槽编辑,旧值快照落审计 definition-updated
 *     ·admin)/POST export(bundle schemaVersion=1,形状为 P3/W7 融光定义导出
 *     预留)/POST import(conflictPolicy=skip|overwrite,dryRun 预演零副作用,
 *     结果 {created,updated,skipped,errors[]})。提示词槽位值域仅三槽
 *     (systemPrompt/instructionTemplate/greeting);W7 融光 defaultUserMessage
 *     等扩展槽位随 schemaVersion 升版引入(当前未知槽位=条目级错误)。
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
 *  9. P4 批次(2026-09-21 web 接线)五域全部对齐真实控制器(以代码为准):
 *     - 三方 MCP 服务器:AdminMcpServerController(/admin/mcp-servers,应用级
 *       CRUD+启停;credentials 响应永为打码形 credentialsMasked;OAUTH 配置即
 *       501;credentials 空值语义 K③(2026-09-21 P4-gap 收口):注册必填,
 *       更新 null/空串=保持原值、显式非空=覆盖);
 *     - Skill 目录:AdminSkillController(/admin/skills,zip 预览 dryRun/确认
 *       入库/激活上限 8 超限 409/逻辑删除);
 *     - mini 知识库:AdminKbController(/admin/kb/documents,文本导入/状态门控/
 *       rebuild-index/检索调试 search);
 *     - 用量统计:AdminUsageController(/admin/usage/summary 分页聚合 +
 *       /usage/north-star 北极星);
 *     - 用户反馈:AdminFeedbackController(/admin/feedbacks,rating=UP|DOWN)。
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

/** 工具体检结论(V17 三态;NULL=未体检。落库码值 ia_tool_registry.health_status) */
export type ToolHealthStatus = 'ok' | 'degraded' | 'unreachable'

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
  /** 工具体检结论(V17):ok=健康/degraded=漂移/unreachable=不可达;null=未体检 */
  healthStatus: ToolHealthStatus | null
  /** 最近一次体检时间(体检落库时写入) */
  lastCheckedAt: IsoDateTime | null
  /** 体检明细 JSON:{"status","checks":[{check,status,detail?,advice?}]}(解析见 stores/tools parseHealthDetail) */
  healthDetailJson: string | null
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

/** 工具列表过滤+分页位(服务端仅 serverKey/enabled 两项;keyword/风险级为管理站
 *  客户端过滤。pageNo/pageSize 任一下发即 PageResult 兼容分页形,均缺省=数组) */
export interface ToolListQuery extends PageQuery {
  serverKey?: string
  enabled?: boolean
}

/** 单项体检结论(ToolHealthService.CheckItem;status=pass 通过/drift 漂移) */
export interface ToolHealthCheckItem {
  /** 检查项:endpoint_reachable/tool_present/schema_fingerprint/annotations_diff */
  check: string
  status: 'pass' | 'drift'
  detail?: string | null
  /** 整改建议(仅漂移项携带) */
  advice?: string | null
}

/** 单工具体检结果(同步响应=落库明细同源;镜像 ToolHealthService.ToolCheckResult) */
export interface ToolCheckResult {
  toolId: number
  fqn: string
  toolName: string
  status: ToolHealthStatus
  checks: ToolHealthCheckItem[]
  detailJson: string | null
}

/** 批量体检受理回执(异步单线程逐个执行;结果落各自注册行,GET /admin/tools/{id} 可查) */
export interface ToolCheckBatchReceipt {
  accepted: boolean
  total: number
  /** ids 指定模式下不存在的工具 id(全量模式为空数组) */
  skipped: number[]
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

/** 授权列表过滤+分页位(activeOnly 默认 true:仅未撤销未失效,P2-W5 起已下推
 *  SQL。pageNo/pageSize 任一下发即 PageResult 兼容分页形,均缺省=数组) */
export interface ToolGrantListQuery extends PageQuery {
  userId?: number
  toolName?: string
  scope?: GrantScope
  activeOnly?: boolean
}

// ==================== Agent 定义(ia_agent_definition,AdminAgentDefinitionController) ====================
// 定义管理域(P2-W5):数据落 ia_agent_definition,运行内核仍读代码注册表。
// 编辑留痕:提示词编辑旧值快照进审计入参(params_masked_json,decision=
// definition-updated,source=admin,ia_audit_log 仅追加)。

/** 提示词槽位(ia_agent_definition 提示词三列;W7 融光 defaultUserMessage 等
 *  扩展槽位随 bundle schemaVersion 升版引入,当前未知槽位=导入条目级错误) */
export type DefinitionPromptSlot = 'systemPrompt' | 'instructionTemplate' | 'greeting'

/** 提示词单槽长度上限(镜像 AgentDefinitionAdminService.MAX_PROMPT_LENGTH) */
export const DEFINITION_MAX_PROMPT_LENGTH = 65_536

/** 定义视图(GET 列表/详情出参;spec 与 bundle specJson 同构,未知字段原样保留) */
export interface IaAgentDefinition {
  id: number
  appId: number
  /** 业务标识(ia_agent_definition.agent_key;导入定位键=(appId, agentType),跨环境 ID 不稳定) */
  agentType: string
  /** kind 值域(V1 DDL CHECK):main=主定义 sub=子代理(被 subAgentTools 引用者) */
  kind: 'main' | 'sub'
  /** 显示名(title) */
  name: string
  enabled: boolean
  /** 提示词三槽(列语义原样:可空;systemPrompt 不可清空) */
  prompts: {
    systemPrompt: string | null
    instructionTemplate: string | null
    greeting: string | null
  }
  /** 规格对象 {kind,enabled,modelId,toolWhitelist,subAgentTools,contextTemplate} */
  spec: Record<string, unknown> | null
  modelId: number | null
}

/** 导入导出 bundle 顶层({schemaVersion:1, exportedAt, definitions[]};P3/W7 融光定义导出预留形) */
export interface DefinitionBundle {
  schemaVersion: number
  exportedAt: string
  definitions: DefinitionBundleEntry[]
}

/** bundle 定义条目(definitionId 仅回显/对账;导入定位一律 (appId, agentType)) */
export interface DefinitionBundleEntry {
  definitionId: number | null
  agentType: string
  name: string
  specJson: Record<string, unknown> | null
  prompts: Array<{ slot: DefinitionPromptSlot; content: string | null }>
}

/** 导入冲突策略:skip=遇冲突保留现库 | overwrite=按 bundle 覆盖(未出现的列不动) */
export type DefinitionConflictPolicy = 'skip' | 'overwrite'

/**
 * 导入结果(镜像 AgentDefinitionBundle.ImportResult):created+updated+skipped
 * 只含有效条目,校验失败条目只进 errors[](不占 skipped);dryRun=true 时
 * 零副作用,计数为「将要发生」的预演值。
 */
export interface DefinitionImportResult {
  dryRun: boolean
  created: number
  updated: number
  skipped: number
  errors: Array<{ agentType: string | null; reason: string }>
}

/** PUT /{id}/prompt 请求体(systemPrompt 必须非空白;其余槽位空白=清空) */
export interface DefinitionUpdatePromptReq {
  slot: DefinitionPromptSlot
  content: string
}

/** POST /export 请求体(ids 缺省=该应用全量;未知 id 静默忽略) */
export interface DefinitionExportReq {
  ids?: number[]
}

/** POST /import 请求体(bundle 内嵌 JSON 对象;conflictPolicy 缺省 skip) */
export interface DefinitionImportReq {
  bundle: unknown
  conflictPolicy: DefinitionConflictPolicy
  dryRun?: boolean
}

/** 定义列表查询(端点缺省即分页形,缺省 1/10;无数组兼容档) */
export interface DefinitionListQuery extends PageQuery {}

// ==================== 审计(ia_audit_log;镜像 AdminAuditController,W5) ====================

/** 决策来源(V22 真实码值 + V8 增补 expired + P2-W5 增补 admin;「高危 100%
 *  确认」的日志证明锚点。下拉值域以 GET /audit-logs/dictionary 字典端点为准
 *  (#12),常量仅作兜底) */
export type DecisionSource =
  | 'mode-default'
  | 'user-grant'
  | 'forced-policy'
  | 'live-confirm'
  | 'expired'
  | 'full-access'
  | 'admin'

/** 审计字典项(AdminAuditController.DictionaryVO/ToolAuditQueryService.DictionaryEntry) */
export interface AuditDictionaryEntry {
  code: string
  description: string
}

/** 审计字典(decision_source/decision 实际值域 + 中文说明) */
export interface AuditDictionary {
  decisionSources: AuditDictionaryEntry[]
  decisions: AuditDictionaryEntry[]
}

/**
 * 裁决结果(ia_audit_log.decision 真实码值):
 * 工具调用 allowed/denied;授权生命周期 granted/revoked/invalidated;
 * 级联事件 risk_upgraded/tool_disabled/schema_compatible/schema_breaking;
 * 运行治理 run-terminated(terminate-run,T2a);P2-safety 内容安全
 * blocked/redacted(ContentSafetyGate ingress/egress);P2-W5 定义管理
 * definition-updated/definition-imported。
 * 注:字典端点当前仅枚举到 definition-imported;run-terminated/blocked/
 * redacted 为真实落库码值(以代码为准),下拉兜底常量补齐。
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
  | 'run-terminated'
  | 'blocked'
  | 'redacted'
  | 'definition-updated'
  | 'definition-imported'

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
  /** 文本模型请求协议(留空=跟随平台;显式值如 openai_compatible/mock,服务端归一小写下划线) */
  textProtocol: string | null
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
  /** 只在显式选择时下发;缺省=跟随平台(服务端 normalizeProtocol 空值 → NULL) */
  textProtocol?: string
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

// ==================== 熔断与资源上限(已落地 AdminCircuitBreakerController) ====================
// 契约对齐注记(2026-09-21 服务端批):紧急停用仅翻转总开关+记事件,不批量取消
// 进行中 run(需逐个 terminate-run);limits 本版仅落库+管理面读写,内核并发/QPS
// 强制执行后续接入(UI 文案不得宣称「已强制生效」)。

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

/** 熔断事件(紧急停用/单运行终止/上限触发;镜像 CircuitBreakerAdminService.CircuitEventView) */
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
  /** 活跃运行数(紧急停用不批量取消,引导管理员按此逐个 terminate-run) */
  activeRuns: number
  recentEvents: CircuitBreakerEvent[]
}

export interface CircuitBreakerUpdateReq {
  limits?: Partial<ResourceLimits>
}

/**
 * 紧急停用(应用级 Agent 总开关;契约对齐注记 2026-09-21 服务端批:仅翻转
 * 开关+记事件立即生效,无 Redis 取消通道/不批量取消进行中 run,存量 run 由
 * 管理员逐个 terminate-run。旧「≤5s 经 Redis 取消通道」表述为契约漂移残留,
 * 已按 test-report/2026-09-21-04 00-R3验证报告 #3 修正)
 */
export interface EmergencyStopReq {
  reason: string
}

/** 单运行终止 */
export interface TerminateRunReq {
  runId: string
  reason: string
}

// ==================== Webhook(终态通知,方案 §7.1/Q5) ====================
// 已落地(WebhookDeliveryAdminController + AdminWebhookConfigController):
// deliveries 分页形见下(时间字段为 epoch 毫秒,api 层归一为 ISO;status 过滤);
// 配置本体在 ia_app(webhookUrl/webhookSecret,apps 域)。
// 订阅注记:run.resource-limit 可登记订阅,但服务端终态事件仅
// finished/failed/cancelled,单独订阅不会产生投递(UI 置灰提示)。

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

/**
 * 投递记录(签名验证与 5 次指数退避重试的可观测面;任务 #18b 真实契约形)。
 * 线上时间字段为 epoch 毫秒(api 层归一为 ISO);status 为投递状态机
 * PENDING/FAILED/SUCCESS/EXHAUSTED(EXHAUSTED 仅可手动 redeliver 复活)。
 */
export interface WebhookDelivery {
  id: number
  /** 所属应用(多行同值,单应用部署固定) */
  appId?: number
  event: WebhookEvent
  runId: string
  url: string
  /** 最近一次尝试是否成功(2xx) */
  success: boolean
  /** 投递状态机(PENDING 待投递/FAILED 退避中/SUCCESS 成功/EXHAUSTED 重试耗尽) */
  status?: 'PENDING' | 'FAILED' | 'SUCCESS' | 'EXHAUSTED'
  attempt: number
  /** 最大 5 次(方案 §7.1) */
  maxAttempts: number
  httpStatus: number | null
  responseSummary: string | null
  nextRetryAt: IsoDateTime | null
  /** 首次投递成功时间(PENDING/FAILED 行为 null) */
  deliveredAt: IsoDateTime | null
}

export interface WebhookDeliveryPageReq extends PageQuery {
  event?: WebhookEvent
  /** 投递状态过滤(契约偏差 #7:success 布尔过滤已由 status 取代) */
  status?: WebhookDelivery['status']
}

/** 连通性测试结果(真实外呼;未配置 url → 400,响应含 httpStatus/error 扩展) */
export interface WebhookConfigTestResult {
  ok: boolean
  signatureValid: boolean
  /** 宿主响应 HTTP 状态码(传输异常为 null) */
  httpStatus: number | null
  /** 失败原因摘要(ok=true 时为 null) */
  error: string | null
}

// ==================== 三方 MCP 服务器(ia_mcp_server_config,AdminMcpServerController,P4-W13) ====================
// 应用级三方 MCP 注册面(与用户级 /ia/api/v1/mcp-servers 同形、域隔离);
// serverKey 为 FQN 命名空间(字母/数字/连字符,避用下划线,与 ia_tool_registry
// FQN mcp__<serverKey>__<tool> 同口径);注册/更新/启停/删除即失效工具清单
// LRU 缓存与目录快照;credentials 响应永为打码形(前 2 字符 + ***),明文不回显。

/** 传输方式(当前仅 streamable-http,服务端 McpThirdPartyServerSupport.TRANSPORT) */
export type McpTransport = 'streamable-http'

/** 鉴权策略:STATIC_HEADER(静态头)/OAUTH(服务端 501 暂未支持,UI 置灰) */
export type McpAuthType = 'STATIC_HEADER' | 'OAUTH'

/** 三方 MCP 服务器响应视图(镜像 McpServerRespVO;credentialsMasked 打码形) */
export interface IaMcpServer {
  id: number
  /** 服务器键(FQN 命名空间,[A-Za-z0-9-]{1,64}) */
  serverKey: string
  /** 展示名 */
  name: string | null
  /** Streamable HTTP 端点 URL */
  endpointUrl: string
  transport: McpTransport
  authType: McpAuthType
  /** 静态头名(STATIC_HEADER 必填) */
  headerName: string | null
  /** 静态头值打码形(前 2 字符 + ***;明文永不回显) */
  credentialsMasked: string | null
  /** tools/call 超时(秒,1-600,缺省 30) */
  timeoutSeconds: number
  enabled: boolean
  updateTime: IsoDateTime | null
}

/** 三方 MCP 注册/更新请求体(镜像 McpServerSaveReqVO;字段校验在服务层:
 * serverKey 字符集、transport=streamable-http、STATIC_HEADER 头名必填、
 * OAUTH 配置即 501。credentials 为静态头值,只写,响应永打码;
 * 空值语义(P4 差距收口 K③):注册必填(缺省 400);更新 null/空串=
 * 保持原值,显式非空=覆盖;无「清空」语义,撤销凭据请删除该三方服务) */
export interface McpServerSaveReq {
  serverKey: string
  name?: string
  endpointUrl: string
  transport?: McpTransport
  authType?: McpAuthType
  headerName?: string
  /** 静态头值(只写;打码不回显;注册必填,更新留空=保持原值) */
  credentials?: string
  timeoutSeconds?: number
  enabled?: boolean
}

// ==================== Skill 目录(ia_skill/ia_skill_file,AdminSkillController,P4-W13) ====================
// zip 导入两段式:预览(POST /import/preview,dryRun 零落库,返回清单+问题列表)
// 与确认入库(POST /import,服务端重跑同一校验器;overwrite=true 覆盖同名活跃行,
// 缺省同名 409;软删同名行复活)。激活门控:应用内同时上限 8,超限 409 明确报错。

/** Skill 状态值域(V19 DDL CHECK) */
export type SkillStatus = 'active' | 'inactive'

/** Skill 清单视图(镜像 AppSkillCatalogService.SkillManifestView) */
export interface SkillManifestView {
  name: string
  displayName: string | null
  description: string | null
  version: string | null
}

/** Skill 包内文件视图(镜像 FileView;content 仅详情/预览语义携带,列表为 null) */
export interface SkillFileView {
  path: string
  /** utf-8 文本 / base64 二进制 */
  encoding: 'utf-8' | 'base64'
  sizeBytes: number
  content: string | null
}

/** 列表/导入出参(镜像 SkillView;active 与 status 同源冗余,便于前端判定) */
export interface IaSkill {
  id: number
  appId: number
  /** 平台清单 name(包唯一标识;同名再导入按复活/覆盖处理) */
  name: string
  displayName: string | null
  description: string | null
  version: string | null
  status: SkillStatus
  /** 来源值域(当前仅 import) */
  source: 'import'
  /** 内容指纹(zip 字节 SHA-256) */
  contentSha256: string
  active: boolean
}

/** 预览出参(镜像 PreviewView;valid=errors 为空且包完整;零落库) */
export interface SkillPreviewView {
  fileName: string
  valid: boolean
  manifest: SkillManifestView | null
  files: SkillFileView[]
  warnings: string[]
  errors: string[]
  totalBytes: number
}

/** 详情出参(含全部文件内容) */
export interface SkillDetailView {
  skill: IaSkill
  files: SkillFileView[]
}

/** Skill 分页列表查询(appId 缺省单应用 1) */
export interface SkillListQuery extends PageQuery {
  appId?: number
}

// ==================== mini 知识库(ia_kb_document/ia_kb_chunk,AdminKbController,P4-W14) ====================
// 文本导入→服务端分块→tsvector 落列;状态门控(inactive 不参与检索);
// rebuild-index 按当前生效检索配置重算 tsv;检索调试返回 top-k 命中与来源字段。

/** 知识库文档状态(V20 DDL CHECK) */
export type KbDocumentStatus = 'active' | 'inactive'

/** 文档视图(镜像 KbIngestService.KbDocumentView) */
export interface IaKbDocument {
  id: number
  appId: number
  /** 文档名(检索命中来源展示) */
  title: string
  /** 来源标识(upload/api/外部系统等,可空) */
  source: string | null
  status: KbDocumentStatus
  /** 分段数(导入/重分块后回填) */
  chunkCount: number
  active: boolean
}

/** 文档导入请求(镜像 KbDocumentImportReq;title/content 必填,分块参数可选) */
export interface KbDocumentImportReq {
  title: string
  source?: string
  content: string
  /** 结构化元数据(JSON 对象字符串,可空) */
  metadata?: string
  /** 分段最大长度(字符;缺省 500) */
  chunkSize?: number
  /** 相邻分段重叠(字符;缺省 50,须小于 chunkSize) */
  chunkOverlap?: number
}

/** 文档更新请求(镜像 KbDocumentUpdateReq;不更新传 null/缺省,带 content 即重分块) */
export interface KbDocumentUpdateReq {
  title?: string
  source?: string
  metadata?: string
  content?: string
  chunkSize?: number
  chunkOverlap?: number
}

/** 知识库分页列表查询 */
/** 知识库文档分页查询(管理面显式 appId,缺省单应用 1) */
export interface KbDocumentListQuery extends PageQuery {
  appId?: number
}

/** 检索命中条目(镜像 KbSearchHitView;anchor 为分段锚点标题/序号来源) */
export interface KbSearchHitView {
  chunkId: number
  documentId: number
  documentTitle: string
  /** 分段锚点(标题路径/行号语义,原样回显) */
  anchor: string | null
  /** 分段序号(0 起) */
  seq: number
  content: string
}

/** 检索调试出参(镜像 KbSearchDebugView;degraded=检索配置不可得走了 simple 兜底) */
export interface KbSearchDebugView {
  query: string
  /** 当前生效检索配置(如 tsvector/simple) */
  searchConfig: string
  degraded: boolean
  hits: KbSearchHitView[]
}

// ==================== 用量统计(ia_model_call 聚合,AdminUsageController,W15) ====================
// 聚合口径=COMPLETED/FAILED/CANCELLED 终态调用,token 合计仅 COMPLETED;
// 行维度=应用/用户 × 日|月 × 模型;granularity 仅 DAY/MONTH,其他值 400。

/** 聚合粒度(DAY 按天/MONTH 按月;其他值服务端 400) */
export type UsageGranularity = 'DAY' | 'MONTH'

/** 聚合行(镜像 UsageSummaryRow;statDate=yyyy-MM-dd(DAY)/yyyy-MM(MONTH)) */
export interface UsageSummaryRow {
  appId: number
  userId: number | null
  statDate: string
  /** 模型服务商标识(请求协议归一) */
  provider: string
  /** 模型代码标识 */
  modelCode: string
  /** 模型调用次数(终态行;FAILED 行 token 列为空) */
  calls: number
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheTokens: number | null
}

/** 聚合分页查询(镜像 AdminUsageController.summary 参数;from/to 为 ISO 本地日期时间) */
export interface UsageSummaryQuery extends PageQuery {
  appId?: number
  userId?: number
  from?: IsoDateTime
  to?: IsoDateTime
  granularity?: UsageGranularity
}

/**
 * 北极星摘要(镜像 UsageQueryService.NorthStarSummary;口径登记于
 * docs/灰度与指标大盘.md B4 行):
 * - 好评率 = 👍 ÷ (👍+👎),窗口内全部反馈;
 * - 带反馈完成率代理 = COMPLETED ÷ (COMPLETED+FAILED)(CANCELLED 单列观察)
 *   ——仅带反馈的根运行;比率为 [0,1],窗口无样本时 null(不出数,不虚报)。
 */
export interface NorthStarSummary {
  from: IsoDateTime | null
  to: IsoDateTime | null
  thumbsUp: number
  thumbsDown: number
  positiveRate: number | null
  feedbackLinkedCompletedRuns: number
  feedbackLinkedFailedRuns: number
  feedbackLinkedCancelledRuns: number
  feedbackLinkedCompletionRate: number | null
}

/** 北极星查询(appId/from/to;时间按反馈 create_time) */
export interface NorthStarQuery {
  appId?: number
  from?: IsoDateTime
  to?: IsoDateTime
}

// ==================== 用户反馈(ia_agent_feedback,AdminFeedbackController,W15) ====================
// 管理面跨用户分页视图;rating=UP(👍)|DOWN(👎),其他值 400;
// 重复反馈=覆盖(updateTime 后移)。

/** 反馈取向(UP-👍 / DOWN-👎;其他值服务端 400) */
export type FeedbackRating = 'UP' | 'DOWN'

/** 反馈行(镜像 FeedbackRespVO) */
export interface IaFeedback {
  id: number
  appId: number
  /** 宿主侧数字用户 ID */
  userId: number | null
  /** 会话锚点(维度定位) */
  conversationId: string | null
  /** 根运行锚点(run 级反馈按 run_id;消息级经 conversation 连根运行) */
  runId: string | null
  /** 消息锚点(消息级反馈) */
  messageId: string | null
  rating: FeedbackRating
  comment: string | null
  /** 首次反馈时间 */
  createTime: IsoDateTime | null
  /** 最近覆盖时间(重复反馈=覆盖) */
  updateTime: IsoDateTime | null
}

/** 反馈分页查询(镜像 AdminFeedbackController.page 参数) */
export interface FeedbackPageQuery extends PageQuery {
  appId?: number
  userId?: number
  conversationId?: string
  runId?: string
  rating?: FeedbackRating
  from?: IsoDateTime
  to?: IsoDateTime
}
