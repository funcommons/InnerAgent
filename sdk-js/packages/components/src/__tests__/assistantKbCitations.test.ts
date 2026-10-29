/**
 * [new] P4-W14 mini KB 引用溯源 — 助手消息「引用资料」折叠区 (红测试, 先于实现)。
 *
 * 契约 (PRD M5「回答须可溯源, 展示来源」; 服务端已就绪, 本文件钉住前端缺口):
 * - 到达形态 (已核实): AiChatStreamRespVO.kbCitations
 *   (KbCitationVO{chunkId,documentId,documentTitle,anchor,seq}, 无 content —— content
 *   仅存在于服务端 KbHit, 不上网) 随根终态 DONE 事件投影 (AgentRunQueryService
 *   §kbCitations L325-338: 事件载荷透传优先, 否则仅 DONE 从 ia_agent_run.kb_citations_json
 *   回填); 消息轮询 GET /conversations/{id}/messages 的 AgentMessage 无引用列 ——
 *   引用只经 live SSE 到达, 历史回放不带。
 * - 渲染: assistant 消息带 kbCitations(≥1) → 气泡下方「引用资料」区: 默认折叠,
 *   头部显示条数 (「引用资料 · 3」); 点击展开列表 (每条 documentTitle, anchor 有则
 *   追加「 § anchor」; title 优先; content 不进正文, 仅条目 title 属性可含截断);
 *   0 条/字段缺失 → 不渲染任何引用 DOM; 多条按服务端顺序; 与用户附件 chips 互不影响;
 *   字段半缺 (如无 anchor) 渲染不崩, 缺省段省略。
 * - store 落位: DONE 事件 kbCitations 经 reduceAssistantEvent 捕获进 pipeline 状态
 *   (AgentPipelineState.kbCitations 新字段); 消息载体为 AgentMessage.kbCitations
 *   (core conversations.ts 新可选字段), 渲染输入为消息 (与附件 #14 同范式)。
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

import AssistantMessageList from '../assistant/AssistantMessageList.vue'
import { messageKbCitations } from '../assistant/assistantKbCitations'
import { reduceAssistantEvent, createPendingPipelineState } from '@inneragent/sdk-core'
import type { AgentMessage, AiChatStreamEvent } from '@inneragent/sdk-core'

/** 服务端 DONE 事件携带的引用 (KbCitationVO 线上形态; content 不上网) */
const serverCitations = [
  { chunkId: 101, documentId: 11, documentTitle: '员工手册', anchor: '2.1 报销流程', seq: 0 },
  { chunkId: 102, documentId: 12, documentTitle: '差旅制度', anchor: '4 住宿标准', seq: 1 },
  { chunkId: 103, documentId: 13, documentTitle: '合同模板', seq: 2 },
]

function assistantMessage(kbCitations?: unknown[], content = '报销流程见手册。'): AgentMessage {
  return {
    id: 2,
    conversationId: 'conv-1',
    role: 'assistant',
    content,
    ...(kbCitations !== undefined ? { kbCitations } : {}),
    messageOrder: 2,
  } as AgentMessage
}

function historyRuntime(messages: AgentMessage[]) {
  return {
    conversation: makeConversation(),
    status: 'completed',
    statusConfirmed: true,
    unread: false,
    draft: '',
    toolExecutionMode: 'DEFAULT',
    messages,
    messagesLoaded: true,
    messagesLoading: false,
    reconnecting: false,
    pipeline: { status: 'idle', reasoningText: '', timeline: [], lastSequence: 0 },
  }
}

async function mountList(messages: AgentMessage[]) {
  fake.conversationStates = { 'conv-1': historyRuntime(messages) }
  const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
  await nextTick()
  await nextTick()
  return wrapper
}

describe('messageKbCitations (消息引用视图纯逻辑, 红: 新模块 assistantKbCitations)', () => {
  it('3 条引用 → 视图保序, 字段按 KbCitationVO 映射 (title 优先)', () => {
    const views = messageKbCitations(assistantMessage(serverCitations))
    expect(views).toHaveLength(3)
    expect(views[0]).toMatchObject({
      chunkId: 101, documentId: 11, documentTitle: '员工手册', anchor: '2.1 报销流程', seq: 0,
    })
    // 服务端顺序 = 视图顺序
    expect(views.map((view) => view.documentTitle)).toEqual(['员工手册', '差旅制度', '合同模板'])
  })

  it('content 仅作 tooltip 截断保留 (不进正文); 缺 content 缺省', () => {
    const long = '报销需提供发票原件及审批单号,超出标准需提前审批。'.repeat(10)
    const views = messageKbCitations(assistantMessage([
      { chunkId: 1, documentId: 2, documentTitle: '手册', content: long },
      { chunkId: 2, documentId: 3, documentTitle: '无正文' },
    ]))
    expect(views[0]?.content).toBeDefined()
    expect(views[0]?.content!.length).toBeLessThanOrEqual(120)
    expect(views[1]?.content).toBeUndefined()
  })

  it('安全回退: 无消息/字段缺失/空数组/非数组/非对象项 → 空集', () => {
    expect(messageKbCitations(undefined)).toEqual([])
    expect(messageKbCitations(assistantMessage())).toEqual([])
    expect(messageKbCitations(assistantMessage([]))).toEqual([])
    expect(messageKbCitations(assistantMessage('nope' as unknown as unknown[]))).toEqual([])
    expect(messageKbCitations(assistantMessage(['junk', 42, null]))).toEqual([])
  })

  it('字段半缺: 无 documentTitle 的项跳过; 无 anchor/seq 的项保留并省略缺省段', () => {
    const views = messageKbCitations(assistantMessage([
      { anchor: '§3', chunkId: 9 },
      { chunkId: 103, documentId: 13, documentTitle: '合同模板' },
    ]))
    expect(views).toEqual([
      expect.objectContaining({ chunkId: 103, documentTitle: '合同模板' }),
    ])
    expect(views[0]?.anchor).toBeUndefined()
    expect(views[0]?.seq).toBeUndefined()
  })
})

