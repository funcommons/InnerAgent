/**
 * [new] 审计查询 store(视图清单 #4)。
 * 按 应用/用户/时间/decision_source 过滤;时间倒序。
 */
import { defineStore } from 'pinia'
import { auditAdminApi } from '@/api/admin'
import type { AuditResultStatus, DecisionSource, IaAuditLog } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface AuditFilters extends PageQuery {
  appKey: string
  userId: string
  decisionSource: DecisionSource | ''
  resultStatus: AuditResultStatus | ''
  toolFqn: string
  from: string
  to: string
}

export const DECISION_SOURCES: Array<{ value: DecisionSource; label: string; desc: string }> = [
  { value: 'mode-default', label: '模式默认', desc: '按权限模式:只读直通/写确认' },
  { value: 'user-grant', label: '用户授权', desc: '命中用户「总是允许」授权' },
  { value: 'forced-policy', label: '强制策略', desc: '管理员策略覆盖(force-ask/deny 等)' },
  { value: 'live-confirm', label: '实时确认', desc: '用户在确认卡上批准' },
  { value: 'full-access', label: 'FULL_ACCESS', desc: '全放行模式(一次性确认已审计)' },
]

export const RESULT_STATUS: Array<{ value: AuditResultStatus; label: string; tag: 'success' | 'danger' | 'warning' | 'info' }> = [
  { value: 'success', label: '成功', tag: 'success' },
  { value: 'failed', label: '失败', tag: 'danger' },
  { value: 'denied', label: '被拒', tag: 'warning' },
  { value: 'timeout', label: '超时', tag: 'info' },
]

export const useAuditStore = defineStore('audit', {
  state: () => ({
    list: [] as IaAuditLog[],
    total: 0,
    loading: false,
    filters: {
      appKey: '', userId: '', decisionSource: '', resultStatus: '', toolFqn: '',
      from: '', to: '', pageNo: 1, pageSize: 10,
    } as AuditFilters,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const f = this.filters
        const page = await auditAdminApi.page({
          appKey: f.appKey || undefined,
          userId: f.userId || undefined,
          decisionSource: f.decisionSource || undefined,
          resultStatus: f.resultStatus || undefined,
          toolFqn: f.toolFqn || undefined,
          from: f.from || undefined,
          to: f.to || undefined,
          pageNo: f.pageNo,
          pageSize: f.pageSize,
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
  },
})
