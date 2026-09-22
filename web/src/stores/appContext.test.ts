/**
 * [new] 管理面应用上下文 store 测试(2026-09-23,顶栏应用切换器配套)。
 * 断言:缺省应用 1/loadApps 拉取候选/selectApp 持久化/失效 id 回落缺省应用
 * /持久化恢复(localStorage)。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { setAdminKeyGetter } from '@/api/request'
import { useAppContextStore } from './appContext'

// apps 列表经 msw(handlers.test.ts);此处仅需监听调用与隔离 localStorage
vi.mock('@/api/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/admin')>()
  return {
    ...actual,
    appAdminApi: {
      ...actual.appAdminApi,
      list: vi.fn(async () => [
        { id: 1, appKey: 'default', name: '默认应用', status: 1, signKeyFingerprint: 'fp', createdAt: '', retentionDays: 180 },
        { id: 34, appKey: 'acme-demo', name: 'ACME 演示应用', status: 1, signKeyFingerprint: 'fp', createdAt: '', retentionDays: 180 },
      ]),
    },
  }
})

/** node 测试环境无 localStorage:Map 桩,断言直接读同一存储 */
function localStorageStub() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
  }
}
let ls: ReturnType<typeof localStorageStub>

describe('appContext store(应用上下文切换器)', () => {
  beforeEach(() => {
    ls = localStorageStub()
    vi.stubGlobal('localStorage', ls)
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('缺省应用上下文=1;loadApps 拉取候选列表', async () => {
    const store = useAppContextStore()
    expect(store.currentAppId).toBe(1)
    await store.loadApps()
    expect(store.apps.map(a => a.appKey)).toContain('acme-demo')
    expect(store.loading).toBe(false)
  })

  it('selectApp 切换并持久化;current getter 返回选中应用', async () => {
    const store = useAppContextStore()
    await store.loadApps()
    store.selectApp(34)
    expect(store.currentAppId).toBe(34)
    expect(store.current?.appKey).toBe('acme-demo')
    expect(ls.getItem('ia-admin:app-id')).toBe('34')
  })

  it('持久化的失效 id(应用不存在)在 loadApps 后回落缺省应用', async () => {
    ls.setItem('ia-admin:app-id', '999')
    const store = useAppContextStore()
    expect(store.currentAppId).toBe(999)
    await store.loadApps()
    expect(store.currentAppId).toBe(1)
    expect(ls.getItem('ia-admin:app-id')).toBe('1')
  })

  it('localStorage 刷新场景:持久化 id 可恢复(currentAppId 读取自 localStorage)', () => {
    ls.setItem('ia-admin:app-id', '34')
    const store = useAppContextStore()
    expect(store.currentAppId).toBe(34)
  })

  it('非法持久化值(负数/非整数)按缺省应用 1 处理', () => {
    ls.setItem('ia-admin:app-id', '-3')
    expect(useAppContextStore().currentAppId).toBe(1)
    ls.setItem('ia-admin:app-id', 'abc')
    expect(useAppContextStore().currentAppId).toBe(1)
  })
})