describe('AssistantMessageList — 「引用资料」折叠区 (assistant 气泡下方)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation()]
    fake.conversationStates = {}
  })

  it('有 3 条 → 折叠头存在且计数 = 3; 默认不渲染列表项', async () => {
    const wrapper = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '报销怎么走?', messageOrder: 1 },
      assistantMessage(serverCitations),
    ])
    const region = wrapper.find('[data-testid="assistant-kb-citations"]')
    expect(region.exists()).toBe(true)
    const toggle = wrapper.find('[data-testid="assistant-kb-citations-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toMatch(/引用资料\s*·\s*3/)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="assistant-kb-citations-list"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点击折叠头 → 列表展开, 顺序同服务端, title/anchor 文案正确; content 不进正文', async () => {
    const wrapper = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '报销怎么走?', messageOrder: 1 },
      assistantMessage(serverCitations),
    ])
    await wrapper.find('[data-testid="assistant-kb-citations-toggle"]').trigger('click')
    await nextTick()
    const list = wrapper.find('[data-testid="assistant-kb-citations-list"]')
    expect(list.exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-kb-citations-toggle"]').attributes('aria-expanded'))
      .toBe('true')
    const items = list.findAll('[data-testid^="assistant-kb-citation-"]')
    expect(items).toHaveLength(3)
    expect(items[0]?.text()).toContain('员工手册')
    expect(items[0]?.text()).toContain('§ 2.1 报销流程')
    expect(items[1]?.text()).toContain('差旅制度')
    expect(items[1]?.text()).toContain('§ 4 住宿标准')
    // 无 anchor 的第 3 条: title 正常, 缺省段省略 (无「§」)
    expect(items[2]?.text()).toContain('合同模板')
    expect(items[2]?.text()).not.toContain('§')
    wrapper.unmount()
  })

  it('citations 字段缺失 / 空数组 → 引用 DOM 零命中', async () => {
    const without = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '问', messageOrder: 1 },
      assistantMessage(),
    ])
    expect(without.find('[data-testid="assistant-kb-citations"]').exists()).toBe(false)
    without.unmount()
    const empty = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '问', messageOrder: 1 },
      assistantMessage([]),
    ])
    expect(empty.find('[data-testid="assistant-kb-citations"]').exists()).toBe(false)
    empty.unmount()
  })

  it('引用与用户附件同时存在 → 两者都渲染, 互不影响', async () => {
    const referencesJson = JSON.stringify({
      version: 2,
      projectId: null,
      project: null,
      skills: [],
      mcpTools: [],
      attachments: [{
        id: 'att-file-1', name: '报告.pdf', inputType: 'file', mimeType: 'application/pdf',
        transport: 'url', resourceUrl: '/attachments/att-file-1', size: 1048576,
      }],
    })
    const wrapper = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '结合资料分析', referencesJson, messageOrder: 1 },
      assistantMessage(serverCitations),
    ])
    const attachments = wrapper.find('[data-testid="assistant-user-attachments"]')
    expect(attachments.exists()).toBe(true)
    expect(attachments.findAll('.assistant-attachment-chip')).toHaveLength(1)
    const toggle = wrapper.find('[data-testid="assistant-kb-citations-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toMatch(/引用资料\s*·\s*3/)
    wrapper.unmount()
  })

  it('异常形态 (字段半缺) → 渲染不崩, 仅显示可得的 title', async () => {
    const wrapper = await mountList([
      { id: 1, conversationId: 'conv-1', role: 'user', content: '问', messageOrder: 1 },
      assistantMessage([
        { chunkId: 103, documentId: 13, documentTitle: '合同模板' },
        { anchor: '§3', chunkId: 9 },
      ]),
    ])
    const region = wrapper.find('[data-testid="assistant-kb-citations"]')
    expect(region.exists()).toBe(true)
    expect(region.text()).toMatch(/引用资料\s*·\s*1/)
    expect(wrapper.find('[data-testid="assistant-kb-citations-list"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('citations 服务端透传 (store 落位: DONE → reducer 捕获)', () => {
  function evt(sequence: number, outputType: string, extra: Record<string, unknown> = {}): AiChatStreamEvent {
    return {
      schemaVersion: 1,
      runId: 'run-1',
      sequence,
      conversationId: 'conv-1',
      outputType,
      ...extra,
    } as AiChatStreamEvent
  }

  it('根终态 DONE 携带 kbCitations → pipeline 状态捕获且保序 (AgentPipelineState.kbCitations 新字段)', () => {
    let state = createPendingPipelineState()
    state = reduceAssistantEvent(state, evt(1, 'CONTENT', { content: '回答' }))
    expect(state.kbCitations).toBeUndefined()
    state = reduceAssistantEvent(state, evt(2, 'DONE', { kbCitations: serverCitations }))
    expect(state.kbCitations).toEqual(serverCitations)
  })

  it('DONE 无 kbCitations → 不设置 (不残留); 空 citations 不产生非空捕获', () => {
    let state = createPendingPipelineState()
    state = reduceAssistantEvent(state, evt(1, 'DONE', {}))
    expect(state.kbCitations).toBeUndefined()
    state = reduceAssistantEvent(state, evt(2, 'DONE', { kbCitations: [] }))
    expect(state.kbCitations).toEqual([])
  })
})
