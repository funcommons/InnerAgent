/**
 * [new] 应用管理 store:列表/筛选/CRUD/公钥登记与轮换。
 * 视图清单 #2(ia_app)。
 */
import { defineStore } from 'pinia'
import { appAdminApi } from '@/api/admin'
import { ApiError } from '@/api/errorCodes'
import type { IaApp, IaAppCreateReq, IaAppPublicKeyResp, IaAppUpdateReq } from '@/api/types'
import type { PageQuery } from '@/api/common'

export interface AppFilters extends PageQuery {
  keyword: string
  status: number | null
}

export const useAppsStore = defineStore('apps', {
  state: () => ({
    list: [] as IaApp[],
    total: 0,
    loading: false,
    filters: { keyword: '', status: null, pageNo: 1, pageSize: 10 } as AppFilters,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const page = await appAdminApi.page({
          keyword: this.filters.keyword || undefined,
          status: this.filters.status ?? undefined,
          pageNo: this.filters.pageNo,
          pageSize: this.filters.pageSize,
        })
        this.list = page.list
        this.total = page.total
      } finally {
        this.loading = false
      }
    },
    async create(req: IaAppCreateReq): Promise<IaApp> {
      const app = await appAdminApi.create(req)
      await this.load()
      return app
    },
    async update(id: number, req: IaAppUpdateReq): Promise<IaApp> {
      const app = await appAdminApi.update(id, req)
      await this.load()
      return app
    },
    async registerPublicKey(id: number, publicKey: string): Promise<IaAppPublicKeyResp> {
      return appAdminApi.registerPublicKey(id, { publicKey })
    },
    async rotateKey(id: number, publicKey: string): Promise<IaAppPublicKeyResp> {
      return appAdminApi.rotateKey(id, { publicKey })
    },
  },
})

/** PEM 公钥宽松校验:必须含 BEGIN/END PUBLIC KEY 包裹(UI 层校验,服务端为准) */
export function isValidPemPublicKey(pem: string): boolean {
  return pem.includes('-----BEGIN PUBLIC KEY-----') && pem.includes('-----END PUBLIC KEY-----')
}

/** 业务错误 → 人类可读文案(视图共用) */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback
  return fallback
}
