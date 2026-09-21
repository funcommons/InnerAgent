/**
 * [new] Webhook store(视图清单 #6)。
 * deliveries 域已接真实端点(任务 #18b:/admin/webhook-deliveries + redeliver);
 * config 域已落地 AdminWebhookConfigController(test 为真实外呼,未配置 url → 400)。
 * 旧版占位兜底(configUnavailable)保留:对老版本服务端显「服务端能力未开通」。
 */
import { defineStore } from 'pinia'
import { webhookAdminApi } from '@/api/admin'
import type { WebhookConfig, WebhookConfigTestResult, WebhookDelivery, WebhookDeliveryPageReq, WebhookEvent } from '@/api/types'
import type { PageQuery } from '@/api/common'

export const WEBHOOK_EVENTS: Array<{ value: WebhookEvent; label: string }> = [
  { value: 'run.finished', label: '运行成功(run.finished)' },
  { value: 'run.failed', label: '运行失败(run.failed)' },
  { value: 'run.cancelled', label: '运行取消(run.cancelled)' },
  { value: 'run.resource-limit', label: '资源上限触发(run.resource-limit)' },
]

/** 投递状态机字典(#18b) */
export const DELIVERY_STATUS: Record<string, { label: string; tag: 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: '待投递', tag: 'info' },
  FAILED: { label: '退避重试中', tag: 'warning' },
  SUCCESS: { label: '成功', tag: 'success' },
  EXHAUSTED: { label: '重试耗尽', tag: 'danger' },
}

export interface DeliveryFilters extends PageQuery {
  event: WebhookEvent | ''
  /** 契约偏差 #7:success 布尔过滤 → status 状态机过滤 */
  status: WebhookDeliveryPageReq['status'] | ''
}

export const useWebhooksStore = defineStore('webhooks', {
  state: () => ({
    config: null as WebhookConfig | null,
    configForm: { url: '', secret: '', enabled: false, events: [] as WebhookEvent[] },
    /** config 端点不可达(老版本服务端)→ 视图显「服务端能力未开通」占位 */
    configUnavailable: false,
    deliveries: [] as WebhookDelivery[],
    deliveriesTotal: 0,
    loading: false,
    filters: { event: '', status: '', pageNo: 1, pageSize: 10 } as DeliveryFilters,
  }),
  actions: {
    async loadConfig() {
      this.configUnavailable = false
      try {
        this.config = await webhookAdminApi.getConfig()
      } catch {
        // 端点 404/未授权(老版本服务端)→ 占位态,不弹错误
        this.configUnavailable = true
        return
      }
      this.configForm = {
        url: this.config.url,
        secret: '', // 只写:留空不改
        enabled: this.config.enabled,
        events: [...this.config.events],
      }
    },
    async saveConfig() {
      const saved = await webhookAdminApi.saveConfig({
        url: this.configForm.url,
        secret: this.configForm.secret || undefined,
        enabled: this.configForm.enabled,
        events: this.configForm.events,
      })
      this.config = saved
      this.configForm.secret = ''
      return saved
    },
    async testConfig(): Promise<WebhookConfigTestResult> {
      return webhookAdminApi.testConfig()
    },
    async loadDeliveries() {
      this.loading = true
      try {
        const f = this.filters
        const page = await webhookAdminApi.deliveries({
          event: f.event || undefined,
          status: f.status || undefined,
          pageNo: f.pageNo,
          pageSize: f.pageSize,
        })
        this.deliveries = page.list
        this.deliveriesTotal = page.total
      } finally {
        this.loading = false
      }
    },
    /** 手动重投(#18b:SUCCESS/FAILED/EXHAUSTED → PENDING,清空尝试历史) */
    async redeliver(id: number) {
      const d = await webhookAdminApi.redeliver(id)
      await this.loadDeliveries()
      return d
    },
  },
})
