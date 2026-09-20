/**
 * [new] Webhook store(视图清单 #6,占位契约:方案 §7.1 定 HMAC+5 次退避、
 * Q5 双密钥并存未建模;配置/投递记录字段自拟,见 types.ts 头清单 #7)。
 */
import { defineStore } from 'pinia'
import { webhookAdminApi } from '@/api/admin'
import type { WebhookConfig, WebhookDelivery, WebhookEvent } from '@/api/types'
import type { PageQuery } from '@/api/common'

export const WEBHOOK_EVENTS: Array<{ value: WebhookEvent; label: string }> = [
  { value: 'run.finished', label: '运行成功(run.finished)' },
  { value: 'run.failed', label: '运行失败(run.failed)' },
  { value: 'run.cancelled', label: '运行取消(run.cancelled)' },
  { value: 'run.resource-limit', label: '资源上限触发(run.resource-limit)' },
]

export interface DeliveryFilters extends PageQuery {
  event: WebhookEvent | ''
  success: boolean | null
}

export const useWebhooksStore = defineStore('webhooks', {
  state: () => ({
    config: null as WebhookConfig | null,
    configForm: { url: '', secret: '', enabled: false, events: [] as WebhookEvent[] },
    deliveries: [] as WebhookDelivery[],
    deliveriesTotal: 0,
    loading: false,
    filters: { event: '', success: null, pageNo: 1, pageSize: 10 } as DeliveryFilters,
  }),
  actions: {
    async loadConfig() {
      this.config = await webhookAdminApi.getConfig()
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
    async testConfig() {
      return webhookAdminApi.testConfig()
    },
    async loadDeliveries() {
      this.loading = true
      try {
        const f = this.filters
        const page = await webhookAdminApi.deliveries({
          event: f.event || undefined,
          success: f.success ?? undefined,
          pageNo: f.pageNo,
          pageSize: f.pageSize,
        })
        this.deliveries = page.list
        this.deliveriesTotal = page.total
      } finally {
        this.loading = false
      }
    },
    async simulateFailure(event: WebhookEvent, runId: string) {
      const d = await webhookAdminApi.simulateFailure(event, runId)
      await this.loadDeliveries()
      return d
    },
  },
})
