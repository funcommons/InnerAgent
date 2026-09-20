/**
 * [adapt] assistantMultimodal — 源: $SRC/src/components/assistant/assistantMultimodal.ts。
 * 附件多模态纯逻辑 1:1 (上限/transport 决策/兼容校验); 适配:
 * - 类型与 resolveMediaUrl 改由 @inneragent/sdk-core 提供
 * - 上传端点 /api/storage/assistant-upload → 契约 uploadAttachment
 *   (POST /ia/api/v1/attachments, 服务端 T3b; 可注入 upload 假件测试)
 */
/**
 * 助手附件多模态纯逻辑 (队列 #34-2/#34-5).
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/assistant-multimodal.ts 1:1:
 * - 上限: 数量 8 / base64 单文件 10MB / base64 总量 20MB / 单文件 100MB
 * - transport 决策: base64 优先 (限内), 超限回落 url, 双不支持报错
 * - 上传端点: POST /api/storage/assistant-upload (FormData: file/modelId/transport;
 *   后端 FileUploadController.uploadAssistantInput, url 传输要求公开可访问存储)
 *
 * 新旧差异 (i18n): 旧实现抛硬编码中文 Error; 新实现抛 AssistantAttachmentError
 * (key + params 供 t() 翻译, message 保留中文兜底与旧文案一致)。
 */
import type { AiModel, MultimodalInputType, AiMultimodalInput, AiMultimodalInputTransport } from '@inneragent/sdk-core'
import { resolveMediaUrl, uploadAttachment } from '@inneragent/sdk-core'

const MAX_INPUT_COUNT = 8

/**
 * base64 传输单文件上限(10MB)。[P2 #15] 导出:附件 >10MB 且模型具备 url 传输时
 * transport 静默回退 url —— UI 据此在 chip 上给「大文件将以 URL 引用传输」小字提示。
 */
export const MAX_BASE64_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_BASE64_SIZE = 20 * 1024 * 1024
const MAX_URL_FILE_SIZE = 100 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION))

const INPUT_TYPE_LABEL_ZH: Record<MultimodalInputType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
}

export interface AssistantAttachment extends AiMultimodalInput {
  previewUrl?: string
}

/** 附件错误: key/params 走 i18n, message 保留旧中文文案兜底 */
export class AssistantAttachmentError extends Error {
  readonly key: string
  readonly params: Record<string, unknown>

  constructor(key: string, params: Record<string, unknown>, fallbackMessage: string) {
    super(fallbackMessage)
    this.name = 'AssistantAttachmentError'
    this.key = key
    this.params = params
  }
}

/** 兼容性错误 / 结构化摘要的通用描述 (key → assistant.* locale key) */
export interface AssistantLocalizedMessage {
  key: string
  params: Record<string, unknown>
}

export function resolveMimeType(file: File): string {
  const declared = file.type.toLowerCase().split(';', 1)[0]?.trim() ?? ''
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  const inferred = MIME_BY_EXTENSION[extension]
  const mimeType = ALLOWED_MIME_TYPES.has(declared) ? declared : inferred
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AssistantAttachmentError(
      'assistant.attachment-unsupported',
      { name: file.name },
      `${file.name} 不是支持的图片、视频、音频、PDF 或文本文件`,
    )
  }
  return mimeType
}

export function inputTypeForMime(mimeType: string): MultimodalInputType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

/** 默认读取实现 (模块内别名: 解构默认值与同名 option key 区分) */
const moduleReadFileAsBase64 = (file: File): Promise<string> => readFileAsBase64(file)

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new AssistantAttachmentError(
      'assistant.attachment-read-failed',
      { name: file.name },
      `读取 ${file.name} 失败`,
    ))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const separator = result.indexOf(',')
      if (separator < 0) {
        reject(new AssistantAttachmentError(
          'assistant.attachment-encode-failed',
          { name: file.name },
          `${file.name} 无法转换为 Base64`,
        ))
        return
      }
      resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface PrepareAssistantAttachmentsOptions {
  files: File[]
  model: AiModel
  existing: AssistantAttachment[]
  /** 上传实现 (默认 uploadAssistantInput → /api/storage/assistant-upload); 注入便于测试 */
  upload?: (file: File, modelId: number, transport: AiMultimodalInputTransport) => Promise<string>
  readFileAsBase64?: (file: File) => Promise<string>
}

