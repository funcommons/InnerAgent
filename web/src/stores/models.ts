/**
 * [new] 模型配置 store(视图清单 #5,ia_model_api_config)。
 */
import { defineStore } from 'pinia'
import { modelConfigAdminApi } from '@/api/admin'
import type { IaModelApiConfig, ModelApiConfigSaveReq, ModelConnectivityResult, ModelPlatform } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface ModelFilters extends PageQuery {
  name: string
  platform: ModelPlatform | ''
  status: number | null
}

export const useModelsStore = defineStore('models', {
  state: () => ({
    list: [] as IaModelApiConfig[],
    total: 0,
    loading: false,
    filters: { name: '', platform: '', status: null, pageNo: 1, pageSize: 10 } as ModelFilters,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const f = this.filters
        const page = await modelConfigAdminApi.page({
          name: f.name || undefined,
          platform: f.platform || undefined,
          status: f.status ?? undefined,
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
    async save(req: ModelApiConfigSaveReq): Promise<IaModelApiConfig> {
      const saved = req.id
        ? await modelConfigAdminApi.update(req.id, req)
        : await modelConfigAdminApi.create(req)
      await this.load()
      return saved
    },
    async remove(id: number) {
      await modelConfigAdminApi.delete(id)
      await this.load()
    },
    async test(id: number): Promise<ModelConnectivityResult> {
      return modelConfigAdminApi.test(id)
    },
  },
})
