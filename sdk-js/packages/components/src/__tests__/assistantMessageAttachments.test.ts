/**
 * [new] P2 优化建议 #14(#12):消息区附件渲染。
 *
 * 契约(99-优化建议.md #14,证据 L9-04「发送前 chip 有缩略图/文件名,发送后气泡
 * 仅文本,历史回放同」):
 * - 纯逻辑:用户消息 referencesJson(version 2)→ 附件视图(image → previewUrl 经
 *   resolveMediaUrl 解析 resourceUrl;/attachments/{id} 为 API 根相对 → getBaseURL
 *   拼接);file/video/audio → 文件卡(名+大小);畸形/缺省输入安全回退空集;
 * - 渲染:用户气泡按附件渲染缩略图/文件卡(复用 composer chip 组件),
 *   历史回放(messagesLoaded 路径)与实时发送(乐观消息 referencesJson)同路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'

import { messageAttachments } from '../assistant/assistantMessageAttachments'
import type { AgentMessage } from '@inneragent/sdk-core'

const fake = createFakeAssistantStore()

vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import AssistantMessageList from '../assistant/AssistantMessageList.vue'

describe('messageAttachments (用户消息附件纯逻辑)', () => {
  function userMessage(referencesJson?: string): AgentMessage {
    return {
      id: 1,
      conversationId: 'conv-1',
      role: 'user',
      content: '看图说话',
      ...(referencesJson !== undefined ? { referencesJson } : {}),
      messageOrder: 1,
    }
  }

  it('version 2 referencesJson → 附件视图;image 的 previewUrl 经 resolveMediaUrl 拼接 baseURL', () => {
    const referencesJson = JSON.stringify({
      version: 2,
      projectId: null,
      project: null,
      skills: [],
      mcpTools: [],
      attachments: [
        {
          id: 'att-img-1', name: '设计图.png', inputType: 'image', mimeType: 'image/png',
          transport: 'base64', resourceUrl: '/attachments/att-img-1', size: 2048,
        },
        {
          id: 'att-file-1', name: '报告.pdf', inputType: 'file', mimeType: 'application/pdf',
          transport: 'url', resourceUrl: '/attachments/att-file-1', size: 1048576,
        },
      ],
    })
    const result = messageAttachments(userMessage(referencesJson))
    expect(result).toHaveLength(2)
    // 媒体地址约定:resourceUrl=/attachments/{id}(API 根相对)→ getBaseURL 拼接
    expect(result[0]).toMatchObject({
      id: 'att-img-1', name: '设计图.png', inputType: 'image', transport: 'base64', size: 2048,
    })
    expect(result[0]?.previewUrl).toBe('/ia/api/v1/attachments/att-img-1')
    // 非图片不产缩略图, 文件卡走 名+大小
    expect(result[1]).toMatchObject({ id: 'att-file-1', inputType: 'file', name: '报告.pdf', size: 1048576 })
    expect(result[1]?.previewUrl).toBeUndefined()
  })

  it('完整 http(s) resourceUrl 原样保留(data:/绝对地址同一解析路径)', () => {
    const referencesJson = JSON.stringify({
      attachments: [{
        id: 'a1', name: 'x.png', inputType: 'image', mimeType: 'image/png',
        transport: 'url', resourceUrl: 'https://oss.example.com/x.png', size: 10,
      }],
    })
    expect(messageAttachments(userMessage(referencesJson))[0]?.previewUrl)
      .toBe('https://oss.example.com/x.png')
  })

  it('安全回退:无 referencesJson / 畸形 JSON / attachments 非数组 / 项缺 id/name → 空集', () => {
    expect(messageAttachments(userMessage(undefined))).toEqual([])
    expect(messageAttachments(userMessage('not-json{'))).toEqual([])
    expect(messageAttachments(userMessage(JSON.stringify({ attachments: 'nope' })))).toEqual([])
    expect(messageAttachments(userMessage(JSON.stringify({
      attachments: [{ name: '缺 id' }, 'junk', { id: 'a2', name: 'ok.png', inputType: 'image', size: 1 }],
    })))).toEqual([
      expect.objectContaining({ id: 'a2', name: 'ok.png', inputType: 'image' }),
    ])
    expect(messageAttachments(undefined)).toEqual([])
  })
})

describe('AssistantMessageList — 用户气泡附件渲染 (历史回放同路径, P2 #14)', () => {
  const referencesJson = JSON.stringify({
    version: 2,
    projectId: null,
    project: null,
    skills: [],
    mcpTools: [],
    attachments: [
      {
        id: 'att-img-1', name: '设计图.png', inputType: 'image', mimeType: 'image/png',
        transport: 'base64', resourceUrl: '/attachments/att-img-1', size: 2048,
      },
      {
        id: 'att-file-1', name: '报告.pdf', inputType: 'file', mimeType: 'application/pdf',
        transport: 'url', resourceUrl: '/attachments/att-file-1', size: 1048576,
      },
    ],
  })

  function historyRuntime() {
    return {
      conversation: makeConversation(),
      status: 'completed',
      statusConfirmed: true,
      unread: false,
      draft: '',
      toolExecutionMode: 'DEFAULT',
      messages: [
        { id: 1, conversationId: 'conv-1', role: 'user', content: '帮我分析这两份材料', referencesJson, messageOrder: 1 },
        { id: 2, conversationId: 'conv-1', role: 'assistant', content: '好的,我的分析如下', messageOrder: 2 },
      ] as AgentMessage[],
      messagesLoaded: true,
      messagesLoading: false,
      reconnecting: false,
      pipeline: { status: 'idle', reasoningText: '', timeline: [], lastSequence: 0 },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation()]
    fake.conversationStates = {}
  })

  it('历史回放:用户气泡渲染附件缩略图 + 文件卡(复用 composer chip 组件)', async () => {
    fake.conversationStates = { 'conv-1': historyRuntime() }
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()
    await nextTick()

    const row = wrapper.find('[data-testid="assistant-user-attachments"]')
    expect(row.exists()).toBe(true)
    // chip 组件复用(composer 同类名)
    expect(row.findAll('.assistant-attachment-chip')).toHaveLength(2)
    // image → 缩略图(resolveMediaUrl 后的 resourceUrl)
    const imgChip = row.find('[data-testid="assistant-message-attachment-att-img-1"]')
    expect(imgChip.exists()).toBe(true)
    expect(imgChip.find('img').attributes('src')).toBe('/ia/api/v1/attachments/att-img-1')
    expect(imgChip.text()).toContain('设计图.png')
    // file → 文件卡(名 + 大小), 无缩略图
    const fileChip = row.find('[data-testid="assistant-message-attachment-att-file-1"]')
    expect(fileChip.exists()).toBe(true)
    expect(fileChip.find('img').exists()).toBe(false)
    expect(fileChip.text()).toContain('报告.pdf')
    expect(fileChip.text()).toContain('1.0 MB')
    // 消息区不可移除(无 remove 按钮)
    expect(row.find('[data-testid^="assistant-attachment-remove-"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('实时发送:乐观消息携带 referencesJson → 气泡即刻渲染附件(发送后不消失)', async () => {
    const runtime = historyRuntime()
    fake.conversationStates = {
      'conv-1': {
        ...runtime,
        messages: [
          runtime.messages[0] as AgentMessage,
          {
            id: 2, conversationId: 'conv-1', role: 'assistant', content: '', messageOrder: 2,
          },
        ],
      },
    }
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()
    expect(wrapper.find('[data-testid="assistant-user-attachments"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('无附件的用户消息不渲染附件行(纯文本气泡不受影响)', async () => {
    const runtime = historyRuntime()
    fake.conversationStates = {
      'conv-1': {
        ...runtime,
        messages: [
          { id: 1, conversationId: 'conv-1', role: 'user', content: '纯文本', messageOrder: 1 },
          { id: 2, conversationId: 'conv-1', role: 'assistant', content: '回复', messageOrder: 2 },
        ],
      },
    }
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()
    expect(wrapper.find('[data-testid="assistant-user-attachments"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assistant-user-bubble"]').text()).toContain('纯文本')
    wrapper.unmount()
  })
})
