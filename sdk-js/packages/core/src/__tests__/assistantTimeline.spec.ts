/**
 * [port] store/assistantTimeline 测试 — 源: $SRC/src/store/__tests__/assistantTimeline.spec.ts
 * (断言逐条保留; import 重锚到 core 内部模块)。 — 助手纯事件 reducer + 历史消息回放.
 *
 * 对齐旧 ai-fusion-video-web:
 * - components/dashboard/agent-pipeline/state.ts (reducePipelineEvent, 含
 *   USER_CONFIRMATION_REQUIRED / USER_CONFIRM_RESULT / CONFIRMATION_EXPIRED 分支)
 * - components/dashboard/notification-panel/history.ts (messagesToTimeline)
 * - lib/store/assistant-runtime.ts (状态映射 / 消息合并 / 会话去重)
 */
import { describe, it, expect } from 'vitest'
import {
  createInitialPipelineState,
  createPendingPipelineState,
  pendingPipelineForNextRun,
  persistedToolTimelineStatus,
  reduceAssistantEvent,
  reducePipelineEvent,
  statusFromPipeline,
  statusIsRunning,
  normalizeTitle,
  mergeMessages,
  messageKey,
  messagesToTimeline,
  terminalStatusForEvent,
  hasTerminal,
  hasLiveTranscript,
  uniqueConversations,
  type AgentPipelineState,
} from '../timeline/assistantTimeline'
import type { AiChatStreamEvent } from '../runs'
import type { AgentConversation, AgentMessage } from '../conversations'

function evt(sequence: number, outputType: string, extra: Record<string, unknown> = {}): AiChatStreamEvent {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    sequence,
    conversationId: 'conv-1',
    outputType: outputType as AiChatStreamEvent['outputType'],
    ...extra,
  } as AiChatStreamEvent
}

function conversationPatch(pipeline: AgentPipelineState): AgentPipelineState {
  return { ...pipeline, runId: 'run-1' }
}

