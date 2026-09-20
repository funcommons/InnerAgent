/**
 * [new] 应用管理 store:列表/筛选/CRUD/公钥登记与轮换。
 * 视图清单 #2(ia_app)。P2 对齐:服务端列表返回全量数组(无分页/过滤),
 * 关键字/状态过滤与分页在客户端完成;公钥登记/轮换统一走 PUT signPublicKey。
 */
import { defineStore } from 'pinia'
import { appAdminApi } from '@/api/admin'
import { ApiError } from '@/api/errorCodes'
import type { IaApp, IaAppCreateReq, IaAppUpdateReq } from '@/api/types'
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
        const all = await appAdminApi.list()
        const kw = this.filters.keyword.trim()
        let filtered = all
        if (kw) filtered = filtered.filter(a => a.name.includes(kw) || a.appKey.includes(kw))
        if (this.filters.status !== null) filtered = filtered.filter(a => a.status === this.filters.status)
        this.total = filtered.length
        const pageNo = this.filters.pageNo ?? 1
        const pageSize = this.filters.pageSize ?? 10
        const start = (pageNo - 1) * pageSize
        this.list = filtered.slice(start, start + pageSize)
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
    /**
     * 公钥登记/轮换(同一端点 PUT signPublicKey;V9 双公钥宽限期语义,
     * 响应回 signKeyFingerprint/signKeyRotatedAt,同值重复 PUT 不算轮换)。
     */
    async updateSignKey(id: number, signPublicKey: string): Promise<IaApp> {
      const app = await appAdminApi.updateSignKey(id, signPublicKey)
      await this.load()
      return app
    },
    /** 注销应用(逻辑删除) */
    async remove(id: number): Promise<void> {
      await appAdminApi.remove(id)
      await this.load()
    },
  },
})

/** PEM 公钥宽松校验:必须含 BEGIN/END PUBLIC KEY 包裹(UI 层校验,服务端 RSA 解析为准) */
export function isValidPemPublicKey(pem: string): boolean {
  return pem.includes('-----BEGIN PUBLIC KEY-----') && pem.includes('-----END PUBLIC KEY-----')
}

/** 业务错误 → 人类可读文案(视图共用) */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback
  return fallback
}
