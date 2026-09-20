/**
 * [new] 管理 API 客户端全集(`/ia/api/v1/admin/*`)。
 * 契约类型见 ./types.ts;路径与字段自拟处见该文件头「契约空缺/自拟字段清单」。
 */
import { http } from './request'
import type { PageResult } from './common'
import type {
  AuditLogPageReq,
  CircuitBreakerEvent,
  CircuitBreakerState,
  CircuitBreakerUpdateReq,
  EmergencyStopReq,
  IaApp,
  IaAppCreateReq,
  IaAppPageReq,
  IaAppPublicKeyReq,
  IaAppPublicKeyResp,
  IaAppUpdateReq,
  IaAuditLog,
  IaModelApiConfig,
  IaToolGrant,
  IaToolRegistry,
  ModelApiConfigPageReq,
  ModelApiConfigSaveReq,
  ModelConnectivityResult,
  ResourceLimits,
  TerminateRunReq,
  ToolGrantCreateReq,
  ToolGrantPageReq,
  ToolPageReq,
  ToolPolicyUpdateReq,
  ToolRefreshResp,
  ToolRegisterReq,
  ToolRegisterResp,
  WebhookConfig,
  WebhookConfigSaveReq,
  WebhookDelivery,
  WebhookDeliveryPageReq,
  WebhookEvent,
} from './types'

const BASE = '/ia/api/v1/admin'

/** 把查询对象拼成 query string。约定:仅 undefined/null/空串不下发;false/0 为有效过滤值(如 status=0 停用) */
export function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const s = query.toString()
  return s ? `?${s}` : ''
}

// ==================== 应用管理 ====================

export const appAdminApi = {
  page: (params: IaAppPageReq = {}) =>
    http.get<PageResult<IaApp>>(`${BASE}/apps${buildQuery({ ...params })}`),
  get: (id: number) => http.get<IaApp>(`${BASE}/apps/${id}`),
  create: (data: IaAppCreateReq) => http.post<IaApp>(`${BASE}/apps`, data),
  update: (id: number, data: IaAppUpdateReq) => http.put<IaApp>(`${BASE}/apps/${id}`, data),
  /** embed 签发密钥 RSA 公钥登记 */
  registerPublicKey: (id: number, data: IaAppPublicKeyReq) =>
    http.post<IaAppPublicKeyResp>(`${BASE}/apps/${id}/public-key`, data),
  /** 密钥轮换(UI 占位:非对称双级令牌轮换友好,ADR-T6;P2 定宽限期语义) */
  rotateKey: (id: number, data: IaAppPublicKeyReq) =>
    http.post<IaAppPublicKeyResp>(`${BASE}/apps/${id}/public-key/rotate`, data),
}

// ==================== 工具注册 ====================

export const toolAdminApi = {
  page: (params: ToolPageReq = {}) =>
    http.get<PageResult<IaToolRegistry>>(`${BASE}/tools${buildQuery({ ...params })}`),
  get: (id: number) => http.get<IaToolRegistry>(`${BASE}/tools/${id}`),
  /** 注册:录入 MCP 端点,服务端 list_tools 拉取清单并生成指纹/风险默认 */
  register: (data: ToolRegisterReq) => http.post<ToolRegisterResp>(`${BASE}/tools/register`, data),
  /** 活刷新分诊(订阅 tools/list_changed 后亦走此刷新) */
  refresh: (id: number) => http.post<ToolRefreshResp>(`${BASE}/tools/${id}/refresh`),
  disable: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/disable`),
  enable: (id: number) => http.post<IaToolRegistry>(`${BASE}/tools/${id}/enable`),
  /** 风险等级人工覆盖 / 管理员策略 / resumeSafe */
  updatePolicy: (id: number, data: ToolPolicyUpdateReq) =>
    http.patch<IaToolRegistry>(`${BASE}/tools/${id}/policy`, data),
}

// ==================== 工具授权 ====================

export const toolGrantAdminApi = {
  page: (params: ToolGrantPageReq = {}) =>
    http.get<PageResult<IaToolGrant>>(`${BASE}/tool-grants${buildQuery({ ...params })}`),
  /** 授予(管理站代授;终端用户授权走确认流四档) */
  grant: (data: ToolGrantCreateReq) => http.post<IaToolGrant>(`${BASE}/tool-grants`, data),
  /** 撤销 */
  revoke: (id: number) => http.delete<{ ok: boolean }>(`${BASE}/tool-grants/${id}`),
}

// ==================== 审计查询 ====================

export const auditAdminApi = {
  page: (params: AuditLogPageReq = {}) =>
    http.get<PageResult<IaAuditLog>>(`${BASE}/audit-logs${buildQuery({ ...params })}`),
}

// ==================== 模型配置 ====================

export const modelConfigAdminApi = {
  page: (params: ModelApiConfigPageReq = {}) =>
    http.get<PageResult<IaModelApiConfig>>(`${BASE}/model-configs${buildQuery({ ...params })}`),
  get: (id: number) => http.get<IaModelApiConfig>(`${BASE}/model-configs/${id}`),
  create: (data: ModelApiConfigSaveReq) => http.post<IaModelApiConfig>(`${BASE}/model-configs`, data),
  update: (id: number, data: ModelApiConfigSaveReq) =>
    http.put<IaModelApiConfig>(`${BASE}/model-configs/${id}`, data),
  delete: (id: number) => http.delete<{ ok: boolean }>(`${BASE}/model-configs/${id}`),
  /** 连通性测试(保存前可测文本连通) */
  test: (id: number) =>
    http.post<ModelConnectivityResult>(`${BASE}/model-configs/${id}/test`),
}

// ==================== 熔断与资源上限 ====================

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

// ==================== Webhook ====================

export const webhookAdminApi = {
  getConfig: () => http.get<WebhookConfig>(`${BASE}/webhooks/config`),
  saveConfig: (data: WebhookConfigSaveReq) => http.put<WebhookConfig>(`${BASE}/webhooks/config`, data),
  /** 发送测试回调(HMAC 签名可验) */
  testConfig: () => http.post<{ ok: boolean; signatureValid: boolean }>(`${BASE}/webhooks/config/test`),
  deliveries: (params: WebhookDeliveryPageReq = {}) =>
    http.get<PageResult<WebhookDelivery>>(`${BASE}/webhooks/deliveries${buildQuery({ ...params })}`),
  /** 模拟宿主 5xx 触发退避重试(P2 联调用;mock 即返回可重试投递) */
  simulateFailure: (event: WebhookEvent, runId: string) =>
    http.post<WebhookDelivery>(`${BASE}/webhooks/deliveries/simulate-failure`, { event, runId }),
}
