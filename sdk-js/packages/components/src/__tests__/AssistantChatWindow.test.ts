/**
 * [port] AssistantChatWindow 冒烟 — 源: $SRC/components/assistant/__tests__/AssistantChatWindow.test.ts。
 * 生命周期/欢迎态/composer 模型加载断言 1:1; mock 重锚到 @inneragent/sdk-core。
 */
/**
 * AssistantChatWindow 冒烟 — 挂载生命周期 + 欢迎态 + composer 模型加载.
 *
 * 生命周期对齐旧 assistant-store.setMode 语义: 打开窗口 (open=true) 时
 * initializeForUser; 卸载 open=false (断开前端 SSE, 转后台轮询)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'
import { init, resetSdkConfig } from '@inneragent/sdk-core'

const fake = createFakeAssistantStore()
// [adapt] 源 mock '@/store/assistant' + '@/store/user' + '@/api/ai-model' + '@/api/assistant';
// SDK 统一 mock '@inneragent/sdk-core' (仅替换 store 与 API 假件, 其余透传)。
vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return {
    ...actual,
    useAssistantStore: () => fake,
    aiModelApi: {
      listByType: vi.fn(async () => [
        {
          id: 5, name: '对话模型A', defaultModel: true, supportReasoning: true,
          reasoningEffortLevels: ['low', 'high'], status: 1,
        },
      ]),
    },
    getAssistantReferenceOptions: vi.fn(async () => ({ skills: [], mcpTools: [] })),
  }
})

import AssistantChatWindow from '../assistant/AssistantChatWindow.vue'

describe('AssistantChatWindow', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    fake.conversations = []
    fake.conversationStates = {}
    fake.selectedConversationId = null
    fake.selectedModelId = null
    vi.clearAllMocks()
  })

  it('挂载: initializeForUser(appKey) + setOpen(true); 卸载 setOpen(false)', () => {
    resetSdkConfig()
    init({ appKey: 'demo-app', tokenGetter: async () => null })
    wrapper = mount(AssistantChatWindow)
    // [adapt] 源以 userStore.userInfo.id 水合; SDK 以 init({ appKey }) 命名空间身份
    expect(fake.initializeForUser).toHaveBeenCalledWith('demo-app')
    expect(fake.setOpen).toHaveBeenLastCalledWith(true)
    // 欢迎态 (未选中会话)
    expect(wrapper.find('[data-testid="assistant-welcome"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-composer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-nav"]').exists()).toBe(true)

    wrapper.unmount()
    wrapper = null
    expect(fake.setOpen).toHaveBeenLastCalledWith(false)
  })

  it('选中会话 → 渲染消息列表; 起始提示词点击写入新会话草稿', async () => {
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation()]
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation(),
        status: 'completed',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: true,
        messagesLoading: false,
        pipeline: { status: 'idle', reasoningText: '', timeline: [], lastSequence: 0 },
      },
    }
    wrapper = mount(AssistantChatWindow)
    expect(wrapper.find('[data-testid="assistant-message-list"]').exists()).toBe(true)
    wrapper.unmount()

    fake.selectedConversationId = null
    wrapper = mount(AssistantChatWindow)
    const starter = wrapper.find('.assistant-window__starter')
    expect(starter.exists()).toBe(true)
    await starter.trigger('click')
    expect(fake.setDraft).toHaveBeenCalledWith(null, expect.any(String))
    wrapper.unmount()
    wrapper = null
  })
})
