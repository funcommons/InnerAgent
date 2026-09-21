/**
 * [new] Agent 定义管理 store(视图清单 #7,P2-W5 定义管理域)。
 * 覆盖 AdminAgentDefinitionController:分页列表(端点缺省即分页形)/详情/
 * 提示词单槽编辑(旧值快照落审计 definition-updated · admin)/export bundle/
 * import(conflictPolicy skip|overwrite,dryRun 预演零副作用)。
 * 数据落 ia_agent_definition;运行内核仍读代码注册表(数据驱动内核切换属
 * 后续批次,管理面编辑仅落库+审计留痕)。
 */
import { defineStore } from 'pinia'
import { definitionAdminApi } from '@/api/admin'
import type {
  DefinitionBundle,
  DefinitionConflictPolicy,
  DefinitionImportReq,
  DefinitionImportResult,
  DefinitionPromptSlot,
  IaAgentDefinition,
} from '@/api/types'

/** 提示词三槽元数据(编辑器按 slot 分:systemPrompt 必填不可清空,其余空白=清空) */
export const PROMPT_SLOT_META: Array<{
  slot: DefinitionPromptSlot
  label: string
  hint: string
  required: boolean
}> = [
  { slot: 'systemPrompt', label: '系统提示词(systemPrompt)', hint: '定义不可无系统提示词:服务端强制非空白(65536 字符上限)', required: true },
  { slot: 'instructionTemplate', label: '指令模板(instructionTemplate)', hint: '可空=清空该槽(列语义「未配置」)', required: false },
  { slot: 'greeting', label: '问候语(greeting)', hint: '可空=清空该槽(列语义「未配置」)', required: false },
]

/** kind 展示元数据(V1 DDL CHECK:被 subAgentTools 引用者为 sub) */
export const DEFINITION_KIND_META: Record<string, { label: string; tag: 'primary' | 'info' }> = {
  main: { label: '主定义', tag: 'primary' },
  sub: { label: '子代理', tag: 'info' },
}

export const useDefinitionsStore = defineStore('definitions', {
  state: () => ({
    list: [] as IaAgentDefinition[],
    total: 0,
    loading: false,
    pageNo: 1,
    pageSize: 10,
    /** 导入预演结果(dryRun=true 零副作用)与正式导入结果分存,预演后可确认 */
    lastPreview: null as DefinitionImportResult | null,
    lastImport: null as DefinitionImportResult | null,
  }),
  actions: {
    /** 分页列表(agentKey 升序;出参含提示词三槽与规格 spec) */
    async load() {
      this.loading = true
      try {
        const page = await definitionAdminApi.page({ pageNo: this.pageNo, pageSize: this.pageSize })
        this.list = page.list
        this.total = page.total
      } finally {
        this.loading = false
      }
    },
    search() {
      this.pageNo = 1
      return this.load()
    },
    /** 详情(GET /{id};抽屉打开时回读最新行) */
    async get(id: number) {
      return definitionAdminApi.get(id)
    },
    /**
     * 编辑提示词槽位(PUT /{id}/prompt):systemPrompt 必须非空白、65536 上限,
     * 其余槽位空白=清空;旧值快照进审计入参(decision=definition-updated,
     * source=admin,ia_audit_log 仅追加)。完成后刷新当前页。
     */
    async updatePrompt(id: number, slot: DefinitionPromptSlot, content: string) {
      const row = await definitionAdminApi.updatePrompt(id, { slot, content })
      await this.load()
      return row
    },
    /** 导出 bundle(ids 缺省=该应用全量;选行导出走 ids) */
    async exportBundle(ids?: number[]): Promise<DefinitionBundle> {
      return definitionAdminApi.export(ids ? { ids } : {})
    },
    /**
     * 导入 bundle(dryRun=true 只出预览零副作用;结果 {created,updated,
     * skipped,errors[]};导入落审计 definition-imported/definition-updated)。
     */
    async importBundle(req: DefinitionImportReq): Promise<DefinitionImportResult> {
      const result = await definitionAdminApi.import(req)
      if (req.dryRun) {
        this.lastPreview = result
      } else {
        this.lastImport = result
        await this.load() // 正式导入落库 → 刷新当前页
      }
      return result
    },
    /** 由 bundle JSON 文本构造导入请求体(JSON 解析由调用方兜底报错) */
    buildImportReq(bundle: unknown, conflictPolicy: DefinitionConflictPolicy, dryRun: boolean): DefinitionImportReq {
      return { bundle, conflictPolicy, dryRun }
    },
  },
})
