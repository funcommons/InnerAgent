import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router from '@/router'
import { useUserStore } from '@/store/user'

/**
 * 公开区/控制台路由守卫:
 * - 公开区(/、/docs、/playground)无需登录直接可达;
 * - 控制台(/ia/**)未登录 → 跳 /login;登录后可达;
 * - 公开区标题用产品名 InnerAgent(区别于控制台的脚手架名)。
 */
describe('router guard(公开区与控制台门禁)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(async () => {
    const userStore = useUserStore()
    userStore.clearAuth()
    await router.replace('/')
  })

  async function loginAsDemo() {
    const userStore = useUserStore()
    userStore.accessToken = 'demo-session-token'
    userStore.userInfo = { id: '10086', name: 'demo', ops: true } as never
  }

  it('公开区无需登录:/、/docs、/playground 直接可达', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('SiteHome')
    await router.push('/docs')
    expect(router.currentRoute.value.name).toBe('SiteDocs')
    await router.push('/playground')
    expect(router.currentRoute.value.name).toBe('SitePlayground')
  })

  it('控制台未登录:/ia/overview 重定向到 /login', async () => {
    await router.push('/ia/overview')
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('登录后控制台可达', async () => {
    await loginAsDemo()
    await router.push('/ia/overview')
    expect(router.currentRoute.value.path).toBe('/ia/overview')
  })

  it('docs 支持章节参数:/docs/quickstart 命中 SiteDocs', async () => {
    await router.push('/docs/quickstart')
    expect(router.currentRoute.value.name).toBe('SiteDocs')
    expect(router.currentRoute.value.params.sectionId).toBe('quickstart')
  })

  it('公开区 document.title 使用产品名 InnerAgent', async () => {
    await router.push('/docs')
    expect(document.title).toContain('文档中心')
    expect(document.title).toContain('InnerAgent')
    expect(document.title).not.toContain('视觉统一手脚架')
  })

  it('公开区路由更新 meta description', async () => {
    // jsdom 无 index.html 的 head,先补一个静态 meta(与 index.html 形态一致)
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'description')
    meta.setAttribute('content', 'static-default')
    document.head.appendChild(meta)

    await router.push('/playground')
    expect(meta.getAttribute('content')).not.toBe('static-default')
    expect(meta.getAttribute('content')!.length).toBeGreaterThan(0)

    await router.push('/docs')
    expect(meta.getAttribute('content')!.length).toBeGreaterThan(0)
  })
})
