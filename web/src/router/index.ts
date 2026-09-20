/**
 * [new] 管理站路由。全部视图懒加载;全局守卫强制登录(除 /login)。
 * 视图清单对应关系见各 view 文件头注释。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: () => import('@/views/AdminLayout.vue'),
    redirect: '/apps',
    children: [
      {
        path: 'apps',
        name: 'Apps',
        component: () => import('@/views/AppsView.vue'),
        meta: { title: '应用管理' },
      },
      {
        path: 'tools',
        name: 'Tools',
        component: () => import('@/views/ToolsView.vue'),
        meta: { title: '工具注册' },
      },
      {
        path: 'audit',
        name: 'Audit',
        component: () => import('@/views/AuditView.vue'),
        meta: { title: '审计查询' },
      },
      {
        path: 'models',
        name: 'Models',
        component: () => import('@/views/ModelsView.vue'),
        meta: { title: '模型配置' },
      },
      {
        path: 'circuit',
        name: 'Circuit',
        component: () => import('@/views/CircuitView.vue'),
        meta: { title: '熔断与紧急停用' },
      },
      {
        path: 'webhooks',
        name: 'Webhooks',
        component: () => import('@/views/WebhooksView.vue'),
        meta: { title: 'Webhook' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (!auth.isAuthenticated) {
    return { name: 'Login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined }
  }
  return true
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · InnerAgent 管理站` : 'InnerAgent 管理站'
})

export default router
