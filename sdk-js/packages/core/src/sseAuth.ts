/**
 * [adapt] SSE 专用认证 fetch — 源: $SRC/src/api/auth-retry.ts。
 *
 * 源实现: 401 → useUserStore().refreshAccessToken() 单飞 → 新 token 重试一次。
 * SDK 适配: 刷新 → 契约 tokenGetter 再次调用 (client.refreshTokenSingleFlight
 * 同一单飞窗口, HTTP 层与 SSE 层共享), 其余语义 1:1:
 * - 并发 401 共享同一次重取
 * - 重取失败 → 返回原 401 响应, 由上层按请求失败处理
 */

import { refreshTokenSingleFlight, resolveToken } from './client'
import { assistantEventHooks } from './store/assistantEvents'

export async function authenticatedFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = await resolveToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status === 401) {
    // 先通知钩子 (iframe 桥借此失效 child 端 token 缓存, P4/W15), 再懒换:
    // 再次调用 tokenGetter (与 http 层共享单飞窗口)
    assistantEventHooks.onUnauthorized()
    const freshToken = await refreshTokenSingleFlight().catch(() => null)
    if (freshToken) {
      headers.set('Authorization', `Bearer ${freshToken}`)
      return fetch(input, { ...init, headers })
    }
  }

  return response
}
