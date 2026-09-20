/**
 * 助手消息流滚动跟随测试 — 对齐旧 use-assistant-message-scroll.ts:60-226:
 * - 内容就绪 → 隐形贴底后揭示 (viewportReady)
 * - 流式运行中内容版本变化 → 自动跟随到底
 * - 用户上滚 (滚轮) → 脱离跟随 + 「回到底部」按钮; 期间不自动跟随
 * - 点击「回到底部」→ 动画贴底 + 按钮消失
 * - 滚回底部 (≤30px) → 重新跟随
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'

const fake = createFakeAssistantStore()
vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import AssistantMessageList from '../assistant/AssistantMessageList.vue'

/** jsdom 无布局: 手动桩定滚动盒尺寸 */
function stubBox(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

/** 等待 watcher + 双 rAF 初始化链 (rAF 周期 ~16ms) */
async function settle(ms = 160): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** 经 reactive 代理推进 lastSequence (直接改原始对象不触发响应式) */
function bumpSequence(n: number): void {
  const runtime = fake.conversationStates['conv-1'] as { pipeline: { lastSequence: number } }
  runtime.pipeline.lastSequence = n
}

function runningState() {
  return {
    conversation: makeConversation({ status: 'running' }),
    status: 'running',
    statusConfirmed: true,
    unread: false,
    draft: '',
    toolExecutionMode: 'DEFAULT',
    messages: [],
    messagesLoaded: true,
    messagesLoading: false,
    pipeline: {
      status: 'running', reasoningText: '', timeline: [], lastSequence: 1, runId: 'run-1',
    },
  }
}

describe('AssistantMessageList 滚动跟随 (贴底/跟随/脱离/回底)', () => {
  let state: ReturnType<typeof runningState>

  beforeEach(() => {
    vi.clearAllMocks()
    state = runningState()
    fake.conversationStates = { 'conv-1': state }
  })

  async function mountList() {
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    const viewport = wrapper.find('[data-testid="assistant-messages-viewport"]')
      .element as HTMLElement
    stubBox(viewport, 800, 300)
    await settle()
    return { wrapper, viewport }
  }

  it('内容就绪: 贴底初始化后揭示视口, scrollTop 停在底部', async () => {
    const { wrapper, viewport } = await mountList()
    expect(viewport.scrollTop).toBe(800)
    expect(viewport.dataset.ready).toBe('true')
    expect(wrapper.find('[data-testid="assistant-back-to-bottom"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('流式运行中内容版本变化 → 自动跟随回到底部', async () => {
    const { wrapper, viewport } = await mountList()
    viewport.scrollTop = 0
    // 内容推进 (对齐旧 contentVersion = messagesLoaded:messages.length:lastSequence)
    bumpSequence(2)
    await settle()
    // 动画贴底: 目标为 scrollHeight - clientHeight (可滚动最大位)
    expect(viewport.scrollTop).toBe(500)
    wrapper.unmount()
  })

  it('滚轮上滚 → 脱离跟随并出现回到底部按钮; 期间内容推进不再跟随', async () => {
    const { wrapper, viewport } = await mountList()
    await wrapper.find('[data-testid="assistant-messages-viewport"]')
      .trigger('wheel', { deltaY: -100 })
    expect(wrapper.find('[data-testid="assistant-back-to-bottom"]').exists()).toBe(true)

    viewport.scrollTop = 400
    bumpSequence(3)
    await settle()
    expect(viewport.scrollTop).toBe(400)
    wrapper.unmount()
  })

  it('点击回到底部 → 动画贴底, 按钮消失', async () => {
    const { wrapper, viewport } = await mountList()
    await wrapper.find('[data-testid="assistant-messages-viewport"]')
      .trigger('wheel', { deltaY: -100 })
    viewport.scrollTop = 400

    await wrapper.find('[data-testid="assistant-back-to-bottom"]').trigger('click')
    await settle()
    expect(viewport.scrollTop).toBe(500)
    expect(wrapper.find('[data-testid="assistant-back-to-bottom"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('手动滚回底部 (≤30px) → 重新跟随, 按钮消失, 后续内容推进继续贴底', async () => {
    const { wrapper, viewport } = await mountList()
    const viewportEl = wrapper.find('[data-testid="assistant-messages-viewport"]')
    await viewportEl.trigger('wheel', { deltaY: -100 })
    // 真实事件序: 上滚的 scroll 事件先更新 lastScrollTop, 之后向下滚回底部 (movedDown)
    viewport.scrollTop = 400
    await viewportEl.trigger('scroll')
    viewport.scrollTop = 500
    await viewportEl.trigger('scroll')
    expect(wrapper.find('[data-testid="assistant-back-to-bottom"]').exists()).toBe(false)

    bumpSequence(4)
    await settle()
    expect(viewport.scrollTop).toBe(500)
    wrapper.unmount()
  })
})
