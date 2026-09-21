/**
 * [new] 管理 API 客户端全集(`/ia/api/v1/admin/*`)。
 * 契约类型见 ./types.ts;已对齐服务端真实控制器:
 *   - AdminAppController:/admin/apps(CRUD;公钥登记/轮换=PUT signPublicKey,V9 宽限期)
 *   - AdminToolController:/admin/tools(注册/列表/详情/schema 历史/更新/活刷新
 *     分诊 schema+confirm+reject/启停/注销/工具体检 check+check-batch,V17)
 *   - AdminGrantController:/admin/grants(授予/列表/撤销)
 *   - AdminAgentDefinitionController:/admin/definitions(分页列表/详情/提示词
 *     单槽编辑/export bundle/import,P2-W5)
 *   - AdminAuditController:/admin/audit-logs(分页/过滤/字典,W5)
 *   - AdminModelConfigController:/admin/model-configs(CRUD/连通性测试)
 *   - WebhookDeliveryAdminController:/admin/webhook-deliveries(分页/手动重投,#18b)
 *   - AdminWebhookConfigController:/admin/webhooks/config(配置/测试真实外呼)
 *   - AdminCircuitBreakerController:/admin/circuit-breaker(状态/limits/紧急停用/
 *     恢复/单运行终止;紧急停用仅翻转总开关不批量取消,limits 本版仅管理面读写)
 * P2-W5 分页兼容形:tools/grants 列表缺省(无 pageNo/pageSize)仍数组;list()=
 * 数组兼容形,page()=管理站主动分页形(任一参数出现即 PageResult)。
 */
import { http } from './request'
import type { IsoDateTime, PageQuery, PageResult } from './common'
import type {
  AuditDictionary,
  AuditLogQuery,
  CircuitBreakerEvent,
  CircuitBreakerState,
  CircuitBreakerUpdateReq,
  DefinitionBundle,
  DefinitionExportReq,
  DefinitionImportReq,
  DefinitionImportResult,
  DefinitionListQuery,
  DefinitionUpdatePromptReq,
  EmergencyStopReq,
  IaAgentDefinition,
  IaApp,
  IaAppCreateReq,
  IaAppUpdateReq,
  IaAuditLog,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  IaToolSchemaHistory,
  ModelApiConfigPageReq,
  ModelApiConfigSaveReq,
  ModelConnectivityResult,
  ResourceLimits,
  TerminateRunReq,
  ToolCheckBatchReceipt,
  ToolCheckResult,
  ToolGrantCreateReq,
  ToolGrantListQuery,
  ToolGrantRevokeReq,
  ToolListQuery,
  ToolRegisterReq,
  ToolRefreshSchemaReq,
  ToolTriageResp,
  ToolUpdateReq,
  WebhookConfig,
  WebhookConfigSaveReq,
  WebhookConfigTestResult,
  WebhookDelivery,
  WebhookDeliveryPageReq,
} from './types'

const BASE = '/ia/api/v1/admin'

/** 把查询对象拼成 query string。约定:仅 undefined/null/空串不下发;false/0 为有效过滤值(如 enabled=false) */
export function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const s = query.toString()
  return s ? `?${s}` : ''
}

// ==================== 应用管理(AdminAppController) ====================

export const appAdminApi = {
  /** 应用列表(真实形:数组,无分页/过滤参数) */
  list: () => http.get<IaApp[]>(`${BASE}/apps`),
  get: (id: number) => http.get<IaApp>(`${BASE}/apps/${id}`),
  /** 注册应用(上传验签公钥;appKey 唯一 → 409,非法 PEM → 400) */
  create: (data: IaAppCreateReq) => http.post<IaApp>(`${BASE}/apps`, data),
  /** 更新应用(name/signPublicKey/webhook/status;非空字段生效) */
  update: (id: number, data: IaAppUpdateReq) => http.put<IaApp>(`${BASE}/apps/${id}`, data),
  /** 注销应用(逻辑删除) */
  remove: (id: number) => http.delete<boolean>(`${BASE}/apps/${id}`),
  /**
   * 公钥登记/轮换(同一端点:PUT /apps/{id} {signPublicKey})。
   * P2-key V9:值变化即轮换(旧公钥进 72h 验签宽限期,双公钥并存),
   * 响应回 signKeyFingerprint/signKeyRotatedAt(见 AdminAppService.rotateSignKey)。
   */
  updateSignKey: (id: number, signPublicKey: string) =>
    http.put<IaApp>(`${BASE}/apps/${id}`, { signPublicKey }),
}

