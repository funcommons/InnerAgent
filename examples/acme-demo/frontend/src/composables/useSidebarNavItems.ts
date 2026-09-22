/**
 * useSidebarNavItems — 项目侧 nav 工厂 (基于 SDK 底座).
 *
 * DEMO 侧栏:"InnerAgent 接入" 四入口(总览/场景画廊/嵌入/工具)+ "开发者" 脚手架能力展示 + "返回官网".
 */
import { computed, type ComputedRef } from 'vue'
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Compass, Film, Grid, House, Setting, Tools, VideoPlay } from '@element-plus/icons-vue'
import type { NavItem } from '@/components/sdk'

/** 默认展开的 sub-menu id 列表 (无 sub-menu 时为空数组) */
export const NAV_DEFAULT_OPENEDS: string[] = []

export function useSidebarNavItems(): ComputedRef<NavItem[]> {
  const { t } = useI18n()
  return computed<NavItem[]>(() => [
    {
      index: '/ia/overview',
      label: t('router.ia-overview'),
      icon: Compass as unknown as Component,
    },
    {
      index: '/ia/agents',
      label: t('router.ia-agents'),
      icon: Grid as unknown as Component,
    },
    {
      index: '/ia/agent-admin',
      label: t('router.ia-agent-admin'),
      icon: Setting as unknown as Component,
    },
    {
      index: '/ia/embed',
      label: t('router.ia-embed'),
      icon: VideoPlay as unknown as Component,
    },
    {
      index: '/ia/tools',
      label: t('router.ia-tools'),
      icon: Film as unknown as Component,
    },
    {
      index: '/dev',
      label: t('router.dev-index'),
      icon: Tools as unknown as Component,
    },
    {
      // 控制台 ↔ 公开官网的一致返回入口(公开区顶部导航则有「进入控制台」)
      index: '/',
      label: t('router.back-to-site'),
      icon: House as unknown as Component,
    },
  ])
}
