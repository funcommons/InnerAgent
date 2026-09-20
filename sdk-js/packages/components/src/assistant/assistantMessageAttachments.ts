/**
 * [new] P2 优化建议 #14(#12):消息区附件渲染 —— 用户消息附件视图纯逻辑。
 *
 * 契约(99-优化建议.md #14「用户气泡模板按消息附件关联渲染缩略图(image)或
 * 文件卡(file),复用 composer chip 组件」):
 * - 用户消息的 referencesJson(version 2,sendMessage 序列化)携带 attachments:
 *   {id, name, inputType, mimeType, transport, resourceUrl, size};
 * - 媒体地址约定:resourceUrl = /attachments/{id}(API 根相对)→ resolveMediaUrl
 *   经 getBaseURL 拼接后作为 image 缩略图 src;完整 http(s)/data: 地址原样返回;
 * - 畸形 / 缺省输入一律安全回退空集(历史回放不因脏数据崩溃)。
 */
import type { AgentMessage } from '@inneragent/sdk-core'
import { resolveMediaUrl } from '@inneragent/sdk-core'

export interface AssistantMessageAttachmentView {
  id: string
  name: string
  inputType: 'image' | 'video' | 'audio' | 'file'
  mimeType: string
  transport: 'url' | 'base64'
  size: number
  resourceUrl?: string
  /** image 类型经 resolveMediaUrl 解析的缩略图地址(其余类型/解析失败缺省) */
  previewUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INPUT_TYPES = new Set(['image', 'video', 'audio', 'file'])

/** 解析用户消息关联的附件视图(发送后气泡与历史回放共用同一入口)。 */
export function messageAttachments(message: AgentMessage | undefined): AssistantMessageAttachmentView[] {
  const raw = message?.referencesJson
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.attachments)) return []

  const views: AssistantMessageAttachmentView[] = []
  for (const item of parsed.attachments) {
    if (!isRecord(item)) continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : ''
    const name = typeof item.name === 'string' && item.name.trim() ? item.name : ''
    if (!id || !name) continue
    const inputType = typeof item.inputType === 'string' && INPUT_TYPES.has(item.inputType)
      ? item.inputType as AssistantMessageAttachmentView['inputType']
      : 'file'
    const resourceUrl = typeof item.resourceUrl === 'string' && item.resourceUrl.trim()
      ? item.resourceUrl
      : undefined
    views.push({
      id,
      name,
      inputType,
      mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'application/octet-stream',
      transport: item.transport === 'url' ? 'url' : 'base64',
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0
        ? item.size
        : 0,
      ...(resourceUrl ? { resourceUrl } : {}),
      ...(inputType === 'image' && resourceUrl
        ? { previewUrl: resolveMediaUrl(resourceUrl) ?? undefined }
        : {}),
    })
  }
  return views
}
