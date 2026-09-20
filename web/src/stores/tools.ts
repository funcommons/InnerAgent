/**
 * [new] 工具注册与授权 store(视图清单 #3)。
 * 覆盖 ia_tool_registry(注册/刷新/停用/策略)与 ia_tool_grant(授予/撤销/失效展示)。
 */
import { defineStore } from 'pinia'
import { toolAdminApi, toolGrantAdminApi } from '@/api/admin'
import type {
  GrantScope,
  IaToolGrant,
  IaToolRegistry,
  ToolAdminPolicy,
  ToolRegisterReq,
  ToolRefreshResp,
  ToolRiskLevel,
} from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface ToolFilters extends PageQuery {
  keyword: string
  riskLevel: ToolRiskLevel | ''
  status: number | null
}

export interface GrantFilters extends PageQuery {
  toolFqn: string
  userId: string
  scope: GrantScope | ''
  includeInvalid: boolean
}

export const useToolsStore = defineStore('tools', {
  state: () => ({
    // 注册表
    tools: [] as IaToolRegistry[],
    toolsTotal: 0,
    toolsLoading: false,
    toolFilters: { keyword: '', riskLevel: '', status: null, pageNo: 1, pageSize: 10 } as ToolFilters,
    lastRefresh: null as ToolRefreshResp | null,
    // 授权
    grants: [] as IaToolGrant[],
    grantsTotal: 0,
    grantsLoading: false,
    grantFilters: { toolFqn: '', userId: '', scope: '', includeInvalid: true, pageNo: 1, pageSize: 10 } as GrantFilters,
  }),
  actions: {
    async loadTools() {
      this.toolsLoading = true
      try {
        const page = await toolAdminApi.page({
          keyword: this.toolFilters.keyword || undefined,
          riskLevel: this.toolFilters.riskLevel || undefined,
          status: this.toolFilters.status ?? undefined,
          pageNo: this.toolFilters.pageNo,
          pageSize: this.toolFilters.pageSize,
        })
        this.tools = page.list
        this.toolsTotal = page.total
      } finally {
        this.toolsLoading = false
      }
    },
    async register(req: ToolRegisterReq) {
      const resp = await toolAdminApi.register(req)
      await this.loadTools()
      return resp
    },
    async refresh(id: number) {
      this.lastRefresh = await toolAdminApi.refresh(id)
      await this.loadTools()
      return this.lastRefresh
    },
    async setEnabled(id: number, enabled: boolean) {
      const t = enabled ? await toolAdminApi.enable(id) : await toolAdminApi.disable(id)
      await Promise.all([this.loadTools(), this.loadGrants()]) // 停用级联失效授权,双列表都要刷
      return t
    },
    async updatePolicy(id: number, req: { riskLevel?: ToolRiskLevel; adminPolicy?: ToolAdminPolicy; resumeSafe?: boolean }) {
      const t = await toolAdminApi.updatePolicy(id, req)
      await Promise.all([this.loadTools(), this.loadGrants()])
      return t
    },
    async loadGrants() {
      this.grantsLoading = true
      try {
        const page = await toolGrantAdminApi.page({
          toolFqn: this.grantFilters.toolFqn || undefined,
          userId: this.grantFilters.userId || undefined,
          scope: this.grantFilters.scope || undefined,
          includeInvalid: this.grantFilters.includeInvalid,
          pageNo: this.grantFilters.pageNo,
          pageSize: this.grantFilters.pageSize,
        })
        this.grants = page.list
        this.grantsTotal = page.total
      } finally {
        this.grantsLoading = false
      }
    },
    async grant(req: { userId: string; toolFqn: string; scope: GrantScope }) {
      const g = await toolGrantAdminApi.grant(req)
      await this.loadGrants()
      return g
    },
    async revoke(id: number) {
      await toolGrantAdminApi.revoke(id)
      await this.loadGrants()
    },
  },
})

export const RISK_LEVELS: Array<{ value: ToolRiskLevel; label: string; tag: 'info' | 'warning' | 'danger' | 'error' }> = [
  { value: 'low', label: '低危', tag: 'info' },
  { value: 'medium', label: '中危', tag: 'warning' },
  { value: 'high', label: '高危', tag: 'danger' },
  { value: 'critical', label: '严重', tag: 'error' },
]

export const ADMIN_POLICIES: Array<{ value: ToolAdminPolicy; label: string; desc: string }> = [
  { value: 'default', label: '默认(按模式)', desc: '跟随权限模式:只读直通,写操作确认' },
  { value: 'force-ask', label: '强制确认', desc: '每次必确认,不可被任何授权绕过' },
  { value: 'force-allow', label: '强制放行', desc: '自动执行(仅低风险场景,留审计)' },
  { value: 'deny', label: '拒绝', desc: '一律拒绝调用' },
]

export const GRANT_INVALID_REASONS: Record<string, string> = {
  'risk-upgraded': '风险等级升级',
  'schema-changed': 'schema 安全相关变更',
  'tool-disabled': '工具已停用',
}
