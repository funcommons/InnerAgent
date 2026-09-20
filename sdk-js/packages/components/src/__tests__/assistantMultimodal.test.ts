/**
 * [port] 助手附件多模态纯逻辑测试 — 源: $SRC/components/assistant/__tests__/assistantMultimodal.test.ts
 * (断言 1:1; AiModel 类型改由 core 提供, 上传一律注入假件)。 (队列 #34-2/#34-5).
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/assistant-multimodal.ts:
 * - MIME 解析/输入类型映射/大小上限 (单文件 100MB, base64 单文件 10MB, base64 总量 20MB, 数量 8)
 * - transport 决策: base64 优先 (限内), 超限回落 url, 双不支持报错
 * - 上传走 POST /api/storage/assistant-upload (注入 upload 假件)
 * - 兼容性校验 / 能力摘要 / accept 串 / 文件大小文案
 */
import { describe, it, expect, vi } from 'vitest'
import {
  AssistantAttachmentError,
  prepareAssistantAttachments,
  attachmentCompatibilityError,
  multimodalCapabilitySummary,
  attachmentAccept,
  formatFileSize,
  inputTypeForMime,
  resolveMimeType,
  type AssistantAttachment,
} from '../assistant/assistantMultimodal'
import type { AiModel } from '@inneragent/sdk-core'

function file(over: { name?: string; size?: number; type?: string } = {}): File {
  const { name = 'a.png', size = 10, type = 'image/png' } = over
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function model(over: Partial<AiModel> = {}): AiModel {
  return {
    id: 5,
    name: '对话模型A',
    multimodalInputTypes: ['image', 'file'],
    multimodalInputTransports: { image: ['base64', 'url'], file: ['url'] },
    ...over,
  } as AiModel
}

const uploadOk = vi.fn(async () => '/media/assistant/image/echo.png')

describe('resolveMimeType / inputTypeForMime (MIME 解析)', () => {
  it('声明的合法 MIME 优先', () => {
    expect(resolveMimeType(file({ type: 'image/webp' }))).toBe('image/webp')
    expect(resolveMimeType(file({ name: 'a.mov', type: '' }))).toBe('video/quicktime')
  })

  it('声明不合法回落扩展名推断', () => {
    expect(resolveMimeType(file({ name: 'a.md', type: 'application/octet-stream' }))).toBe('text/markdown')
  })

  it('均不合法 → attachment-unsupported 错误', () => {
    try {
      resolveMimeType(file({ name: 'a.exe', type: 'application/x-msdownload' }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AssistantAttachmentError)
      expect((error as AssistantAttachmentError).key).toBe('assistant.attachment-unsupported')
      expect((error as AssistantAttachmentError).params).toEqual({ name: 'a.exe' })
    }
  })

  it('inputTypeForMime 按前缀映射 image/video/audio/file', () => {
    expect(inputTypeForMime('image/png')).toBe('image')
    expect(inputTypeForMime('video/mp4')).toBe('video')
    expect(inputTypeForMime('audio/wav')).toBe('audio')
    expect(inputTypeForMime('application/pdf')).toBe('file')
  })
})

describe('prepareAssistantAttachments (附件准备主链路)', () => {
  it('base64 优先: 读文件 + 上传回显地址 + 图片 previewUrl', async () => {
    const upload = vi.fn(async () => '/media/assistant/image/x.png')
    const result = await prepareAssistantAttachments({
      files: [file({ name: 'p.png', size: 1024 })],
      model: model(),
      existing: [],
      upload,
      readFileAsBase64: async () => 'QUJD',
    })
    expect(upload).toHaveBeenCalledWith(expect.any(File), 5, 'base64')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'p.png', inputType: 'image', mimeType: 'image/png', transport: 'base64',
      data: 'QUJD', resourceUrl: '/media/assistant/image/x.png', size: 1024,
    })
    expect(result[0]?.previewUrl).toContain('/media/assistant/image/x.png')
  })

  it('非图片不生成 previewUrl; url 传输不带 data', async () => {
    const result = await prepareAssistantAttachments({
      files: [file({ name: 'doc.pdf', size: 1024, type: 'application/pdf' })],
      model: model(),
      existing: [],
      upload: uploadOk,
    })
    expect(uploadOk).toHaveBeenCalledWith(expect.any(File), 5, 'url')
    expect(result[0]?.transport).toBe('url')
    expect(result[0]?.data).toBeUndefined()
    expect(result[0]?.previewUrl).toBeUndefined()
  })

  it('超过 8 个 → count-limit', async () => {
    const files = Array.from({ length: 9 }, (_, index) => file({ name: `f${index}.png` }))
    await expect(prepareAssistantAttachments({
      files, model: model(), existing: [], upload: uploadOk,
    })).rejects.toMatchObject({ key: 'assistant.attachment-count-limit', params: { n: 8 } })
  })

  it('existing 计入数量上限, 同名同大小去重', async () => {
    const existing: AssistantAttachment[] = [{
      id: 'a1', name: 'a.png', inputType: 'image', mimeType: 'image/png', transport: 'base64', size: 10,
    }]
    const files = Array.from({ length: 6 }, (_, index) => file({ name: `f${index}.png` }))
    // existing 1 + files 7 (含 1 个重复) = 8, 恰好达到上限; 去重后实际新增 6
    const result = await prepareAssistantAttachments({
      files: [file({ name: 'a.png', size: 10 }), ...files], model: model(), existing, upload: uploadOk,
    })
    expect(result).toHaveLength(6)
  })

  it('模型不支持的输入类型 → model-unsupported', async () => {
    await expect(prepareAssistantAttachments({
      files: [file({ name: 's.mp3', type: 'audio/mpeg' })],
      model: model(),
      existing: [],
      upload: uploadOk,
    })).rejects.toMatchObject({ key: 'assistant.attachment-model-unsupported', params: { model: '对话模型A', type: 'audio' } })
  })

  it('0 字节 / 超 100MB → size-limit', async () => {
    await expect(prepareAssistantAttachments({
      files: [file({ name: 'z.png', size: 0 })], model: model(), existing: [], upload: uploadOk,
    })).rejects.toMatchObject({ key: 'assistant.attachment-size-limit' })
    await expect(prepareAssistantAttachments({
      files: [file({ name: 'big.png', size: 100 * 1024 * 1024 + 1 })], model: model(), existing: [], upload: uploadOk,
    })).rejects.toMatchObject({ key: 'assistant.attachment-size-limit', params: { name: 'big.png' } })
  })

  it('超 base64 单文件 10MB → 回落 url', async () => {
    const upload = vi.fn(async () => 'https://oss.example.com/a.png')
    const result = await prepareAssistantAttachments({
      files: [file({ name: 'big.png', size: 11 * 1024 * 1024 })],
      model: model(),
      existing: [],
      upload,
      readFileAsBase64: async () => 'QQ==',
    })
    expect(upload).toHaveBeenCalledWith(expect.any(File), 5, 'url')
    expect(result[0]?.transport).toBe('url')
  })

  it('base64 总量 20MB 打满后, 后续文件回落 url', async () => {
    const existing: AssistantAttachment[] = [{
      id: 'a0', name: 'big.png', inputType: 'image', mimeType: 'image/png', transport: 'base64',
      size: 15 * 1024 * 1024,
    }]
    const upload = vi.fn(async (_file: File, _modelId: number, transport: 'url' | 'base64') => {
      expect(transport).toBe('url')
      return '/media/x'
    })
    const result = await prepareAssistantAttachments({
      files: [file({ name: 'two.png', size: 9 * 1024 * 1024 })],
      model: model(),
      existing,
      upload,
      readFileAsBase64: async () => 'QQ==',
    })
    expect(result[0]?.transport).toBe('url')
  })

  it('双 transport 均不可用 → base64-limit', async () => {
    await expect(prepareAssistantAttachments({
      files: [file({ name: 'huge.png', size: 50 * 1024 * 1024 })],
      model: model({ multimodalInputTransports: { image: ['base64'], file: ['url'] } }),
      existing: [],
      upload: uploadOk,
    })).rejects.toMatchObject({ key: 'assistant.attachment-base64-limit', params: { name: 'huge.png' } })
  })

  it('上传失败 → 原样抛出 (allSettled 首个失败)', async () => {
    const upload = vi.fn(async () => { throw new Error('上传失败: 网络错误') })
    await expect(prepareAssistantAttachments({
      files: [file()], model: model(), existing: [], upload, readFileAsBase64: async () => 'QQ==',
    })).rejects.toThrow('上传失败: 网络错误')
  })
})

