/**
 * [new] 审计查询 store(视图清单 #4)。
 * 行形已对齐 ia_audit_log 真实列(decision/decision_source/params_masked_json/
 * error_text/duration_ms/create_time);查询端点服务端未实现(P2 后续),
 * 过滤项为 mock 形,字段名对齐真实列。时间倒序(createTime)。
 */
import { defineStore } from 'pinia'
import { auditAdminApi } from '@/api/admin'
import type { AuditDecision, DecisionSource, IaAuditLog } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface AuditFilters extends PageQuery {
  appId: string
  userId: string
  decisionSource: DecisionSource | ''
  decision: AuditDecision | ''
  toolFqn: string
  from: string
  to: string
}

/** decision_source 字典(V22 真实码值;「高危 100% 确认」的日志证明锚点) */
export const DECISION_SOURCES: Array<{ value: DecisionSource; label: string; desc: string }> = [
  { value: 'mode-default', label: '模式默认', desc: '按权限模式:只读直通/写确认' },
  { value: 'user-grant', label: '用户授权', desc: '命中用户「总是允许」授权' },
  { value: 'forced-policy', label: '强制策略', desc: '管理员策略覆盖(force-ask/deny 等)' },
  { value: 'live-confirm', label: '实时确认', desc: '用户在确认卡上批准/拒绝(T3b 实弹决策)' },
  { value: 'full-access', label: 'FULL_ACCESS', desc: '全放行模式(一次性确认已审计)' },
]

/** decision 字典(ia_audit_log.decision 真实码值) */
export const AUDIT_DECISIONS: Array<{ value: AuditDecision; label: string; tag: 'success' | 'danger' | 'warning' | 'info' }> = [
  { value: 'allowed', label: '放行', tag: 'success' },
  { value: 'denied', label: '拒绝', tag: 'danger' },
  { value: 'granted', label: '已授予', tag: 'info' },
  { value: 'revoked', label: '已撤销', tag: 'warning' },
  { value: 'invalidated', label: '已失效', tag: 'warning' },
  { value: 'risk_upgraded', label: '风险升级失效', tag: 'warning' },
  { value: 'tool_disabled', label: '停用失效', tag: 'warning' },
  { value: 'schema_compatible', label: 'schema 兼容刷新', tag: 'info' },
  { value: 'schema_breaking', label: 'schema 破坏待确认', tag: 'warning' },
]

export const useAuditStore = defineStore('audit', {
  state: () => ({
    list: [] as IaAuditLog[],
    total: 0,
    loading: false,
    filters: {
      appId: '', userId: '', decisionSource: '', decision: '', toolFqn: '',
      from: '', to: '', pageNo: 1, pageSize: 10,
    } as AuditFilters,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const f = this.filters
        const appId = f.appId.trim() ? Number(f.appId.trim()) : undefined
        const userId = f.userId.trim() ? Number(f.userId.trim()) : undefined
        const page = await auditAdminApi.page({
          appId: appId !== undefined && !Number.isNaN(appId) ? appId : undefined,
          userId: userId !== undefined && !Number.isNaN(userId) ? userId : undefined,
          decisionSource: f.decisionSource || undefined,
          decision: f.decision || undefined,
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
