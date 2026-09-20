/**
 * [new] 工具注册与授权 store(视图清单 #3)。
 * 覆盖 ia_tool_registry(注册/活刷新分诊/confirm|reject/启停/治理元数据)
 * 与 ia_tool_grant(授予/撤销/失效展示)。
 * P2 对齐:服务端 tools/grants 列表返回全量数组(无分页),keyword/风险级等
 * 过滤与分页在客户端完成;授权过滤按真实 query 形(toolName/scope/activeOnly)。
 */
import { defineStore } from 'pinia'
import { toolAdminApi, toolGrantAdminApi } from '@/api/admin'
import type {
  GrantInvalidatedReason,
  GrantScope,
  IaToolGrant,
  IaToolRegistry,
  ToolAdminPolicy,
  ToolAnnotations,
  ToolRegisterReq,
  ToolTriageResp,
  ToolRiskLevel,
  ToolUpdateReq,
} from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface ToolFilters extends PageQuery {
  keyword: string
  riskLevel: ToolRiskLevel | ''
  enabled: boolean | null
}

export interface GrantFilters extends PageQuery {
  toolName: string
  /** 输入为字符串,查询时转 number */
  userId: string
  scope: GrantScope | ''
  /** true → 下发 activeOnly=false(服务端默认仅有效授权) */
  includeInvalid: boolean
}

export const useToolsStore = defineStore('tools', {
  state: () => ({
    // 注册表
    tools: [] as IaToolRegistry[],
    toolsTotal: 0,
    toolsLoading: false,
    toolFilters: { keyword: '', riskLevel: '', enabled: null, pageNo: 1, pageSize: 10 } as ToolFilters,
    lastTriage: null as ToolTriageResp | null,
    // 授权
    grants: [] as IaToolGrant[],
    grantsTotal: 0,
    grantsLoading: false,
    grantFilters: { toolName: '', userId: '', scope: '', includeInvalid: true, pageNo: 1, pageSize: 10 } as GrantFilters,
  }),
  actions: {
    async loadTools() {
      this.toolsLoading = true
      try {
        const all = await toolAdminApi.list()
        const kw = this.toolFilters.keyword.trim()
        let filtered = all
        if (kw) filtered = filtered.filter(t => t.toolName.includes(kw) || t.fqn.includes(kw) || (t.description ?? '').includes(kw))
        if (this.toolFilters.riskLevel) filtered = filtered.filter(t => t.riskLevel === this.toolFilters.riskLevel)
        if (this.toolFilters.enabled !== null) filtered = filtered.filter(t => t.enabled === this.toolFilters.enabled)
        this.toolsTotal = filtered.length
        const pageNo = this.toolFilters.pageNo ?? 1
        const pageSize = this.toolFilters.pageSize ?? 10
        const start = (pageNo - 1) * pageSize
        this.tools = filtered.slice(start, start + pageSize)
      } finally {
        this.toolsLoading = false
      }
    },
    async register(req: ToolRegisterReq) {
      const entry = await toolAdminApi.register(req)
      await this.loadTools()
      return entry
    },
    /** 活刷新分诊(宿主重发 schema;verdict=unchanged/compatible/breaking) */
    async refreshSchema(id: number, req: { parametersSchema?: string; annotationsJson?: string; toolVersion?: string } = {}) {
      this.lastTriage = await toolAdminApi.refreshSchema(id, req)
      await Promise.all([this.loadTools(), this.loadGrants()]) // breaking 会级联失效授权
      return this.lastTriage
    },
    async confirmSchema(id: number) {
      const t = await toolAdminApi.confirmSchema(id)
      await Promise.all([this.loadTools(), this.loadGrants()])
      return t
    },
    async rejectSchema(id: number) {
      const t = await toolAdminApi.rejectSchema(id)
      await this.loadTools()
      return t
    },
    async setEnabled(id: number, enabled: boolean) {
      const t = enabled ? await toolAdminApi.enable(id) : await toolAdminApi.disable(id)
      await Promise.all([this.loadTools(), this.loadGrants()]) // 停用级联失效授权,双列表都要刷
      return t
    },
    /** 更新治理元数据(风险升级级联失效授权) */
    async updateTool(id: number, req: ToolUpdateReq) {
      const t = await toolAdminApi.update(id, req)
      await Promise.all([this.loadTools(), this.loadGrants()])
      return t
    },
    /** schema 指纹变更历史(V14 留痕) */
    async schemaHistory(id: number) {
      return toolAdminApi.schemaHistory(id)
    },
    async loadGrants() {
      this.grantsLoading = true
      try {
        const f = this.grantFilters
        const userId = f.userId.trim() ? Number(f.userId.trim()) : undefined
        const all = await toolGrantAdminApi.list({
          toolName: f.toolName.trim() || undefined,
          userId: userId !== undefined && !Number.isNaN(userId) ? userId : undefined,
          scope: f.scope || undefined,
          activeOnly: f.includeInvalid ? false : undefined, // 服务端默认 true
        })
        this.grantsTotal = all.length
        const pageNo = f.pageNo ?? 1
        const pageSize = f.pageSize ?? 10
        const start = (pageNo - 1) * pageSize
        this.grants = all.slice(start, start + pageSize)
      } finally {
        this.grantsLoading = false
      }
    },
    async grant(req: { userId: number; toolName: string; scope: GrantScope; conversationId?: string; decisionNote?: string }) {
      const g = await toolGrantAdminApi.grant(req)
      await this.loadGrants()
      return g
    },
    async revoke(id: number, decisionNote?: string) {
      await toolGrantAdminApi.revoke(id, decisionNote ? { decisionNote } : undefined)
      await this.loadGrants()
    },
  },
})

/** 解析 annotationsJson 为注解对象(展示用;解析失败返回 null) */
export function parseAnnotations(json: string | null): ToolAnnotations | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Partial<ToolAnnotations>
    return {
      readOnlyHint: parsed.readOnlyHint ?? null,
      destructiveHint: parsed.destructiveHint ?? null,
      idempotentHint: parsed.idempotentHint ?? null,
      openWorldHint: parsed.openWorldHint ?? null,
    }
  } catch {
    return null
  }
}

export const RISK_LEVELS: Array<{ value: ToolRiskLevel; label: string; tag: 'info' | 'warning' | 'danger' }> = [
  { value: 'low', label: '低危', tag: 'info' },
  { value: 'medium', label: '中危', tag: 'warning' },
  { value: 'high', label: '高危', tag: 'danger' },
]

/** 管理员策略(NULL=不强制,真实形无 'default' 值) */
export const ADMIN_POLICIES: Array<{ value: ToolAdminPolicy | null; label: string; desc: string }> = [
  { value: null, label: '默认(不强制)', desc: '跟随权限模式:只读直通,写操作确认' },
  { value: 'force-ask', label: '强制确认', desc: '每次必确认,不可被任何授权绕过' },
  { value: 'force-allow', label: '强制放行', desc: '自动执行(仅低风险场景,留审计)' },
  { value: 'deny', label: '拒绝', desc: '一律拒绝调用' },
]

export const GRANT_INVALID_REASONS: Record<GrantInvalidatedReason, string> = {
  'risk_upgrade': '风险等级升级',
  'schema_breaking': 'schema 安全相关变更(breaking)',
  'tool_disabled': '工具已停用',
  'tool_deleted': '工具已注销',
}
