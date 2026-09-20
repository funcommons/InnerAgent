/**
 * [new] 管理站入口。
 * dev 模式启用 msw mock 后端(本任务不接真实服务);生产构建不含 mock 分支。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/auth'

async function bootstrap() {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)
  app.use(ElementPlus)

  // 恢复会话需在路由解析前完成(守卫读取登录态)
  useAuthStore(pinia).restore()

  await router.isReady()
  app.mount('#app')
}

void bootstrap()