// ==================== 工具注册(AdminToolController) ====================

export const toolAdminApi = {
  /**
   * 工具列表——数组兼容形(不传分页参数,镜像 AdminToolController.list 旧形:
   * 服务端返回全量数组;授权代授下拉等「需要全集」的场景用)。
   */
  list: (query: Omit<ToolListQuery, 'pageNo' | 'pageSize'> = {}) =>
    http.get<IaToolRegistry[]>(`${BASE}/tools${buildQuery({ ...query })}`),
  /**
   * 工具列表——服务端分页形(P2-W5:主动传 pageNo/pageSize 任一即 PageResult,
   * 单页上限 100;与 audit-logs 分页形一致)。管理站列表页走此方法。
   */
  page: (query: ToolListQuery & Required<PageQuery>) =>
    http.get<PageResult<IaToolRegistry>>(`${BASE}/tools${buildQuery({ ...query })}`),
  get: (id: number) => http.get<IaToolRegistry>(`${BASE}/tools/${id}`),
  /** 注册工具(单条;FQN 唯一 → 409,serverKey 仅字母/数字/连字符 → 400) */
  register: (data: ToolRegisterReq) => http.post<IaToolRegistry>(`${BASE}/tools`, data),
  /** schema 指纹变更历史(V14 留痕;仅追加) */
  schemaHistory: (id: number) => http.get<IaToolSchemaHistory[]>(`${BASE}/tools/${id}/schema-history`),
  /** 更新治理元数据(风险上调级联失效授权;强制高危不可下调 → 400) */
  update: (id: number, data: ToolUpdateReq) => http.put<IaToolRegistry>(`${BASE}/tools/${id}`, data),
  /** 活刷新分诊(宿主重发 schema;V14:unchanged/compatible/breaking) */
  refreshSchema: (id: number, data: ToolRefreshSchemaReq = {}) =>
    http.post<ToolTriageResp>(`${BASE}/tools/${id}/schema`, { ...data }),
  /** 重新确认通过(应用 BREAKING 暂存 schema) */
  confirmSchema: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/schema/confirm`),
  /** 拒绝待确认变更(保持旧 schema) */
  rejectSchema: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/schema/reject`),
  disable: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/disable`),
  enable: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/enable`),
  /**
   * 工具体检 v1(V17,单工具同步):可达/清单/指纹/注解四项检查矩阵,
   * 结论与明细落库并返回(结果同时持久化,GET /admin/tools/{id} 可回读)。
   */
  checkHealth: (id: number) => http.post<ToolCheckResult>(`${BASE}/tools/${id}/check`),
  /**
   * 批量/全量异步体检(受理后单线程逐个执行):ids 缺省=全部未删除注册行;
   * 未知 id 计入 skipped。结果即时落各自注册行,经列表/详情刷新可查。
   */
  checkHealthBatch: (ids?: number[]) =>
    http.post<ToolCheckBatchReceipt>(`${BASE}/tools/check-batch`, { ids: ids ?? [] }),
  /** 注销(逻辑删除+级联清除授权) */
  remove: (id: number) => http.delete<boolean>(`${BASE}/tools/${id}`),
}

// ==================== 工具授权(AdminGrantController) ====================

