/**
 * [new] P2 优化建议 #13(#11):单工具确认卡补 scope chip。
 *
 * 契约(99-优化建议.md #13,证据 L10-04/L10-12「scope 降级 chip 仅在 ≥2 工具批量条
 * 渲染,单工具(最高频)确认场景 UI 不可检视」):
 * - 行内确认卡(单个 pendingToolCall)补 scope chip 行,与批量条同组件复用
 *   (AssistantScopeChip);
 * - 沿用 normalizeToolCallScope 归一:旧事件(缺 scope 字段)→ degraded 兜底弱提示;
 * - 批量条(≥2 工具)行为不变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'

const fake = createFakeAssistantStore()

vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import AssistantTimeline from '../assistant/AssistantTimeline.vue'
import AssistantMessageList from '../assistant/AssistantMessageList.vue'

const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

describe('AssistantTimeline — 单工具行内确认卡 scope chip (P2 #13)', () => {
  const singleToolItems = [
    { type: 'tool' as const, id: 'tc-1', name: 'save_script_episode', arguments: '{}', status: 'awaiting_approval' as const },
  ]

  it('单工具批 + scope degraded → 行内确认卡渲染降级弱提示 chip', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: singleToolItems,
        confirmation: {
          toolCallIds: ['tc-1'],
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
          scope: { resolved: false, degraded: true, summary: '宿主未实现约束范围反查' },
        },
      },
    })
    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('assistant-scope-chip')
    expect(chip.classes()).toContain('is-degraded')
    expect(chip.text()).toContain('约束范围降级')
    expect(chip.attributes('title')).toBe('宿主未实现约束范围反查')
    // 行内 允许/拒绝 仍在
    expect(wrapper.find('[data-testid="assistant-approve-tc-1"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('单工具批 + scope resolved + summary → 渲染约束范围摘要', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: singleToolItems,
        confirmation: {
          toolCallIds: ['tc-1'],
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
          scope: { resolved: true, degraded: false, summary: '可写:商品简介' },
        },
      },
    })
    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).not.toContain('is-degraded')
    expect(chip.text()).toContain('约束范围：可写:商品简介')
    wrapper.unmount()
  })

  it('子 Agent 单工具批(parentToolCallId 命中)同样渲染 chip', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          {
            type: 'tool' as const, id: 'tc-parent', name: 'generate_storyboard_frame', arguments: '{}', status: 'calling' as const,
            children: [
              { type: 'tool' as const, id: 'tc-child', name: 'generate_image', arguments: '{}', status: 'awaiting_approval' as const },
            ],
          },
        ],
        confirmation: {
          toolCallIds: ['tc-child'],
          parentToolCallId: 'tc-parent',
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
          scope: { resolved: false, degraded: true },
        },
      },
    })
    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('is-degraded')
    wrapper.unmount()
  })

  it('批量(≥2)确认经 AssistantToolConfirmBar 渲染同一 chip 组件(类名复用)', async () => {
    const { default: AssistantToolConfirmBar } = await import('../assistant/AssistantToolConfirmBar.vue')
    const wrapper = mount(AssistantToolConfirmBar, {
      props: {
        toolCallIds: ['tc-1', 'tc-2'],
        decisions: {},
        submitting: false,
        showActions: true,
        expiresAt,
        scopeDigest: { resolved: false, degraded: true, summary: '宿主未实现约束范围反查' },
      },
    })
    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('assistant-scope-chip')
    wrapper.unmount()
  })
})

describe('AssistantMessageList — 单工具确认卡 scope chip 全链 (P2 #13)', () => {
  function singlePendingRuntime(scope: Record<string, unknown> | undefined) {
    return {
      conversation: makeConversation({ status: 'WAITING_CONFIRMATION' }),
      status: 'WAITING_CONFIRMATION',
      statusConfirmed: true,
      unread: false,
      draft: '',
      toolExecutionMode: 'DEFAULT',
      messages: [],
      messagesLoaded: true,
      messagesLoading: false,
      reconnecting: false,
      pipeline: {
        status: 'running', reasoningText: '', lastSequence: 2, runId: 'run-1',
        timeline: [
          { type: 'tool', id: 'tc-1', name: 'save_script_episode', arguments: '{}', status: 'awaiting_approval' },
        ],
        pendingConfirmation: {
          runId: 'run-1',
          replyId: 'reply-1',
          toolCalls: [{
            toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}',
            ...(scope ? { scope } : {}),
          }],
          expiresAt,
          decisions: {}, submitting: false,
        },
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation({ status: 'WAITING_CONFIRMATION' })]
    fake.conversationStates = {}
  })

  it('旧事件(无 scope 字段)→ normalizeToolCallScope 归一 degraded 兜底 chip;批量条不渲染', async () => {
    fake.conversationStates = { 'conv-1': singlePendingRuntime(undefined) }
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()
    await nextTick()

    // 批量条不出现(单工具走行内卡)
    expect(wrapper.find('[data-testid="assistant-batch-approval"]').exists()).toBe(false)
    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('is-degraded')
    expect(chip.text()).toContain('约束范围降级')
    // 行内确认按钮不受影响
    expect(wrapper.find('[data-testid="assistant-approve-tc-1"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('服务端下发 resolved scope → 单工具确认卡渲染摘要', async () => {
    fake.conversationStates = {
      'conv-1': singlePendingRuntime({ resolved: true, degraded: false, summary: '可写:商品简介;禁止:删除' }),
    }
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await nextTick()
    await nextTick()

    const chip = wrapper.find('[data-testid="assistant-confirm-scope"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).not.toContain('is-degraded')
    expect(chip.text()).toContain('约束范围：可写:商品简介;禁止:删除')
    wrapper.unmount()
  })
})
