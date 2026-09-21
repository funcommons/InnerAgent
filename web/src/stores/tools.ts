/**
 * [new] 工具注册与授权 store(视图清单 #3)。
 * 覆盖 ia_tool_registry(注册/活刷新分诊/confirm|reject/启停/治理元数据/
 * 工具体检 V17)与 ia_tool_grant(授予/撤销/失效展示)。
 * P2-W5 分页兼容形:列表主动传 pageNo/pageSize 走服务端 PageResult(activeOnly
 * 下推 SQL);keyword/风险级无服务端参数 → 走数组兼容形全量取回后客户端过滤
 * 分页(总数保持真实)。代授下拉全集用数组兼容形(page 形只回当前页)。
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
  ToolCheckBatchReceipt,
  ToolCheckResult,
  ToolHealthCheckItem,
  ToolHealthStatus,
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
    /** 代授下拉全集(数组兼容形;独立于分页列表) */
    grantable: [] as IaToolRegistry[],
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
        const f = this.toolFilters
        const keyword = f.keyword.trim()
        if (keyword || f.riskLevel) {
          // keyword/风险级无服务端参数:数组兼容形全量取回 → 客户端过滤分页
          const all = await toolAdminApi.list({ enabled: f.enabled ?? undefined })
          let filtered = all
          if (keyword) filtered = filtered.filter(t => t.toolName.includes(keyword) || t.fqn.includes(keyword) || (t.description ?? '').includes(keyword))
          if (f.riskLevel) filtered = filtered.filter(t => t.riskLevel === f.riskLevel)
          this.toolsTotal = filtered.length
          const pageNo = f.pageNo ?? 1
          const pageSize = f.pageSize ?? 10
          const start = (pageNo - 1) * pageSize
          this.tools = filtered.slice(start, start + pageSize)
        } else {
          // 服务端分页形(P2-W5:pageNo/pageSize 任一下发即 PageResult)
          const page = await toolAdminApi.page({
            enabled: f.enabled ?? undefined,
            pageNo: f.pageNo ?? 1,
            pageSize: f.pageSize ?? 10,
          })
          this.tools = page.list
          this.toolsTotal = page.total
        }
      } finally {
        this.toolsLoading = false
      }
    },
    /** 工具详情(GET /tools/{id};详情抽屉用,回读含体检三列的最新行) */
    async getTool(id: number) {
      return toolAdminApi.get(id)
    },
    /** 代授下拉全集(数组兼容形全量;仅启用且未注销) */
    async loadGrantable() {
      const all = await toolAdminApi.list()
      this.grantable = all.filter(t => t.enabled && !t.deleted)
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
    /**
     * 工具体检(V17,单工具同步):可达/清单/指纹/注解四项矩阵,结论与
     * 明细落库;完成后刷新列表(当前页回填最新体检位)。
     */
    async checkHealth(id: number): Promise<ToolCheckResult> {
      const result = await toolAdminApi.checkHealth(id)
      await this.loadTools()
      return result
    },
    /** 批量/全量体检(异步受理回执;结果落各自注册行,由 UI 延时/手动刷新可查) */
    async checkHealthBatch(ids?: number[]): Promise<ToolCheckBatchReceipt> {
      return toolAdminApi.checkHealthBatch(ids)
    },
    async loadGrants() {
      this.grantsLoading = true
      try {
        const f = this.grantFilters
        const userId = f.userId.trim() ? Number(f.userId.trim()) : undefined
        // 服务端分页形(P2-W5):activeOnly 下推 SQL 条件,分页计数与过滤一致
        const page = await toolGrantAdminApi.page({
          toolName: f.toolName.trim() || undefined,
          userId: userId !== undefined && !Number.isNaN(userId) ? userId : undefined,
          scope: f.scope || undefined,
          activeOnly: f.includeInvalid ? false : undefined, // 服务端默认 true
          pageNo: f.pageNo ?? 1,
          pageSize: f.pageSize ?? 10,
        })
        this.grants = page.list
        this.grantsTotal = page.total
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

/** 体检明细 JSON 解析形({"status","checks":[{check,status,detail?,advice?}]}) */
export interface ToolHealthDetail {
  status: ToolHealthStatus | string
  checks: ToolHealthCheckItem[]
}

/**
 * 解析 ia_tool_registry.health_detail_json(镜像 ToolHealthService.detailJson);
 * null/空/解析失败 → null(与「未体检」同视图)。
 */
export function parseHealthDetail(json: string | null | undefined): ToolHealthDetail | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Partial<ToolHealthDetail>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.checks)) return null
    return { status: parsed.status ?? 'unknown', checks: parsed.checks }
  } catch {
    return null
  }
}

/** 体检三态徽标元数据(V17:绿=ok/黄=degraded/红=unreachable;NULL=未体检灰) */
export const HEALTH_META: Record<string, { label: string; tag: 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: '健康', tag: 'success' },
  degraded: { label: '漂移', tag: 'warning' },
  unreachable: { label: '不可达', tag: 'danger' },
}

/** 检查项码值 → 展示名(镜像 ToolHealthService 检查矩阵) */
export const HEALTH_CHECK_LABELS: Record<string, string> = {
  endpoint_reachable: '端点可达',
  tool_present: '宿主清单',
  schema_fingerprint: 'schema 指纹',
  annotations_diff: '注解一致',
}