describe('assistantTimeline.reducePipelineEvent (SSE 事件 → timeline)', () => {
  it('REASONING 连续事件合并 reasoning 节点; CONTENT 合并 content 节点', () => {
    let state = createPendingPipelineState()
    state = conversationPatch(state)
    state = reducePipelineEvent(state, evt(1, 'REASONING', { reasoningContent: '分析', reasoningStartTime: 111 }))
    state = reducePipelineEvent(state, evt(2, 'REASONING', { reasoningContent: '剧本' }))
    expect(state.reasoningText).toBe('分析剧本')
    expect(state.reasoningStartTime).toBe(111)
    expect(state.status).toBe('reasoning')
    expect(state.timeline).toEqual([{ type: 'reasoning', text: '分析剧本', startedAtMs: 111 }])

    state = reducePipelineEvent(state, evt(3, 'CONTENT', { content: '你好' }))
    state = reducePipelineEvent(state, evt(4, 'CONTENT', { content: '世界' }))
    expect(state.timeline).toHaveLength(2)
    expect(state.timeline[1]).toEqual({ type: 'content', text: '你好世界' })
    expect(state.status).toBe('running')
  })

  it('TOOL_CALL_STARTED→TOOL_CALL→TOOL_FINISHED 驱动工具状态机', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'TOOL_CALL_STARTED', {
      replyId: 'reply-1',
      toolCalls: [{ id: 'tc-1', name: 'get_project', arguments: '' }],
    }))
    expect(state.timeline[0]).toMatchObject({ type: 'tool', id: 'tc-1', status: 'preparing', batchId: 'reply-1' })

    state = reducePipelineEvent(state, evt(2, 'TOOL_CALL', {
      replyId: 'reply-1',
      toolCalls: [{ id: 'tc-1', name: 'get_project', arguments: '{"projectId":7}' }],
    }))
    expect(state.timeline[0]).toMatchObject({ status: 'calling', arguments: '{"projectId":7}' })

    state = reducePipelineEvent(state, evt(3, 'TOOL_FINISHED', {
      toolCallId: 'tc-1', toolStatus: 'success', toolResult: 'ok',
    }))
    expect(state.timeline[0]).toMatchObject({ status: 'done', result: 'ok' })
  })

  it('USER_CONFIRMATION_REQUIRED 建立 pendingConfirmation 并把工具置 awaiting_approval (含 plan)', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'TOOL_CALL', {
      replyId: 'reply-1',
      toolCalls: [{ id: 'tc-1', name: 'save_script_episode', arguments: '{}' }],
    }))
    state = reducePipelineEvent(state, evt(2, 'USER_CONFIRMATION_REQUIRED', {
      replyId: 'reply-1',
      expiresAt: '2030-01-01T00:00:00Z',
      pendingToolCalls: [{
        toolCallId: 'tc-1',
        toolName: 'save_script_episode',
        argumentsPreview: '{}',
        plan: { summary: '保存分集', changes: [{ field: 'title', before: 'a', after: 'b' }] },
      }],
    }))
    expect(state.status).toBe('running')
    expect(state.pendingConfirmation).toMatchObject({
      runId: 'run-1', replyId: 'reply-1', expiresAt: '2030-01-01T00:00:00Z', submitting: false,
    })
    expect(state.pendingConfirmation?.toolCalls).toHaveLength(1)
    expect(state.timeline[0]).toMatchObject({ status: 'awaiting_approval' })
    expect((state.timeline[0] as { plan?: unknown }).plan).toMatchObject({ summary: '保存分集' })
  })

  it('USER_CONFIRM_RESULT 按决定置 approved/rejected 并清除 pendingConfirmation', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'TOOL_CALL', {
      replyId: 'reply-1',
      toolCalls: [
        { id: 'tc-1', name: 'save_script_episode', arguments: '{}' },
        { id: 'tc-2', name: 'save_script_episode', arguments: '{}' },
      ],
    }))
    state = reducePipelineEvent(state, evt(2, 'USER_CONFIRMATION_REQUIRED', {
      replyId: 'reply-1',
      expiresAt: '2030-01-01T00:00:00Z',
      pendingToolCalls: [
        { toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}' },
        { toolCallId: 'tc-2', toolName: 'save_script_episode', argumentsPreview: '{}' },
      ],
    }))
    state = reducePipelineEvent(state, evt(3, 'USER_CONFIRM_RESULT', {
      replyId: 'reply-1',
      decisions: [
        { toolCallId: 'tc-1', approved: true },
        { toolCallId: 'tc-2', approved: false },
      ],
    }))
    expect(state.pendingConfirmation).toBeUndefined()
    expect(state.timeline[0]).toMatchObject({ status: 'approved' })
    expect(state.timeline[1]).toMatchObject({ status: 'rejected' })
  })

  it('CANCELLED + CONFIRMATION_EXPIRED: 等待确认工具置 expired 并清 pending', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'TOOL_CALL', {
      replyId: 'reply-1', toolCalls: [{ id: 'tc-1', name: 'generate_image', arguments: '{}' }],
    }))
    state = reducePipelineEvent(state, evt(2, 'USER_CONFIRMATION_REQUIRED', {
      replyId: 'reply-1', expiresAt: '2030-01-01T00:00:00Z',
      pendingToolCalls: [{ toolCallId: 'tc-1', toolName: 'generate_image', argumentsPreview: '{}' }],
    }))
    state = reducePipelineEvent(state, evt(3, 'CANCELLED', { cancellationReason: 'CONFIRMATION_EXPIRED' }))
    expect(state.status).toBe('cancelled')
    expect(state.timeline[0]).toMatchObject({ status: 'expired' })
    expect(state.pendingConfirmation).toBeUndefined()
  })

  it('DONE: 根终态置 done + 收尾 content; 子 Agent 终态不改根状态', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'DONE', { content: '完成' }))
    expect(state.status).toBe('done')
    expect(state.timeline).toEqual([{ type: 'content', text: '完成' }])

    const subState = reducePipelineEvent(
      conversationPatch(createPendingPipelineState()),
      evt(1, 'DONE', { parentToolCallId: 'tc-1' }),
    )
    expect(subState.status).toBe('reasoning')
  })

  it('旧 sequence 事件幂等忽略; 换 runId 抛错', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(2, 'CONTENT', { content: 'b' }))
    const unchanged = reducePipelineEvent(state, evt(1, 'CONTENT', { content: 'a' }))
    expect(unchanged).toBe(state)
    expect(() => reducePipelineEvent(state, { ...evt(3, 'CONTENT'), runId: 'run-2' }))
      .toThrow('Pipeline event belongs to a different run')
  })

  it('子 Agent 事件挂到父工具 children (TOOL_CALL/REASONING/CONTENT/TOOL_FINISHED/SUB_AGENT_FINISHED)', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'TOOL_CALL', {
      replyId: 'reply-1', toolCalls: [{ id: 'tc-parent', name: 'generate_storyboard_frame', arguments: '{}' }],
    }))
    state = reducePipelineEvent(state, evt(2, 'TOOL_CALL', {
      replyId: 'reply-2', parentToolCallId: 'tc-parent',
      toolCalls: [{ id: 'tc-child', name: 'generate_image', arguments: '{}' }],
    }))
    state = reducePipelineEvent(state, evt(3, 'REASONING', {
      parentToolCallId: 'tc-parent', reasoningContent: '子思考',
    }))
    state = reducePipelineEvent(state, evt(4, 'CONTENT', { parentToolCallId: 'tc-parent', content: '子输出' }))
    state = reducePipelineEvent(state, evt(5, 'TOOL_FINISHED', {
      parentToolCallId: 'tc-parent', toolCallId: 'tc-child', toolStatus: 'success', toolResult: '图',
    }))
    state = reducePipelineEvent(state, evt(6, 'SUB_AGENT_FINISHED', { parentToolCallId: 'tc-parent' }))
    const parent = state.timeline[0] as Extract<typeof state.timeline[number], { type: 'tool' }>
    expect(parent.status).toBe('done')
    const children = parent.children ?? []
    expect(children.map((c) => c.type)).toEqual(['tool', 'reasoning', 'content'])
    expect(children[0]).toMatchObject({ id: 'tc-child', status: 'done', result: '图' })
  })

  it('reduceAssistantEvent: cancelling 状态在流式事件下保持, 终态解除', () => {
    let state = conversationPatch(createPendingPipelineState())
    state = reducePipelineEvent(state, evt(1, 'CONTENT', { content: 'a' }))
    const cancelling = { ...state, status: 'cancelling' as const }
    const still = reduceAssistantEvent(cancelling, evt(2, 'CONTENT', { content: 'b' }))
    expect(still.status).toBe('cancelling')
    const done = reduceAssistantEvent(still, evt(3, 'DONE'))
    expect(done.status).toBe('done')
  })
})

