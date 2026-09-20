/**
 * [new] 管理站入口。
 * dev 模式默认启用 msw 演示后端(VITE_ENABLE_MOCK=false 可关,直连真实服务);
 * 生产构建不含 mock 分支。环境状态灯(#1)由 api/health.ts 驱动:
 * msw 接管 → 演示数据;否则启动探测 + 运行期请求成败校正。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/auth'
import { isDemoBackendActive, markDemoBackend, probeBackend } from '@/api/health'

async function bootstrap() {
  if (isDemoBackendActive()) {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
    markDemoBackend()
  } else {
    // 生产/dev 直连:启动探测后端可达性(结果由请求层逐次校正)
    void probeBackend()
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
