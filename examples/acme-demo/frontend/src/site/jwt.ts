/**
 * JWT 解码与过期倒计时工具(体验台 claims 可视化用,纯函数)。
 *
 * 只做 base64url 解码 + JSON 解析(不验签——体验台是展示工具,
 * 验签由 InnerAgent server 用登记的宿主公钥完成)。
 */

export interface DecodedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  /** 第三段签名(原样 base64url,不解码) */
  signature: string
}

/** base64url → UTF-8 字符串(补齐 padding,TextDecoder 处理多字节) */
export function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * 解码 JWT 三段式。格式非法(非三段/空段/非 JSON/段非对象)时抛错,
 * 调用方(体验台)负责以失败态呈现,不白屏。
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts.some((p) => p === '')) {
    throw new Error('malformed jwt: expect header.payload.signature')
  }
  const header = JSON.parse(base64UrlDecode(parts[0]!)) as unknown
  const payload = JSON.parse(base64UrlDecode(parts[1]!)) as unknown
  if (typeof header !== 'object' || header === null || typeof payload !== 'object' || payload === null) {
    throw new Error('malformed jwt: header/payload must be objects')
  }
  return {
    header: header as Record<string, unknown>,
    payload: payload as Record<string, unknown>,
    signature: parts[2]!,
  }
}

/** 距 exp 的剩余秒数(已过期为 0,不为负) */
export function remainingSeconds(expSec: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor(expSec - nowMs / 1000))
}

/** 倒计时格式 hh:mm:ss(小时两位,可超 99) */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

/** epoch 秒 → 本地时间文本(claims 表展示用) */
export function formatEpoch(sec: number): string {
  return new Date(sec * 1000).toLocaleString()
}