describe('attachmentCompatibilityError (发送前兼容性校验)', () => {
  const attachment: AssistantAttachment = {
    id: 'a', name: 'p.png', inputType: 'image', mimeType: 'image/png', transport: 'base64', size: 1,
  }

  it('无附件 → null', () => {
    expect(attachmentCompatibilityError(model(), [])).toBeNull()
  })

  it('模型缺失 → model-required', () => {
    expect(attachmentCompatibilityError(null, [attachment])).toMatchObject({ key: 'assistant.attachment-model-required' })
  })

  it('模型不支持该输入类型 → incompatible', () => {
    const audio: AssistantAttachment = { ...attachment, inputType: 'audio' }
    expect(attachmentCompatibilityError(model(), [audio])).toMatchObject({
      key: 'assistant.attachment-incompatible',
      params: { model: '对话模型A', name: 'p.png', transport: 'BASE64' },
    })
  })

  it('传输方式不支持 → incompatible', () => {
    const urlOnly = model({ multimodalInputTransports: { image: ['url'], file: ['url'] } })
    expect(attachmentCompatibilityError(urlOnly, [attachment])).toMatchObject({ key: 'assistant.attachment-incompatible' })
  })
})

describe('multimodalCapabilitySummary / attachmentAccept (能力摘要)', () => {
  it('无多模态能力 → textOnly', () => {
    expect(multimodalCapabilitySummary(null)).toEqual({ textOnly: true, parts: [] })
    expect(multimodalCapabilitySummary(model({ multimodalInputTypes: [] }))).toEqual({ textOnly: true, parts: [] })
  })

  it('按模型能力输出 parts (类型 + 传输)', () => {
    expect(multimodalCapabilitySummary(model())).toEqual({
      textOnly: false,
      parts: [
        { type: 'image', transports: ['base64', 'url'] },
        { type: 'file', transports: ['url'] },
      ],
    })
  })

  it('accept 串: 按类型映射 (file → 文本类扩展名)', () => {
    expect(attachmentAccept(model())).toBe('image/*,.pdf,.txt,.md,.csv,.json')
    expect(attachmentAccept(model({
      multimodalInputTypes: ['image', 'video', 'audio', 'file'],
      multimodalInputTransports: { image: ['url'], video: ['url'], audio: ['url'], file: ['url'] },
    }))).toBe('image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json')
    expect(attachmentAccept(null)).toBe('')
  })
})

describe('formatFileSize (附件尺寸文案)', () => {
  it('B / KB(向上取整) / MB(一位小数)', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(2049)).toBe('3 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1536 * 1024)).toBe('1.5 MB')
  })
})
