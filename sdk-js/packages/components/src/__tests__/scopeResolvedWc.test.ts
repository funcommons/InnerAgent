/**
 * [new] P2-scope 任务 #15:<inneragent-chat> SCOPE_RESOLVED 前端事件契约 (jsdom)。
 *
 * 契约(03-开发计划 P1 验收 6「SCOPE_RESOLVED 事件到达前端」):
 * - 时机:store 收到确认等待事件(USER_CONFIRMATION_REQUIRED → pipeline.
 *   pendingConfirmation 出现新 runId:replyId 批)时,由 WC 根 dispatch 一次;
 * - 目标:Shadow DOM 内根元素 dispatch,bubbles+composed 穿透 shadow 边界,
 *   宿主元素(light DOM)addEventListener 可收 —— jsdom 的 composed 语义在此验证;
 * - detail:{conversationId, runId, replyId, tools:[{toolCallId, toolName, scope}]},
 *   scope 经 normalizeToolCallScope 归一(旧事件缺字段 → degraded);
 * - 去重:同一确认批只派发一次;新 replyId 批再次派发。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { init, resetSdkConfig } from '@inneragent/sdk-core'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'

const fake = createFakeAssistantStore()

vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import { registerInnerAgentChat, InnerAgentChatElement } from '../inneragent-chat'

function pendingState(runId: string, replyId: string, withScope: boolean) {
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
    pipeline: {
      status: 'running', reasoningText: '', timeline: [], lastSequence: 2, runId,
      pendingConfirmation: {
        runId, replyId,
        toolCalls: [
          {
            toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}',
            // withScope=false → 旧事件形态(无 scope 字段),验证归一化降级
            ...(withScope
              ? { scope: { resolved: false, degraded: true, summary: '宿主未实现约束范围反查' } }
              : {}),
          },
          {
            toolCallId: 'tc-2', toolName: 'query_contact', argumentsPreview: '{}',
            scope: { resolved: true, degraded: false },
          },
        ],
        expiresAt: '2030-01-01T00:00:00Z',
        decisions: {}, submitting: false,
      },
    },
  }
}

describe('<inneragent-chat> SCOPE_RESOLVED 前端事件契约', () => {
  beforeAll(() => {
    resetSdkConfig()
    init({ appKey: 'wc-scope-demo', tokenGetter: async () => null })
    registerInnerAgentChat()
    expect(customElements.get('inneragent-chat')).toBe(InnerAgentChatElement)
  })

  afterEach(() => {
    fake.selectedConversationId = null
    fake.conversationStates = {}
  })

  async function mountHost(): Promise<HTMLElement> {
    const host = document.createElement('inneragent-chat')
    host.setAttribute('view', 'chat')
    document.body.appendChild(host)
    await nextTick()
    await nextTick()
    expect(host.shadowRoot).toBeTruthy()
    return host
  }

  it('确认等待到达 → 宿主元素收到 composed CustomEvent,detail 携带 scope(缺字段归一 degraded)', async () => {
    const host = await mountHost()
    const received: CustomEvent[] = []
    host.addEventListener('SCOPE_RESOLVED', (event) => {
      received.push(event as CustomEvent)
    })

    fake.selectedConversationId = 'conv-1'
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-1', false) }
    await nextTick()
    await nextTick()

    expect(received).toHaveLength(1)
    const detail = received[0]!.detail as {
      conversationId: string
      runId: string
      replyId: string
      tools: Array<{ toolCallId: string, toolName: string, scope: { resolved: boolean, degraded: boolean } }>
    }
    expect(detail.conversationId).toBe('conv-1')
    expect(detail.runId).toBe('run-1')
    expect(detail.replyId).toBe('reply-1')
    expect(detail.tools).toHaveLength(2)
    // 旧事件(无 scope 字段)→ normalizeToolCallScope 归一为 degraded(fail-closed)
    expect(detail.tools[0]!.scope).toEqual({ resolved: false, degraded: true })
    expect(detail.tools[1]!.scope).toEqual({ resolved: true, degraded: false })
    // composed 语义:事件从 Shadow DOM 内派发,宿主(light DOM)可收且 composed=true
    expect(received[0]!.composed).toBe(true)
    // 事件 target 经 shadow 边界重定向到宿主元素
    expect(received[0]!.target).toBe(host)
    host.remove()
  })

  it('同一确认批去重一次派发;新 replyId 批再次派发;待确认消失再重现(重放)→ 重新派发', async () => {
    const host = await mountHost()
    const received: CustomEvent[] = []
    host.addEventListener('SCOPE_RESOLVED', (event) => {
      received.push(event as CustomEvent)
    })

    fake.selectedConversationId = 'conv-1'
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-1', true) }
    await nextTick()
    await nextTick()
    // 同一批(重连重放同 runId:replyId)不重复打扰宿主
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-1', true) }
    await nextTick()
    await nextTick()
    expect(received).toHaveLength(1)

    // 新确认批(新 replyId)→ 再派发,scope 保留服务端原值
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-2', true) }
    await nextTick()
    await nextTick()
    expect(received).toHaveLength(2)
    const second = received[1]!.detail as { replyId: string, tools: Array<{ scope: { degraded: boolean, summary?: string } }> }
    expect(second.replyId).toBe('reply-2')
    expect(second.tools[0]!.scope).toEqual({
      resolved: false, degraded: true, summary: '宿主未实现约束范围反查',
    })

    // 待确认消失(决策提交)后同一批重现(重放)→ 键去重仍抑制,不打扰宿主
    fake.conversationStates = {
      'conv-1': {
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
          status: 'running', reasoningText: '', timeline: [], lastSequence: 3, runId: 'run-1',
        },
      },
    }
    await nextTick()
    await nextTick()
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-2', true) }
    await nextTick()
    await nextTick()
    expect(received).toHaveLength(2)
    host.remove()
  })

  it('非确认会话/未选中会话不派发', async () => {
    const host = await mountHost()
    const received: CustomEvent[] = []
    host.addEventListener('SCOPE_RESOLVED', (event) => {
      received.push(event as CustomEvent)
    })

    fake.selectedConversationId = null
    fake.conversationStates = { 'conv-1': pendingState('run-1', 'reply-1', true) }
    await nextTick()
    await nextTick()
    expect(received).toHaveLength(0)
    host.remove()
  })
})
