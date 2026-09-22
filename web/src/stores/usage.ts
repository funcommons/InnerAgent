/**
 * [new] 用量统计 store(W15,视图清单 #11)。
 * 覆盖 AdminUsageController:聚合分页(应用/用户 × 日|月 × 模型)+
 * 北极星摘要(好评率/带反馈完成率代理;窗口无样本比率为 null 不虚报)。
 * 聚合口径:COMPLETED/FAILED/CANCELLED 终态调用,token 合计仅 COMPLETED。
 */
import { defineStore } from 'pinia'
import { usageAdminApi } from '@/api/admin'
import { useAppContextStore } from '@/stores/appContext'
import type { NorthStarSummary, UsageGranularity, UsageSummaryRow } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface UsageFilters extends PageQuery {
  /** 页内显式过滤;缺省(null)回落管理面应用上下文(顶栏切换器) */
  appId: number | null
  userId: string
  from: string
  to: string
  granularity: UsageGranularity
}

/** 汇总卡片(汇总卡 tokens/调用次数 + 模型分布;从窗口聚合行客户端汇总) */
export interface UsageOverview {
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  /** 模型分布(provider + modelCode → 调用次数,降序) */
  modelDistribution: Array<{ model: string; calls: number }>
  /** 汇总截断标记(服务端单页上限 100,超出时卡片口径=前 100 行) */
  truncated: boolean
}

export const useUsageStore = defineStore('usage', {
  state: () => ({
    list: [] as UsageSummaryRow[],
    total: 0,
    loading: false,
    filters: { appId: null, userId: '', from: '', to: '', granularity: 'DAY', pageNo: 1, pageSize: 10 } as UsageFilters,
    northStar: null as NorthStarSummary | null,
    overview: null as UsageOverview | null,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const page = await usageAdminApi.summary({
          appId: this.filters.appId ?? useAppContextStore().currentAppId,
          userId: this.filters.userId ? Number(this.filters.userId) : undefined,
          from: this.filters.from || undefined,
          to: this.filters.to || undefined,
          granularity: this.filters.granularity,
          pageNo: this.filters.pageNo,
          pageSize: this.filters.pageSize,
        })
        this.list = page.list
        this.total = page.total
      } finally {
        this.loading = false
      }
    },
    /**
     * 汇总卡片(单页拉 100 行客户端聚合;服务端单页上限 100,超出截断并标记,
     * 卡片口径如实说明——不冒充全量)。
     */
    async loadOverview() {
      const page = await usageAdminApi.summary({
        appId: this.filters.appId ?? useAppContextStore().currentAppId,
        userId: this.filters.userId ? Number(this.filters.userId) : undefined,
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
        granularity: this.filters.granularity,
        pageNo: 1,
        pageSize: 100,
      })
      const byModel = new Map<string, number>()
      let calls = 0
      let input = 0
      let output = 0
      for (const row of page.list) {
        calls += row.calls
        input += row.inputTokens ?? 0
        output += row.outputTokens ?? 0
        const key = `${row.provider}/${row.modelCode}`
        byModel.set(key, (byModel.get(key) ?? 0) + row.calls)
      }
      this.overview = {
        totalCalls: calls,
        totalInputTokens: input,
        totalOutputTokens: output,
        modelDistribution: [...byModel.entries()]
          .map(([model, modelCalls]) => ({ model, calls: modelCalls }))
          .sort((a, b) => b.calls - a.calls),
        truncated: page.total > page.list.length,
      }
      return this.overview
    },
    search() {
      this.filters.pageNo = 1
      return this.load()
    },
    /** 北极星(反馈窗口与聚合窗口解耦:时间按反馈 create_time) */
    async loadNorthStar() {
      this.northStar = await usageAdminApi.northStar({
        appId: this.filters.appId ?? undefined,
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
      })
      return this.northStar
    },
  },
})

