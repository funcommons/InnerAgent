import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IA_EMBED_TOKEN_URL, extractEmbedToken, fetchIaEmbedToken } from '@/api/ia'
import { http } from '@/api/request'

// 轻 mock 请求层:本测试只关心 ia.ts 的解析契约与 URL 常量,不测 axios 链
vi.mock('@/api/request', () => ({
  http: { get: vi.fn(), post: vi.fn() },
}))

describe('IA_EMBED_TOKEN_URL', () => {
  it('指向宿主后端签发端点', () => {
    expect(IA_EMBED_TOKEN_URL).toBe('/api/ia/embed-token')
  })
})

describe('extractEmbedToken(解包后 data → token)', () => {
  it('常规契约 { token } → token(去除首尾空白)', () => {
    expect(extractEmbedToken({ token: '  abc.def.ghi  ' })).toBe('abc.def.ghi')
  })

  it('非 string token / 空 token / 空对象 → null(拿不到 token 语义)', () => {
    expect(extractEmbedToken({ token: 42 })).toBeNull()
    expect(extractEmbedToken({ token: '   ' })).toBeNull()
    expect(extractEmbedToken({})).toBeNull()
    expect(extractEmbedToken(null)).toBeNull()
  })

  it('裸 JWT 文本端点(接入指南 §2-⑤ 示例形态)→ 原样返回', () => {
    expect(extractEmbedToken('aaa.bbb.ccc')).toBe('aaa.bbb.ccc')
    expect(extractEmbedToken('')).toBeNull()
  })
})

describe('fetchIaEmbedToken(静默请求,失败不弹全局提示)', () => {
  beforeEach(() => {
    vi.mocked(http.get).mockReset()
  })

  it('解包后 { token } → 返回 token', async () => {
    vi.mocked(http.get).mockResolvedValue({ token: 'x.y.z' })
    await expect(fetchIaEmbedToken()).resolves.toBe('x.y.z')
    expect(http.get).toHaveBeenCalledWith(IA_EMBED_TOKEN_URL, expect.objectContaining({ silent: true }))
  })

  it('端点抛错(未登录/网络)→ 透传给调用方(嵌入页错误卡呈现)', async () => {
    vi.mocked(http.get).mockRejectedValue(new Error('401'))
    await expect(fetchIaEmbedToken()).rejects.toThrow('401')
  })
})