export const toolGrantAdminApi = {
  /**
   * 授权列表——数组兼容形(不传分页参数;镜像 AdminGrantController.list 旧形,
   * activeOnly 服务端默认 true)。
   */
  list: (query: Omit<ToolGrantListQuery, 'pageNo' | 'pageSize'> = {}) =>
    http.get<IaToolGrant[]>(`${BASE}/grants${buildQuery({ ...query })}`),
  /**
   * 授权列表——服务端分页形(P2-W5:pageNo/pageSize 任一出现即 PageResult,
   * 单页上限 100;activeOnly 已下推 SQL 条件 invalidated=FALSE)。
   */
  page: (query: ToolGrantListQuery & Required<PageQuery>) =>
    http.get<PageResult<IaToolGrant>>(`${BASE}/grants${buildQuery({ ...query })}`),
  /** 授予授权(快照风险级/schema 指纹,落审计;同作用域有效授权重复 → 409) */
  grant: (data: ToolGrantCreateReq) => http.post<IaToolGrant>(`${BASE}/grants`, data),
  /** 撤销授权(逻辑删除,落审计;可携带 decisionNote) */
  revoke: (id: number, data?: ToolGrantRevokeReq) =>
    http.delete<boolean>(`${BASE}/grants/${id}`, { data }),
}

// ==================== Agent 定义(AdminAgentDefinitionController,P2-W5) ====================

export const definitionAdminApi = {
  /**
   * 定义分页列表(端点缺省即分页形 PageResult,与 audit-logs 一致,缺省 1/10;
   * agentKey 升序;出参含提示词三槽与规格 spec 对象)。
   */
  page: (params: DefinitionListQuery = {}) =>
    http.get<PageResult<IaAgentDefinition>>(`${BASE}/definitions${buildQuery({ ...params })}`),
  /** 定义详情(含提示词三槽与规格 spec 对象;不存在 → 404) */
  get: (id: number) => http.get<IaAgentDefinition>(`${BASE}/definitions/${id}`),
  /**
   * 编辑提示词槽位(slot=systemPrompt/instructionTemplate/greeting;
   * systemPrompt 必须非空白、65536 上限,其余槽位空白=清空;
   * 旧值快照落审计 definition-updated/source=admin)。
   */
  updatePrompt: (id: number, data: DefinitionUpdatePromptReq) =>
    http.put<IaAgentDefinition>(`${BASE}/definitions/${id}/prompt`, data),
  /** 导出 bundle({schemaVersion:1, exportedAt, definitions[]};ids 缺省=该应用全量) */
  export: (data: DefinitionExportReq = {}) =>
    http.post<DefinitionBundle>(`${BASE}/definitions/export`, data),
  /**
   * 导入 bundle(conflictPolicy=skip|overwrite 缺省 skip;dryRun=true 只出预览
   * 零副作用;结果 {dryRun,created,updated,skipped,errors[]})。
   */
  import: (data: DefinitionImportReq) =>
    http.post<DefinitionImportResult>(`${BASE}/definitions/import`, data),
}

// ==================== 审计查询(AdminAuditController,W5) ====================

export const auditAdminApi = {
  page: (params: AuditLogQuery = {}) =>
    http.get<PageResult<IaAuditLog>>(`${BASE}/audit-logs${buildQuery({ ...params })}`),
  /** 审计字典(#12):decision_source/decision 实际值域,下拉选项以此为准 */
  dictionary: () => http.get<AuditDictionary>(`${BASE}/audit-logs/dictionary`),
}

// ==================== 模型配置(依赖并行任务:联调时核对字段形) ====================

export const modelConfigAdminApi = {
  page: (params: ModelApiConfigPageReq = {}) =>
    http.get<PageResult<IaModelApiConfig>>(`${BASE}/model-configs${buildQuery({ ...params })}`),
  get: (id: number) => http.get<IaModelApiConfig>(`${BASE}/model-configs/${id}`),
  create: (data: ModelApiConfigSaveReq) => http.post<IaModelApiConfig>(`${BASE}/model-configs`, data),
  update: (id: number, data: ModelApiConfigSaveReq) =>
    http.put<IaModelApiConfig>(`${BASE}/model-configs/${id}`, data),
  delete: (id: number) => http.delete<boolean>(`${BASE}/model-configs/${id}`),
  /** 连通性测试(保存前可测文本连通) */
  test: (id: number) =>
    http.post<ModelConnectivityResult>(`${BASE}/model-configs/${id}/test`),
}

