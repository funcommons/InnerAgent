/**
 * [new] mini 知识库 store(P4-W14,视图清单 #10)。
 * 覆盖 AdminKbController:文本导入/分页列表/更新(带 content 即重分块)/
 * 状态门控(activate|deactivate)/rebuild-index/删除/检索调试(search)。
 */
import { defineStore } from 'pinia'
import { kbAdminApi } from '@/api/admin'
import type {
  IaKbDocument,
  KbDocumentImportReq,
  KbDocumentUpdateReq,
  KbSearchDebugView,
} from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface KbFilters extends PageQuery {
  /** 客户端状态过滤(all=不过滤;服务端无 status 参数) */
  status: 'all' | 'active' | 'inactive'
  keyword: string
}

export const useKbStore = defineStore('kb', {
  state: () => ({
    list: [] as IaKbDocument[],
    total: 0,
    loading: false,
    filters: { status: 'all', keyword: '', pageNo: 1, pageSize: 10 } as KbFilters,
    /** 最近一次检索调试结果(小工具展示) */
    lastSearch: null as KbSearchDebugView | null,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const page = await kbAdminApi.page({ pageNo: this.filters.pageNo, pageSize: this.filters.pageSize })
        // 客户端过滤(服务端无 status/keyword 参数;镜像 tools 页 keyword 先例)
        let rows = page.list
        if (this.filters.status !== 'all') rows = rows.filter(d => d.status === this.filters.status)
        const kw = this.filters.keyword.trim()
        if (kw) rows = rows.filter(d => d.title.includes(kw) || (d.source ?? '').includes(kw))
        this.list = rows
        this.total = page.total
      } finally {
        this.loading = false
      }
    },
    search() {
      this.filters.pageNo = 1
      return this.load()
    },
    async importDocument(req: KbDocumentImportReq): Promise<IaKbDocument> {
      const row = await kbAdminApi.importDocument(req)
      await this.load()
      return row
    },
    async updateDocument(id: number, req: KbDocumentUpdateReq): Promise<IaKbDocument> {
      const row = await kbAdminApi.update(id, req)
      await this.load()
      return row
    },
    async setStatus(id: number, active: boolean): Promise<IaKbDocument> {
      const row = active ? await kbAdminApi.activate(id) : await kbAdminApi.deactivate(id)
      await this.load()
      return row
    },
    /** 重建索引(search-config 变更或降级恢复后执行) */
    async rebuildIndex(id: number): Promise<IaKbDocument> {
      const row = await kbAdminApi.rebuildIndex(id)
      await this.load()
      return row
    },
    async remove(id: number): Promise<void> {
      await kbAdminApi.remove(id)
      await this.load()
    },
    /** 检索调试(top-k 命中与来源;结果同时存 lastSearch 供视图展示) */
    async searchDebug(q: string, topK?: number): Promise<KbSearchDebugView> {
      this.lastSearch = await kbAdminApi.search({ q, topK })
      return this.lastSearch
    },
  },
})
