/**
 * [new] 用户反馈 store(W15,视图清单 #12)。
 * 覆盖 AdminFeedbackController:分页(rating=UP|DOWN/时间区间/锚点过滤)+
 * 北极星卡片数据(好评率/带反馈完成率代理,口径见 AdminUsageController 注释)。
 */
import { defineStore } from 'pinia'
import { feedbackAdminApi, usageAdminApi } from '@/api/admin'
import type { FeedbackRating, IaFeedback, NorthStarSummary } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface FeedbackFilters extends PageQuery {
  rating: FeedbackRating | ''
  /** ISO 本地日期时间(无时区后缀,镜像服务端 @DateTimeFormat ISO) */
  from: string
  to: string
}

export const useFeedbacksStore = defineStore('feedbacks', {
  state: () => ({
    list: [] as IaFeedback[],
    total: 0,
    loading: false,
    filters: { rating: '', from: '', to: '', pageNo: 1, pageSize: 10 } as FeedbackFilters,
    /** 北极星卡片(好评率/带反馈完成率;窗口按反馈 create_time) */
    northStar: null as NorthStarSummary | null,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const page = await feedbackAdminApi.page({
          rating: this.filters.rating || undefined,
          from: this.filters.from || undefined,
          to: this.filters.to || undefined,
          pageNo: this.filters.pageNo,
          pageSize: this.filters.pageSize,
        })
        this.list = page.list
        this.total = page.total
      } finally {
        this.loading = false
      }
    },
    search() {
      this.filters.pageNo = 1
      return this.load()
    },
    async loadNorthStar() {
      this.northStar = await usageAdminApi.northStar({
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
      })
      return this.northStar
    },
  },
})
