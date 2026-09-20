/**
 * [new] 管理 API 客户端全集(`/ia/api/v1/admin/*`)。
 * 契约类型见 ./types.ts;已对齐服务端真实控制器:
 *   - AdminAppController:/admin/apps(CRUD;公钥登记/轮换=PUT signPublicKey,V9 宽限期)
 *   - AdminToolController:/admin/tools(注册/列表/详情/schema 历史/更新/活刷新
 *     分诊 schema+confirm+reject/启停/注销)
 *   - AdminGrantController:/admin/grants(授予/列表/撤销)
 *   - AdminAuditController:/admin/audit-logs(分页/过滤/字典,W5)
 *   - AdminModelConfigController:/admin/model-configs(CRUD/连通性测试)
 *   - WebhookDeliveryAdminController:/admin/webhook-deliveries(分页/手动重投,#18b)
 * apps/tools/grants 列表为服务端全量数组(分页在管理站客户端完成);
 * circuit 与 /webhooks/config 管理端点待服务端落地(跟踪:99-优化建议.md #2),
 * api 层按契约形状调用,失败时由视图显「服务端能力未开通」占位。
 */
import { http } from './request'
import type { IsoDateTime, PageResult } from './common'
import type {
  AuditDictionary,
  AuditLogQuery,
  CircuitBreakerEvent,
  CircuitBreakerState,
  CircuitBreakerUpdateReq,
  EmergencyStopReq,
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
  /** 工具列表(serverKey/enabled 过滤;真实形:数组,无分页) */
  list: (query: ToolListQuery = {}) =>
    http.get<IaToolRegistry[]>(`${BASE}/tools${buildQuery({ ...query })}`),
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
  /** 注销(逻辑删除+级联清除授权) */
  remove: (id: number) => http.delete<boolean>(`${BASE}/tools/${id}`),
}

// ==================== 工具授权(AdminGrantController) ====================

export const toolGrantAdminApi = {
  /** 授权列表(userId/toolName/scope/activeOnly 过滤;真实形:数组,无分页) */
  list: (query: ToolGrantListQuery = {}) =>
    http.get<IaToolGrant[]>(`${BASE}/grants${buildQuery({ ...query })}`),
  /** 授予授权(快照风险级/schema 指纹,落审计;同作用域有效授权重复 → 409) */
  grant: (data: ToolGrantCreateReq) => http.post<IaToolGrant>(`${BASE}/grants`, data),
  /** 撤销授权(逻辑删除,落审计;可携带 decisionNote) */
  revoke: (id: number, data?: ToolGrantRevokeReq) =>
    http.delete<boolean>(`${BASE}/grants/${id}`, { data }),
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

// ==================== 熔断与资源上限(mock 域:服务端未实现,P2 后续) ====================

export const circuitAdminApi = {
  getState: () => http.get<CircuitBreakerState>(`${BASE}/circuit-breaker`),
  updateLimits: (data: CircuitBreakerUpdateReq) =>
    http.put<ResourceLimits>(`${BASE}/circuit-breaker/limits`, data),
  /** 紧急停用:应用级 Agent 总开关(≤5s 生效) */
  emergencyStop: (data: EmergencyStopReq) =>
    http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/emergency-stop`, data),
  resume: () => http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/resume`),
  /** 单运行终止 */
  terminateRun: (data: TerminateRunReq) =>
    http.post<CircuitBreakerEvent>(`${BASE}/circuit-breaker/terminate-run`, data),
}

// ==================== Webhook(deliveries 已落地任务 #18b;config 待服务端,见 #2) ====================

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
  /** 发送测试回调(HMAC 签名可验;端点待服务端落地,同 #2) */
  testConfig: () => http.post<{ ok: boolean; signatureValid: boolean }>(`${BASE}/webhooks/config/test`),
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
