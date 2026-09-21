/**
 * API 体验台专用客户端(公开端点,fetch 直连,不走 axios 拦截器/登录态)。
 *
 * - POST /api/demo/login 是公开端点(任意用户名即演示会话);
 * - GET /api/ia/embed-token 需要演示会话,Bearer 显式携带体验台自己换来的
 *   会话 token(与控制台登录态互不影响)。
 *
 * 响应统一为宿主后端 R 信封 {code, msg, data}(code===0 才算成功)。
 * 错误以 PlaygroundApiError 抛出:status=0 网络/后端不可达;503 私钥未配置;
 * 401 会话无效。体验台按 status 呈现对应失败态与配置指引。
 */

export class PlaygroundApiError extends Error {
  /** HTTP 状态;0 = 网络错误/后端不可达 */
  status: number
  /** R 信封业务码 */
  code: number | null

  constructor(message: string, status: number, code: number | null = null) {
    super(message)
    this.name = 'PlaygroundApiError'
    this.status = status
    this.code = code
  }
}

interface R<T> {
  code: number
  msg?: string
  data?: T
}

export interface PlaygroundSession {
  token: string
  username: string
  userId: number
}

export interface PlaygroundEmbedToken {
  token: string
  /** 有效期(秒,后端按 exp 折算) */
  expiresIn: number
  appKey: string
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: R<T> | null = null
  try {
    body = (await res.json()) as R<T>
  } catch {
    // 非 JSON 响应体
  }
  if (body === null) {
    throw new PlaygroundApiError(`HTTP ${res.status}`, res.status)
  }
  if (body.code !== 0) {
    throw new PlaygroundApiError(body.msg || `HTTP ${res.status}`, res.status, body.code)
  }
  return body.data as T
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new PlaygroundApiError(e instanceof Error ? e.message : String(e), 0)
  }
  return parseEnvelope<T>(res)
}

async function getWithBearer<T>(url: string, bearer: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
  } catch (e) {
    throw new PlaygroundApiError(e instanceof Error ? e.message : String(e), 0)
  }
  return parseEnvelope<T>(res)
}

export const playgroundApi = {
  /** 演示登录(公开端点):任意用户名,后端建立演示会话并分配稳定数字用户 ID */
  async login(username: string): Promise<PlaygroundSession> {
    return postJson<PlaygroundSession>('/api/demo/login', { username })
  },

  /** 签发 embed token(演示会话内):RS256,iss=appKey、sub=用户 ID、exp 12h */
  async embedToken(sessionToken: string): Promise<PlaygroundEmbedToken> {
    return getWithBearer<PlaygroundEmbedToken>('/api/ia/embed-token', sessionToken)
  },
}