/** 附件准备主链路 (旧 prepareAssistantAttachments 语义 1:1) */
export async function prepareAssistantAttachments({
  files,
  model,
  existing,
  upload = uploadAttachment,
  readFileAsBase64: readFile = moduleReadFileAsBase64,
}: PrepareAssistantAttachmentsOptions): Promise<AssistantAttachment[]> {
  if (existing.length + files.length > MAX_INPUT_COUNT) {
    throw new AssistantAttachmentError(
      'assistant.attachment-count-limit',
      { n: MAX_INPUT_COUNT },
      `单次最多添加 ${MAX_INPUT_COUNT} 个附件`,
    )
  }

  const existingKeys = new Set(existing.map((item) => `${item.name}:${item.size}`))
  const preparedFiles = files.filter((file) => {
    const key = `${file.name}:${file.size}`
    if (existingKeys.has(key)) return false
    existingKeys.add(key)
    return true
  })
  let totalBase64Size = existing
    .filter((item) => item.transport === 'base64')
    .reduce((sum, item) => sum + item.size, 0)

  const plans = preparedFiles.map((file) => {
    const mimeType = resolveMimeType(file)
    const inputType = inputTypeForMime(mimeType)
    const supportedTransports = model.multimodalInputTransports[inputType] ?? []
    if (!model.multimodalInputTypes.includes(inputType) || !supportedTransports.length) {
      throw new AssistantAttachmentError(
        'assistant.attachment-model-unsupported',
        { model: model.name, type: inputType },
        `${model.name} 不支持${INPUT_TYPE_LABEL_ZH[inputType]}输入`,
      )
    }
    if (file.size <= 0 || file.size > MAX_URL_FILE_SIZE) {
      throw new AssistantAttachmentError(
        'assistant.attachment-size-limit',
        { name: file.name },
        `${file.name} 的大小必须在 1B 到 100MB 之间`,
      )
    }

    let transport: AiMultimodalInputTransport | null = null
    if (
      supportedTransports.includes('base64')
      && file.size <= MAX_BASE64_FILE_SIZE
      && totalBase64Size + file.size <= MAX_TOTAL_BASE64_SIZE
    ) {
      transport = 'base64'
      totalBase64Size += file.size
    } else if (supportedTransports.includes('url')) {
      transport = 'url'
    }
    if (!transport) {
      throw new AssistantAttachmentError(
        'assistant.attachment-base64-limit',
        { name: file.name },
        `${file.name} 超出 Base64 限制，且当前模型未启用 URL 输入`,
      )
    }
    return { file, mimeType, inputType, transport }
  })

  const results = await Promise.allSettled(plans.map(async ({
    file,
    mimeType,
    inputType,
    transport,
  }) => {
    const id = createAttachmentId()
    const resourceUrl = await upload(file, model.id, transport)
    if (transport === 'base64') {
      const data = await readFile(file)
      return {
        id,
        name: file.name,
        inputType,
        mimeType,
        transport,
        data,
        resourceUrl,
        size: file.size,
        previewUrl: inputType === 'image' ? resolveMediaUrl(resourceUrl) ?? undefined : undefined,
      }
    }
    return {
      id,
      name: file.name,
      inputType,
      mimeType,
      transport,
      url: resourceUrl,
      resourceUrl,
      size: file.size,
      previewUrl: inputType === 'image' ? resolveMediaUrl(resourceUrl) ?? undefined : undefined,
    }
  }))

  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) {
    throw failure.reason
  }
  return results.map((result) => (result as PromiseFulfilledResult<AssistantAttachment>).value)
}

/** 发送前兼容性校验 (旧 attachmentCompatibilityError; i18n 化返回值) */
export function attachmentCompatibilityError(
  model: AiModel | null,
  attachments: AssistantAttachment[],
): AssistantLocalizedMessage | null {
  if (!attachments.length) return null
  if (!model) return { key: 'assistant.attachment-model-required', params: {} }
  for (const attachment of attachments) {
    const transports = model.multimodalInputTransports[attachment.inputType] ?? []
    if (!model.multimodalInputTypes.includes(attachment.inputType)
      || !transports.includes(attachment.transport)) {
      return {
        key: 'assistant.attachment-incompatible',
        params: { model: model.name, name: attachment.name, transport: attachment.transport.toUpperCase() },
      }
    }
  }
  return null
}

export interface MultimodalCapabilitySummary {
  textOnly: boolean
  parts: Array<{ type: MultimodalInputType; transports: AiMultimodalInputTransport[] }>
}

/** 模型能力摘要 (旧 multimodalCapabilitySummary 结构化; 文案由组件 i18n 渲染) */
export function multimodalCapabilitySummary(model: AiModel | null): MultimodalCapabilitySummary {
  const types = model?.multimodalInputTypes ?? []
  if (!model || !types.length) return { textOnly: true, parts: [] }
  return {
    textOnly: false,
    parts: types.map((type) => ({ type, transports: model.multimodalInputTransports[type] ?? [] })),
  }
}

/** 文件选择器 accept 串 (旧 use-assistant-attachments.accept) */
export function attachmentAccept(model: AiModel | null): string {
  const types = model?.multimodalInputTypes ?? []
  return [
    types.includes('image') ? 'image/*' : null,
    types.includes('video') ? 'video/*' : null,
    types.includes('audio') ? 'audio/*' : null,
    types.includes('file') ? '.pdf,.txt,.md,.csv,.json' : null,
  ].filter(Boolean).join(',')
}

/** 附件尺寸文案 (旧 attachment-strip formatFileSize 1:1) */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * [P2 #15] 附件 url 传输回退提示(99-优化建议.md #15, 证据 L9-08「>10MB 且模型
 * 支持 url 传输时静默回退,UI 无任何说明」):>10MB 且 transport 回退为 url →
 * composer chip 小字「大文件将以 URL 引用传输」;其余(base64 限内 / ≤10MB url)无提示。
 */
export function attachmentUrlFallbackHint(
  attachment: Pick<AssistantAttachment, 'transport' | 'size'>,
): AssistantLocalizedMessage | null {
  return attachment.transport === 'url' && attachment.size > MAX_BASE64_FILE_SIZE
    ? { key: 'assistant.attachment-url-fallback', params: {} }
    : null
}