describe('assistantTimeline 状态映射 / 工具函数', () => {
  it('statusIsRunning 覆盖本地与后端运行态; statusFromPipeline 映射后端状态', () => {
    for (const s of ['running', 'pending', 'RUNNING', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED']) {
      expect(statusIsRunning(s)).toBe(true)
    }
    expect(statusIsRunning('completed')).toBe(false)
    expect(statusFromPipeline('COMPLETED')).toBe('completed')
    expect(statusFromPipeline('FAILED')).toBe('failed')
    expect(statusFromPipeline('CANCELLED')).toBe('cancelled')
    expect(statusFromPipeline('CANCEL_REQUESTED')).toBe('CANCEL_REQUESTED')
    expect(statusFromPipeline('WAITING_CONFIRMATION')).toBe('WAITING_CONFIRMATION')
    expect(statusFromPipeline('RUNNING')).toBe('running')
  })

  it('persistedToolTimelineStatus: running→calling, success/done→done, rejected/expired 保留', () => {
    expect(persistedToolTimelineStatus('running')).toBe('calling')
    expect(persistedToolTimelineStatus('success')).toBe('done')
    expect(persistedToolTimelineStatus('error')).toBe('error')
    expect(persistedToolTimelineStatus('cancelled')).toBe('cancelled')
    expect(persistedToolTimelineStatus('rejected')).toBe('rejected')
    expect(persistedToolTimelineStatus('expired')).toBe('expired')
  })

  it('normalizeTitle: 压缩空白并截断 50 字, 空串兜底 新对话', () => {
    expect(normalizeTitle('  a   b  ')).toBe('a b')
    expect(normalizeTitle('x'.repeat(60))).toBe('x'.repeat(50))
    expect(normalizeTitle('   ')).toBe('新对话')
  })

  it('hasTerminal/terminalStatusForEvent: 根终态判定', () => {
    expect(hasTerminal(evt(1, 'DONE'))).toBe(true)
    expect(hasTerminal(evt(1, 'DONE', { agentName: 'sub' }))).toBe(false)
    expect(terminalStatusForEvent(evt(1, 'ERROR'))).toBe('failed')
    expect(terminalStatusForEvent(evt(1, 'CANCELLED'))).toBe('cancelled')
  })

  it('hasLiveTranscript: timeline 或 reasoningText 非空即有实况', () => {
    expect(hasLiveTranscript({ pipeline: createInitialPipelineState() })).toBe(false)
    expect(hasLiveTranscript({ pipeline: { ...createInitialPipelineState(), reasoningText: 'x' } })).toBe(true)
  })

  it('pendingPipelineForNextRun: 初始 reasoning 态并绑定会话', () => {
    expect(pendingPipelineForNextRun('conv-9')).toMatchObject({
      status: 'reasoning', conversationId: 'conv-9', lastSequence: 0,
    })
  })
})

describe('assistantTimeline.mergeMessages / messagesToTimeline (历史回放)', () => {
  it('mergeMessages: 按 messageKey 去重 (服务端消息覆盖本地乐观消息), 按 messageOrder 排序', () => {
    const optimistic: AgentMessage = {
      id: -100, conversationId: 'c', role: 'user', content: 'hi', messageOrder: 1,
    }
    const server: AgentMessage = {
      id: 5, conversationId: 'c', role: 'user', content: 'hi', messageOrder: 1,
    }
    const merged = mergeMessages([optimistic], [server])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe(5)
    const sorted = mergeMessages([], [
      { id: 2, conversationId: 'c', role: 'assistant', content: 'b', messageOrder: 2 },
      { id: 1, conversationId: 'c', role: 'user', content: 'a', messageOrder: 1 },
    ])
    expect(sorted.map((m) => m.messageOrder)).toEqual([1, 2])
  })

  it('messageKey: 用户消息按 order+content, 服务端消息按 id, 投影消息按 run+projectionKey', () => {
    expect(messageKey({ id: -1, conversationId: 'c', role: 'user', content: 'hi', messageOrder: 3 }))
      .toBe('user:c:3:hi')
    expect(messageKey({ id: 7, conversationId: 'c', role: 'assistant', content: 'x', messageOrder: 0 }))
      .toBe('id:7')
    expect(messageKey({
      id: -1, conversationId: 'c', role: 'assistant', content: 'x', messageOrder: 0,
      runId: 'r', projectionKey: 'p',
    })).toBe('projection:r:p')
  })

  it('messagesToTimeline: running 工具消息与结束消息合并为同一节点; 用户消息由调用方过滤', () => {
    const timeline = messagesToTimeline([
      { id: 1, conversationId: 'c', role: 'tool', toolCallId: 'tc-1', toolName: 'get_project', toolStatus: 'running', content: '{"a":1}', messageOrder: 2 },
      { id: 2, conversationId: 'c', role: 'tool', toolCallId: 'tc-1', toolName: 'get_project', toolStatus: 'success', content: '项目数据', messageOrder: 3 },
      { id: 3, conversationId: 'c', role: 'assistant', content: '回答', messageOrder: 4 },
    ])
    expect(timeline).toHaveLength(2)
    expect(timeline[0]).toMatchObject({ type: 'tool', id: 'tc-1', name: 'get_project', status: 'done', result: '项目数据', arguments: '{"a":1}' })
    expect(timeline[1]).toEqual({ type: 'content', text: '回答' })
  })

  it('messagesToTimeline: 子 Agent 消息按 parentToolCallId 挂 children; 推理合并', () => {
    const timeline = messagesToTimeline([
      { id: 1, conversationId: 'c', role: 'tool', toolCallId: 'p', toolName: 'generate_storyboard_frame', toolStatus: 'running', content: '{}', messageOrder: 2 },
      { id: 2, conversationId: 'c', role: 'tool', parentToolCallId: 'p', toolCallId: 'child', toolName: 'generate_image', toolStatus: 'success', content: 'img', messageOrder: 3 },
      { id: 3, conversationId: 'c', role: 'assistant', content: '', reasoningContent: '想', reasoningDurationMs: 1200, messageOrder: 4 },
      { id: 4, conversationId: 'c', role: 'assistant', content: '答', messageOrder: 5 },
    ])
    const parent = timeline[0] as Extract<typeof timeline[number], { type: 'tool' }>
    expect(parent.children?.[0]).toMatchObject({ type: 'tool', id: 'child', status: 'done' })
    expect(timeline[1]).toMatchObject({ type: 'reasoning', text: '想', durationMs: 1200 })
    expect(timeline[2]).toEqual({ type: 'content', text: '答' })
  })

  it('uniqueConversations: 按 conversationId 去重并按最近消息时间倒序', () => {
    const a: AgentConversation = { id: 1, conversationId: 'a', userId: 1, projectId: null, title: 'A', messageCount: 1, status: 'completed', lastMessageTime: '2026-01-01T00:00:00Z' }
    const b: AgentConversation = { ...a, conversationId: 'b', lastMessageTime: '2026-02-01T00:00:00Z' }
    const a2: AgentConversation = { ...a, title: 'A2' }
    const merged = uniqueConversations([a], [b, a2])
    expect(merged.map((c) => c.conversationId)).toEqual(['b', 'a'])
    expect(merged[1]?.title).toBe('A2')
  })
})
