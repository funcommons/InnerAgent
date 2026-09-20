/**
 * [new] 视图挂载冒烟共用工具:Pinia + Router + Element Plus + 登录态。
 * 挂载后 flushPromises 两次,让 onMounted 的异步 load 与渲染稳定。
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'

export async function mountView(component: unknown, path: string): Promise<VueWrapper> {
  setActivePinia(createPinia())
  const router: Router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  // 登录态:先 restore(挂请求头 getter),再置会话值(mock 守卫要求非空 key)
  const auth = useAuthStore()
  auth.restore()
  auth.adminKey = 'smoke-key'
  auth.loggedIn = true

  const wrapper = mount(component as never, {
    global: {
      // 与 main.ts 同参(zh-cn locale,#3):保证视图冒烟断言落在本地化文案上
      plugins: [[ElementPlus, { locale: zhCn }], router],
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}
