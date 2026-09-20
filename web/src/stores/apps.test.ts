/**
 * [new] 应用管理 store 测试:加载/筛选/创建/更新/公钥登记与轮换。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppsStore, isValidPemPublicKey, apiErrorMessage } from './apps'
import { setAdminKeyGetter } from '@/api/request'
import { ApiError } from '@/api/errorCodes'

describe('apps store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('load 拉取种子列表与总数', async () => {
    const store = useAppsStore()
    await store.load()
    expect(store.total).toBe(3)
    expect(store.list.map(a => a.appKey)).toContain('demo-app')
    expect(store.loading).toBe(false)
  })

  it('keyword 与 status 筛选', async () => {
    const store = useAppsStore()
    store.filters.keyword = '商城'
    store.filters.status = 1
    await store.load()
    expect(store.total).toBe(1)
    expect(store.list[0]!.appKey).toBe('shop-app')
  })

  it('create 后刷新列表;重复 appKey 抛 ApiError', async () => {
    const store = useAppsStore()
    await store.load()
    const before = store.total
    await store.create({ appKey: 'fresh-app', name: '新应用' })
    expect(store.total).toBe(before + 1)
    const err = await store.create({ appKey: 'fresh-app', name: '重复' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
  })

  it('update 修改保留期并刷新', async () => {
    const store = useAppsStore()
    await store.load()
    const target = store.list[0]!
    const updated = await store.update(target.id, { retentionDays: 90 })
    expect(updated.retentionDays).toBe(90)
    await store.load()
    expect(store.list.find(a => a.id === target.id)!.retentionDays).toBe(90)
  })

  it('公钥登记与轮换返回新指纹', async () => {
    const store = useAppsStore()
    await store.load()
    const app = store.list.find(a => !a.signKeyFingerprint)!
    const pem = '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----'
    const registered = await store.registerPublicKey(app.id, pem)
    expect(registered.fingerprint).toMatch(/^sha256:/)
    const rotated = await store.rotateKey(app.id, pem)
    expect(rotated.fingerprint).toMatch(/^sha256:/)
  })

  it('isValidPemPublicKey 校验 PEM 包裹', () => {
    expect(isValidPemPublicKey('-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----')).toBe(true)
    expect(isValidPemPublicKey('random string')).toBe(false)
    expect(isValidPemPublicKey('-----BEGIN PUBLIC KEY-----')).toBe(false)
  })

  it('apiErrorMessage 归一错误文案', () => {
    expect(apiErrorMessage(new ApiError(10401, '名称已存在'), 'fallback')).toBe('名称已存在')
    expect(apiErrorMessage(new Error('x'), 'fallback')).toBe('fallback')
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
