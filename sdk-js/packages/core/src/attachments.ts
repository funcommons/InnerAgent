/**
 * [new] 对话附件上传 — 契约端点 (02-技术方案 §7.1):
 *   POST /api/storage/assistant-upload (融光) → POST {base}/attachments (InnerAgent)
 * 服务端 T3b 才实现; SDK 侧先按契约写好调用 (FormData: file/modelId/transport),
 * 测试以 mock fetch 验证请求形状 (见 __tests__/attachments.spec.ts)。
 */

import { http } from './client'

export type AttachmentTransport = 'url' | 'base64'

/**
 * 上传对话附件, 返回服务端持久化地址 (resourceUrl)。
 * url 传输要求公开可访问存储; base64 传输仅用作回显锚点, 服务端可落临时区。
 */
export async function uploadAttachment(
  file: File,
  modelId: number,
  transport: AttachmentTransport,
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('modelId', String(modelId))
  formData.append('transport', transport)

  // [DEF-05] 相对路径: baseURL 由 client.request() 统一拼接
  return http.post('/attachments', formData, { timeoutMs: 0 })
}
