/**
 * [new] 审计查询 store(视图清单 #4;查询/字典端点已落地 AdminAuditController,W5)。
 * 行形对齐 ia_audit_log 真实列;decision_source 下拉选项以字典端点下发值域为准
 * (#12,杜绝手抄枚举漂移),DECISION_SOURCES 常量仅作端点不可用时的兜底。
 * 时间倒序(createTime)。
 */
import { defineStore } from 'pinia'
import { auditAdminApi } from '@/api/admin'
import type { AuditDictionaryEntry, AuditDecision, DecisionSource, IaAuditLog } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface AuditFilters extends PageQuery {
  appId: string
  userId: string
  /** 字典端点可下发新档位 → 放宽为 string(值域权威在服务端字典) */
  decisionSource: string
  decision: AuditDecision | ''
  toolFqn: string
  from: string
  to: string
}

/** decision_source 下拉选项形(值域以字典端点为准) */
export interface DecisionSourceOption {
  value: string
  label: string
  desc: string
}

/** decision_source 字典兜底(V22 真实码值 + V8 expired;「高危 100% 确认」的日志证明锚点) */
export const DECISION_SOURCES: Array<{ value: DecisionSource; label: string; desc: string }> = [
  { value: 'mode-default', label: '模式默认', desc: '按权限模式:只读直通/写确认' },
  { value: 'user-grant', label: '用户授权', desc: '命中用户「总是允许」授权' },
  { value: 'forced-policy', label: '强制策略', desc: '管理员策略覆盖(force-ask/deny 等)' },
  { value: 'live-confirm', label: '实时确认', desc: '用户在确认卡上批准/拒绝(T3b 实弹决策)' },
  { value: 'expired', label: '确认超时', desc: '确认等待超时系统裁决(过期=denied)' },
  { value: 'full-access', label: 'FULL_ACCESS', desc: '全放行模式(一次性确认已审计)' },
]

/** 字典项 → 下拉选项:已知码值沿用中文标签,新档位以 code 展示 + 服务端说明 */
function optionFor(entry: AuditDictionaryEntry): DecisionSourceOption {
  const known = DECISION_SOURCES.find(s => s.value === entry.code)
  return known ?? { value: entry.code, label: entry.code, desc: entry.description }
}

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
    /** decision_source 下拉选项(初始=共享常量,字典端点成功后覆盖) */
    sourceOptions: DECISION_SOURCES as DecisionSourceOption[],
    filters: {
      appId: '', userId: '', decisionSource: '', decision: '', toolFqn: '',
      from: '', to: '', pageNo: 1, pageSize: 10,
    } as AuditFilters,
  }),
  actions: {
    /** 字典端点(#12):值域以服务端下发为准;失败保持常量兜底不阻断查询 */
    async loadDictionary() {
      try {
        const dict = await auditAdminApi.dictionary()
        if (dict.decisionSources?.length) {
          this.sourceOptions = dict.decisionSources.map(optionFor)
        }
      } catch {
        // 字典端点不可用 → 保持共享常量
      }
    },
    async load() {
      this.loading = true
      try {
        const f = this.filters
        const appId = f.appId.trim() ? Number(f.appId.trim()) : undefined
        const userId = f.userId.trim() ? Number(f.userId.trim()) : undefined
        const page = await auditAdminApi.page({
          appId: appId !== undefined && !Number.isNaN(appId) ? appId : undefined,
          userId: userId !== undefined && !Number.isNaN(userId) ? userId : undefined,
          decisionSource: (f.decisionSource || undefined) as DecisionSource | undefined,
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
    /** 导出取数(#18):按当前筛选条件单次拉取(上限 1000 条)供 CSV 落盘 */
    async exportRows(): Promise<IaAuditLog[]> {
      const f = this.filters
      const appId = f.appId.trim() ? Number(f.appId.trim()) : undefined
      const userId = f.userId.trim() ? Number(f.userId.trim()) : undefined
      const page = await auditAdminApi.page({
        appId: appId !== undefined && !Number.isNaN(appId) ? appId : undefined,
        userId: userId !== undefined && !Number.isNaN(userId) ? userId : undefined,
        decisionSource: (f.decisionSource || undefined) as DecisionSource | undefined,
        decision: f.decision || undefined,
        toolFqn: f.toolFqn || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        pageNo: 1,
        pageSize: 1000,
      })
      return page.list
    },
  },
})
