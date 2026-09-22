/**
 * [new] Skill 目录 store(P4-W13,视图清单 #9)。
 * 覆盖 AdminSkillController:zip 预览(dryRun 零落库)/确认导入(服务端重校验,
 * overwrite 覆盖同名活跃行)/分页列表/激活(应用内上限 8,超限 409)/停用/删除。
 * 预览与确认分存(镜像 definitions store 的 lastPreview/lastImport 范式)。
 * 2026-09-23:数据范围随管理面应用上下文(store/appContext,顶栏切换器)。
 */
import { defineStore } from 'pinia'
import { skillAdminApi } from '@/api/admin'
import { useAppContextStore } from '@/stores/appContext'
import type { IaSkill, SkillPreviewView } from '@/api/types'

export const useSkillsStore = defineStore('skills', {
  state: () => ({
    list: [] as IaSkill[],
    total: 0,
    loading: false,
    pageNo: 1,
    pageSize: 10,
    /** 最近一次预览结果(dryRun 零副作用,确认导入前核对) */
    lastPreview: null as SkillPreviewView | null,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        const page = await skillAdminApi.page({
          appId: useAppContextStore().currentAppId,
          pageNo: this.pageNo,
          pageSize: this.pageSize,
        })
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
    /** zip 预览校验(dryRun 零落库;invalid 仍正常返回,问题清单看 errors) */
    async preview(file: File | Blob, fileName: string): Promise<SkillPreviewView> {
      this.lastPreview = await skillAdminApi.preview(file, fileName)
      return this.lastPreview
    },
    /** 确认导入(服务端重校验;overwrite=true 覆盖同名活跃行;成功后刷新列表) */
    async importSkill(opts: { file: File | Blob; fileName: string; displayName?: string; overwrite?: boolean }): Promise<IaSkill> {
      const row = await skillAdminApi.importSkill({
        ...opts,
        appId: useAppContextStore().currentAppId,
      })
      await this.load()
      return row
    },
    /** 激活(应用内同时上限 8,超限 409 由调用方以 apiErrorMessage 呈现) */
    async activate(id: number): Promise<IaSkill> {
      const row = await skillAdminApi.activate(id)
      await this.load()
      return row
    },
    async deactivate(id: number): Promise<IaSkill> {
      const row = await skillAdminApi.deactivate(id)
      await this.load()
      return row
    },
    async remove(id: number): Promise<void> {
      await skillAdminApi.remove(id)
      await this.load()
    },
  },
})