// ==================== 熔断与资源上限(AdminCircuitBreakerController) ====================

export const circuitAdminApi = {
  /** 状态(total 开关/limits/activeRuns 活跃 run 数/最近 20 条事件) */
  getState: () => http.get<CircuitBreakerState>(`${BASE}/circuit-breaker`),
  /** 更新资源上限(回全量;本版仅落库+管理面读写,内核强制执行后续接入) */
  updateLimits: (data: CircuitBreakerUpdateReq) =>
    http.put<ResourceLimits>(`${BASE}/circuit-breaker/limits`, data),
  /**
   * 紧急停用:应用级 Agent 总开关(新运行拒绝接入)。
   * 契约注记(2026-09-21 服务端批):仅翻转开关+记事件,不批量取消进行中
   * run(无 Redis 广播/≤5s 生效语义);存量 run 由管理员逐个 terminate-run。
   */
  emergencyStop: (data: EmergencyStopReq) =>
    http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/emergency-stop`, data),
  resume: () => http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/resume`),
  /** 单运行终止(runId 不存在 → 404;已终态 → 409) */
  terminateRun: (data: TerminateRunReq) =>
    http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/terminate-run`, data),
}

// ==================== Webhook(deliveries=#18b;config=AdminWebhookConfigController) ====================

/**
 * #18b 线上行形(DeliveryView):时间字段为 epoch 毫秒。
 * deliveries() 负责归一为 WebhookDelivery 的 ISO 展示形。
 */
interface RawDelivery {
  id: number
  appId?: number
  event: WebhookDelivery['event']
  runId: string
  url: string
  success: boolean
  status?: WebhookDelivery['status']
  attempt: number
  maxAttempts: number
  httpStatus: number | null
  responseSummary: string | null
  nextRetryAt?: number | null
  deliveredAt?: number | null
}

function epochToIso(ms: number | null | undefined): IsoDateTime | null {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null
}

function toDelivery(raw: RawDelivery): WebhookDelivery {
  return {
    id: raw.id,
    appId: raw.appId,
    event: raw.event,
    runId: raw.runId,
    url: raw.url,
    success: raw.success,
    status: raw.status,
    attempt: raw.attempt,
    maxAttempts: raw.maxAttempts,
    httpStatus: raw.httpStatus,
    responseSummary: raw.responseSummary,
    nextRetryAt: epochToIso(raw.nextRetryAt),
    deliveredAt: epochToIso(raw.deliveredAt),
  }
}

export const webhookAdminApi = {
  /** config 域:配置本体在 ia_app(webhookUrl/webhookSecret 走 apps 域);
   *  /webhooks/config 端点待服务端落地(跟踪:99-优化建议.md #2),失败时 UI 显占位 */
  getConfig: () => http.get<WebhookConfig>(`${BASE}/webhooks/config`),
  saveConfig: (data: WebhookConfigSaveReq) => http.put<WebhookConfig>(`${BASE}/webhooks/config`, data),
  /** 发送测试回调(真实外呼;未配置 url → 400;响应含 httpStatus/error) */
  testConfig: () => http.post<WebhookConfigTestResult>(`${BASE}/webhooks/config/test`),
  /** 投递记录分页(任务 #18b:GET /admin/webhook-deliveries;时间归一为 ISO) */
  deliveries: async (params: WebhookDeliveryPageReq = {}): Promise<PageResult<WebhookDelivery>> => {
    const page = await http.get<PageResult<RawDelivery>>(`${BASE}/webhook-deliveries${buildQuery({ ...params })}`)
    return { ...page, list: page.list.map(toDelivery) }
  },
  /** 手动重投(任务 #18b:POST /webhook-deliveries/{id}/redeliver;SUCCESS/FAILED/EXHAUSTED → PENDING) */
  redeliver: async (id: number): Promise<WebhookDelivery> => {
    const raw = await http.post<RawDelivery>(`${BASE}/webhook-deliveries/${id}/redeliver`)
    return toDelivery(raw)
  },
}
