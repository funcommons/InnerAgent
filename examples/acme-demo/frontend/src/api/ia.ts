/**
 * InnerAgent 宿主侧 API(docs/接入指南.md §2 步骤⑤)。
 *
 * embed token 签发端点: `GET /api/ia/embed-token` (登录态内; 后端用宿主私钥签
 * RS256 JWT, iss=appKey, sub=用户 ID, exp 建议 12h, 公钥登记给 InnerAgent)。
 *
 * 响应契约 (CommonResult 信封, 由 request.ts 响应拦截器解包):
 *   HTTP 200 { code: 0, data: { token: "<jwt>" } }  → 拦截器解包后得到 { token }
 * 失败 (未登录/网络/非 0 code) → 抛 ApiError, 由调用方 UI 呈现, 不白屏。
 */

import { http } from '@/api/request'

export const IA_EMBED_TOKEN_URL = '/api/ia/embed-token'

export interface IaEmbedTokenData {
  token: string
  expiresIn: number
  appKey: string
}

/** 开通状态四分态 (后端 /api/ia/server-status, 经管理面实时查询) */
export type IaServerState = 'registered' | 'not_registered' | 'unreachable' | 'admin_key_missing'

export interface IaServerStatus {
  state: IaServerState
  appId: number
  appKey: string | null
  signKeyFingerprint: string | null
}

/**
 * 从解包后的响应数据提取 embed token。
 * - { token: string } → token (常规契约)
 * - 非 string 的 token / 空对象 → null (调用方按「拿不到 token」处理)
 * - 纯文本 JWT (三段式) → 原样返回 (兼容裸文本端点形态, 接入指南 §2 步骤⑤示例)
 */
export function extractEmbedToken(data: unknown): string | null {
  if (typeof data === 'string') {
    const token = data.trim()
    return token ? token : null
  }
  if (data && typeof data === 'object') {
    const token = (data as { token?: unknown }).token
    if (typeof token === 'string' && token.trim()) return token.trim()
  }
  return null
}

/**
 * 拉取 embed token; 拿不到返回 null (SDK tokenGetter 的 null 语义: 明确无 token,
 * SDK 按 401 抛 ApiError.isAuthError, 不重试)。静默请求: 失败不弹全局提示,
 * 由嵌入页内嵌错误卡呈现。
 */
export async function fetchIaEmbedToken(): Promise<string | null> {
  const data = await http.get<unknown>(IA_EMBED_TOKEN_URL, {
    silent: true,
    skipAuthRedirect: true,
  })
  return extractEmbedToken(data)
}

/** 开通状态自检 (总览页实时拉取; 探测失败由后端归一为 unreachable, 前端 fail-open) */
export async function fetchIaServerStatus(): Promise<IaServerStatus> {
  return http.get<IaServerStatus>('/api/ia/server-status', { silent: true, skipAuthRedirect: true })
}
