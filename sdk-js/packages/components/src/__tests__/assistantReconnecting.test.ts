/**
 * [new] P1 优化建议 #5:断流静默提示 —— 消息区非阻断「连接中断,自动重连中…」横幅。
 *
 * 契约(99-优化建议.md #5 / Figma·Linear 断网横幅范式):
 * - runtime.reconnecting=true → 渲染旋转指示提示条(assistant-reconnecting),
 *   不渲染阻断式错误 + 手动重试按钮(connectionError 已被 store 抑制);
 * - 恢复(reconnecting=false 且无错误)→ 提示条消失;
 * - 重连耗尽(reconnecting=false + connectionError)→ 回到阻断式错误 + 重试按钮。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'

const fake = createFakeAssistantStore()

vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import AssistantMessageList from '../assistant/AssistantMessageList.vue'

function runtimeFixture(over: {
  reconnecting?: boolean
  connectionError?: string
  status?: string
} = {}) {
  return {
    conversation: makeConversation({ status: over.status ?? 'running' }),
    status: over.status ?? 'running',
    statusConfirmed: true,
    unread: false,
    draft: '',
    toolExecutionMode: 'DEFAULT',
    messages: [],
    messagesLoaded: true,
    messagesLoading: false,
    reconnecting: over.reconnecting ?? false,
    connectionError: over.connectionError,
    pipeline: { status: 'running', reasoningText: '', timeline: [], lastSequence: 1 },
  }
}

async function mountList(): Promise<VueWrapper> {
  fake.selectedConversationId = 'conv-1'
  fake.conversations = [makeConversation()]
  fake.conversationStates = { 'conv-1': runtimeFixture() }
  const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
  await nextTick()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.selectedConversationId = null
  fake.conversations = []
  fake.conversationStates = {}
})

describe('AssistantMessageList — 断流静默提示 (P1 #5)', () => {
  it('reconnecting=true → 非阻断提示条渲染;阻断式错误与手动重试按钮不出现', async () => {
    fake.conversationStates['conv-1'] = runtimeFixture({ reconnecting: true })
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()

    const banner = wrapper.find('[data-testid="assistant-reconnecting"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('连接中断')
    expect(banner.text()).toContain('自动重连中')
    // 旋转指示(非阻断, 不遮内容)
    expect(banner.find('.is-spinning').exists()).toBe(true)
    // 抑制手动重试: 无阻断式错误块
    expect(wrapper.find('[data-testid="assistant-message-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assistant-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('恢复(无错误)→ 提示条消失', async () => {
    const wrapper = await mountList()
    expect(wrapper.find('[data-testid="assistant-reconnecting"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('重连耗尽(reconnecting=false + connectionError)→ 阻断式错误 + 重试按钮回归', async () => {
    fake.conversationStates['conv-1'] = runtimeFixture({
      reconnecting: false,
      connectionError: '连接中断，自动重连未成功：network error',
    })
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()

    expect(wrapper.find('[data-testid="assistant-reconnecting"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assistant-message-error"]').exists()).toBe(true)
    const retry = wrapper.find('[data-testid="assistant-retry"]')
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')
    expect(fake.loadMessagesIfNeeded).toHaveBeenCalledWith('conv-1')
    expect(fake.ensureContentConnection).toHaveBeenCalled()
    wrapper.unmount()
  })
})
