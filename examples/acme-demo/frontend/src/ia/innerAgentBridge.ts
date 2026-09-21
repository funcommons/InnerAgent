/**
 * InnerAgent SDK 接入桥 (抄自融光前端同款范式, 02-技术方案 §9.2-4):
 *
 * - resolveInnerAgentAppKey: appKey 解析 (env 可覆盖, 缺省与后端 ia.app-key 一致);
 * - parseJwtExp / isTokenExpiring: embed token exp 解析与临期判定;
 * - createEmbedTokenGetter: 把宿主 embed-token 端点包装为 SDK tokenGetter。
 *
 * tokenGetter 三要点 (docs/接入指南.md §2 步骤⑤):
 * 1. SDK 在每次 HTTP 请求与 SSE 连接前调用它 → 回调内部缓存 + exp 临期重签;
 * 2. 请求 401 时 SDK 会重调 tokenGetter 重试一次 → 回调必须支持被反复调用;
 * 3. 返回 null = 宿主明确给不出 token → SDK 不重试, 按 401 抛错 (勿用抛异常表达)。
 */

/** InnerAgent 管理面注册的应用标识; 可用 VITE_INNERAGENT_APP_KEY 覆盖 */
export const INNERAGENT_DEFAULT_APP_KEY = 'acme-demo'

export function resolveInnerAgentAppKey(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value || INNERAGENT_DEFAULT_APP_KEY
}

// ========== embed token 缓存 (接入指南 §2 步骤⑤ tokenGetter 三要点) ==========

/** JWT 三段式 payload 的 exp (秒); 非法 token 返回 null (交由 SDK 401 懒换兜底) */
export function parseJwtExp(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as { exp?: unknown }
    const exp = payload.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}

/** token 缺失 → true;距 exp 不足 skewMs (默认 5 分钟) → true;解析失败 → false (信任缓存) */
export function isTokenExpiring(token: string | null | undefined, nowMs = Date.now(), skewMs = 5 * 60 * 1000): boolean {
  if (!token) return true
  const exp = parseJwtExp(token)
  if (exp === null) return false
  return exp * 1000 - nowMs <= skewMs
}

export type EmbedTokenFetcher = () => Promise<string | null>

/**
 * 包装宿主 embed-token 端点为 SDK tokenGetter:
 * - 进程内缓存 + exp 前重签 (避免 SDK 每请求打宿主接口);
 * - 重签失败但有旧 token → 返回旧值 (SDK 401 会再次回调, 届时重试端点);
 * - 无缓存且失败 → 返回 null (SDK 契约: 明确无 token, 不重试, 按 401 抛错)。
 */
export function createEmbedTokenGetter(fetchToken: EmbedTokenFetcher): EmbedTokenFetcher {
  let cached: string | null = null
  return async () => {
    if (!isTokenExpiring(cached)) return cached
    try {
      const next = await fetchToken()
      if (next) {
        cached = next
        return next
      }
    } catch {
      // 静默退回缓存/null; SDK 401 懒换会再次触发本回调
    }
    return cached
  }
}
