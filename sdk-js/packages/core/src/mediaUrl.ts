/**
 * [adapt] 媒体资源 URL 解析 — 源: $SRC/src/utils/media-url.ts。
 *
 * 源实现从构建期 import.meta.env.VITE_API_BASE_URL 取基础地址; SDK 改为
 * init({ baseURL }) 的运行时配置 (getBaseURL()), 其余解析语义 1:1:
 * - data: URL / http(s) 完整地址原样返回
 * - / 开头相对路径拼基础地址
 * - 其他相对路径原样返回
 */

import { getBaseURL } from './config'

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('data:')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `${getBaseURL()}${url}`
  return url
}
