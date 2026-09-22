/**
 * [new] 管理面应用上下文 store(2026-09-23,配套服务端 Skill/KB 管理面显式 appId 面)。
 *
 * 顶栏切换器决定 Skill 管理/知识库/用量统计/用户反馈四个应用级视图的数据范围;
 * 选中应用持久化 localStorage,失效 id(应用被删/换库)回落缺省应用 1。
 * 定义/工具等聚合视角视图不经此 store(它们本就跨应用/自带过滤)。
 */
import { defineStore } from 'pinia'
import { appAdminApi } from '@/api/admin'
import type { IaApp } from '@/api/types'

const STORAGE_KEY = 'ia-admin:app-id'

function readStoredId(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const id = raw !== null ? Number(raw) : NaN
    return Number.isInteger(id) && id > 0 ? id : 1
  } catch {
    return 1
  }
}

export const useAppContextStore = defineStore('appContext', {
  state: () => ({
    apps: [] as IaApp[],
    currentAppId: readStoredId(),
    loading: false,
  }),
  getters: {
    current(state): IaApp | null {
      return state.apps.find((a) => a.id === state.currentAppId) ?? null
    },
  },
  actions: {
    async loadApps() {
      this.loading = true
      try {
        this.apps = await appAdminApi.list()
        // 持久化的 id 已失效(应用被删/换库)→ 回落缺省应用,保证视图不落空
        if (!this.apps.some((a) => a.id === this.currentAppId)) {
          this.currentAppId = this.apps.some((a) => a.id === 1) ? 1 : (this.apps[0]?.id ?? 1)
          this.persist()
        }
      } finally {
        this.loading = false
      }
    },
    selectApp(id: number) {
      this.currentAppId = id
      this.persist()
    },
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, String(this.currentAppId))
      } catch {
        /* localStorage 不可用则仅内存态(与 user store 兜底同形) */
      }
    },
  },
})
