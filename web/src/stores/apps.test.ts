/**
 * [new] 应用管理 store 测试:加载/客户端过滤/CRUD/公钥登记与轮换(PUT signPublicKey)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppsStore, isValidPemPublicKey, apiErrorMessage } from './apps'
import { setAdminKeyGetter } from '@/api/request'
import { ApiError } from '@/api/errorCodes'

const PEM_A = '-----BEGIN PUBLIC KEY-----\nTEST-A\n-----END PUBLIC KEY-----'
const PEM_B = '-----BEGIN PUBLIC KEY-----\nTEST-B\n-----END PUBLIC KEY-----'

describe('apps store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAdminKeyGetter(() => 'k')
  })

  it('load 拉取种子列表;服务端无分页,客户端分页生效', async () => {
    const store = useAppsStore()
    await store.load()
    expect(store.total).toBe(3)
    expect(store.list.map(a => a.appKey)).toContain('demo-app')
    expect(store.loading).toBe(false)
    expect(store.list.length).toBe(3)
  })

  it('keyword 与 status 客户端筛选', async () => {
    const store = useAppsStore()
    store.filters.keyword = '商城'
    store.filters.status = 1
    await store.load()
    expect(store.total).toBe(1)
    expect(store.list[0]!.appKey).toBe('shop-app')
  })

  it('create(必含 signPublicKey)后刷新列表;重复 appKey 抛 409 ApiError', async () => {
    const store = useAppsStore()
    await store.load()
    const before = store.total
    await store.create({ appKey: 'fresh-app', name: '新应用', signPublicKey: PEM_A })
    expect(store.total).toBe(before + 1)
    const err = await store.create({ appKey: 'fresh-app', name: '重复', signPublicKey: PEM_A }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
  })

  it('update 修改状态/webhook 并刷新', async () => {
    const store = useAppsStore()
    await store.load()
    const target = store.list[0]!
    const updated = await store.update(target.id, { status: 0, webhookUrl: 'https://cb.example.com/x' })
    expect(updated.status).toBe(0)
    await store.load()
    const row = store.list.find(a => a.id === target.id)!
    expect(row.status).toBe(0)
    expect(row.webhookUrl).toBe('https://cb.example.com/x')
  })

  it('公钥登记与轮换(同一端点 PUT signPublicKey)写回 signPublicKey', async () => {
    const store = useAppsStore()
    await store.load()
    const app = store.list.find(a => !a.signPublicKey)!
    const registered = await store.updateSignKey(app.id, PEM_A)
    expect(registered.signPublicKey).toContain('BEGIN PUBLIC KEY')
    const rotated = await store.updateSignKey(app.id, PEM_B)
    expect(rotated.signPublicKey).toContain('TEST-B')
  })

  it('remove 注销后列表不再包含', async () => {
    const store = useAppsStore()
    await store.load()
    await store.remove(3)
    expect(store.list.find(a => a.id === 3)).toBeUndefined()
    expect(store.total).toBe(2)
  })

  it('isValidPemPublicKey 校验 PEM 包裹', () => {
    expect(isValidPemPublicKey('-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----')).toBe(true)
    expect(isValidPemPublicKey('random string')).toBe(false)
    expect(isValidPemPublicKey('-----BEGIN PUBLIC KEY-----')).toBe(false)
  })

  it('apiErrorMessage 归一错误文案', () => {
    expect(apiErrorMessage(new ApiError(409, '应用 appKey 已存在'), 'fallback')).toBe('应用 appKey 已存在')
    expect(apiErrorMessage(new Error('x'), 'fallback')).toBe('fallback')
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
