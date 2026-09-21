import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/store/user'
import { isFeatureEnabled, type FeatureKey } from '@/config/features'
import { useEmbedParams } from '@/composables/useEmbedParams'
import i18n from '@/locales'
import { ElMessageBox } from 'element-plus'

const t = i18n.global.t

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { title: 'router.login', public: true, hideInMenu: true, layout: 'blank' }
  },
  {
    path: '/logout',
    name: 'Logout',
    component: () => import('@/views/auth/Logout.vue'),
    meta: { title: 'router.logout', public: true, hideInMenu: true, layout: 'blank' }
  },
  // —— 公开官网区(无需登录): 产品首页 / 文档中心 / API 体验台 ——
  {
    path: '/',
    component: () => import('@/layout/PublicLayout.vue'),
    meta: { layout: 'public', public: true },
    children: [
      {
        path: '',
        name: 'SiteHome',
        component: () => import('@/views/site/Home.vue'),
        meta: { title: 'router.site-home', desc: 'seo.home-desc', public: true }
      },
      {
        path: 'docs/:sectionId?',
        name: 'SiteDocs',
        component: () => import('@/views/site/Docs.vue'),
        meta: { title: 'router.site-docs', desc: 'seo.docs-desc', public: true }
      },
      {
        path: 'playground',
        name: 'SitePlayground',
        component: () => import('@/views/site/Playground.vue'),
        meta: { title: 'router.playground', desc: 'seo.playground-desc', public: true }
      }
    ]
  },
  // —— InnerAgent 接入 DEMO 三页 — AppLayout 侧栏 ——
  {
    path: '/ia',
    component: () => import('@/layout/AppLayout.vue'),
    children: [
      {
        path: '',
        redirect: '/ia/overview'
      },
      {
        path: 'overview',
        name: 'IaOverview',
        component: () => import('@/views/ia/Overview.vue'),
        meta: { title: 'router.ia-overview', icon: 'Compass' }
      },
      {
        path: 'agents',
        name: 'IaAgents',
        component: () => import('@/views/ia/AgentsGallery.vue'),
        meta: { title: 'router.ia-agents', icon: 'Grid' }
      },
      {
        path: 'embed',
        name: 'IaEmbed',
        component: () => import('@/views/ia/EmbedChat.vue'),
        meta: { title: 'router.ia-embed', icon: 'VideoPlay' }
      },
      {
        path: 'tools',
        name: 'IaTools',
        component: () => import('@/views/ia/ToolsBoard.vue'),
        meta: { title: 'router.ia-tools', icon: 'Film' }
      }
    ]
  },
  // —— /dev 演示页 (脚手架能力展示) — AppLayout 侧栏, URL 保持 /dev/* ——
  {
    path: '/dev',
    component: () => import('@/layout/AppLayout.vue'),
    children: [
      {
        path: '',
        name: 'DevIndex',
        component: () => import('@/views/dev/index.vue'),
        meta: { title: 'router.dev-index', icon: 'Tools', feature: 'dev' }
      },
      {
        path: 'inspiration',
        name: 'DevInspiration',
        component: () => import('@/views/dev/InspirationDemo.vue'),
        meta: { title: 'router.dev-inspiration', hideInMenu: true }
      },
      {
        path: 'users',
        name: 'DevUsers',
        component: () => import('@/views/dev/UsersDemo.vue'),
        meta: { title: 'router.dev-users', hideInMenu: true }
      },
      {
        path: 'statistics',
        name: 'DevStatistics',
        component: () => import('@/views/dev/StatisticsDemo.vue'),
        meta: { title: 'router.dev-statistics', hideInMenu: true }
      },
      {
        path: 'workspace',
        name: 'DevWorkspace',
        component: () => import('@/views/dev/WorkspaceDemo.vue'),
        meta: { title: 'router.dev-workspace', hideInMenu: true }
      },
      {
        path: 'profile',
        name: 'DevProfile',
        component: () => import('@/views/dev/ProfileDemo.vue'),
        meta: { title: 'router.dev-profile', hideInMenu: true }
      },
      {
        path: 'creator',
        name: 'DevCreator',
        component: () => import('@/views/dev/CreatorDemo.vue'),
        meta: { title: 'router.dev-creator', hideInMenu: true }
      },
      {
        path: 'detail',
        name: 'DevDetail',
        component: () => import('@/views/dev/DetailDemo.vue'),
        meta: { title: 'router.dev-detail', hideInMenu: true }
      },
      {
        path: 'templates',
        name: 'DevTemplates',
        component: () => import('@/views/dev/TemplatesDemo.vue'),
        meta: { title: 'router.dev-templates', hideInMenu: true }
      },
      {
        path: 'chat',
        name: 'DevChat',
        component: () => import('@/views/dev/ChatDemo.vue'),
        meta: { title: 'router.dev-chat', hideInMenu: true }
      },
      {
        path: 'form',
        name: 'DevForm',
        component: () => import('@/views/dev/FormDemo.vue'),
        meta: { title: 'router.dev-form', hideInMenu: true }
      },
      {
        path: 'search',
        name: 'DevSearch',
        component: () => import('@/views/dev/SearchDemo.vue'),
        meta: { title: 'router.dev-search', hideInMenu: true }
      },
      {
        path: 'notifications',
        name: 'DevNotifications',
        component: () => import('@/views/dev/NotificationsDemo.vue'),
        meta: { title: 'router.dev-notifications', hideInMenu: true }
      },
      {
        path: 'settings',
        name: 'DevSettings',
        component: () => import('@/views/dev/SettingsDemo.vue'),
        meta: { title: 'router.dev-settings', hideInMenu: true }
      },
      {
        path: 'kanban',
        name: 'DevKanban',
        component: () => import('@/views/dev/KanbanDemo.vue'),
        meta: { title: 'router.dev-kanban', hideInMenu: true }
      },
      {
        path: 'timeline',
        name: 'DevTimeline',
        component: () => import('@/views/dev/TimelineDemo.vue'),
        meta: { title: 'router.dev-timeline', hideInMenu: true }
      },
      {
        path: 'ux-demo',
        name: 'DevUxDemo',
        component: () => import('@/views/dev/UxDemo.vue'),
        meta: { title: 'router.dev-ux-demo', hideInMenu: true }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach(async (to, _from) => {
  const title = to.meta.title as string
  // 公开官网区标题用产品名 InnerAgent;控制台沿用脚手架/OEM 命名
  const isPublicLayout = to.matched.some((r) => r.meta.layout === 'public')
  const siteName = isPublicLayout ? t('site.name') : t('app.name')
  if (title) {
    document.title = `${t(title)} - ${siteName}`
  }

  // SEO: 按路由更新 meta description(静态兜底在 index.html)
  const descKey = to.meta.desc as string | undefined
  if (descKey) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', t(descKey))
  }

  // 嵌入模式: 解析外观参数 (brand/mode/language), 即时生效不持久化
  const embed = useEmbedParams()
  embed.applyFromRoute(to)

  // 功能开关: 关闭的功能直接重定向到 /dev
  const feature = to.meta.feature as FeatureKey | undefined
  if (feature && !isFeatureEnabled(feature)) {
    return { path: '/dev', replace: true }
  }

  // /ia 与 /dev 均需演示登录(见 store/user.ts 轻登录;数字用户 ID 由后端
  // 分配并写入 embed token 的 sub)
  const needsLogin = to.path.startsWith('/ia') || to.path === '/dev' || to.path.startsWith('/dev/')
  if (needsLogin) {
    const userStore = useUserStore()
    if (!userStore.userInfo) {
      return { path: '/login', replace: true }
    }
  }

  return true
})

// 全局兜底: 任意路由变化都过一遍 dirty form registry (#2)
router.beforeEach(async (_to, _from) => {
  const dirty = dirtyFormRegistry.findDirty()
  if (dirty) {
    try {
      await ElMessageBox.confirm(
        i18n.global.t('ux.dirty-form.message'),
        i18n.global.t('ux.dirty-form.title'),
        {
          confirmButtonText: i18n.global.t('ux.dirty-form.discard'),
          cancelButtonText: i18n.global.t('ux.dirty-form.cancel'),
          type: 'warning',
        },
      )
      dirty.discard()
      return true
    } catch {
      return false
    }
  }
  return true
})

/**
 * 脏表单全局注册表 (#2 表单未保存提示 — 路由级兜底).
 * useDirtyForm 自动 register/unregister, 此处提供 findDirty 给 router guard 用.
 */
export const dirtyFormRegistry = {
  _forms: new Set<{ isDirty: () => boolean; discard: () => void }>(),

  register(form: { isDirty: () => boolean; discard: () => void }) {
    this._forms.add(form)
  },

  unregister(form: { isDirty: () => boolean; discard: () => void }) {
    this._forms.delete(form)
  },

  findDirty() {
    for (const f of this._forms) {
      if (f.isDirty()) return f
    }
    return null
  },
}

export default router
