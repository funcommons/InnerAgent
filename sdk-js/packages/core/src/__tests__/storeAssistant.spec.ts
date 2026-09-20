/**
 * [port] store/assistant 测试 — 源: $SRC/src/store/__tests__/assistant.spec.ts。
 *
 * 断言行为 1:1 保留; 适配点:
 * - mock '@/api/request' → '../client' (http); '@/store/user' → 契约 init(tokenGetter)
 * - 端点断言重映射: conversations→/ia/api/v1/conversations*、run→POST /runs、
 *   cancel/confirm/expire→/runs/{runId}/*、reconnect→GET /runs/{runId}/events、
 *   status-by-conversation→GET /runs/running (微缓存 + 匹配)
 * - localStorage key: fusion-assistant:* → inneragent-assistant:* ([adapt])
 * - 新增契约用例: 请求体增 context{page,object} (setRunContext 注入)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// ============ mock 基建 ============

const mocks = vi.hoisted(() => ({
  httpGet: vi.fn(),
  httpPost: vi.fn(),
  httpDelete: vi.fn(),
}))

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return {
    ...actual,
    http: { get: mocks.httpGet, post: mocks.httpPost, put: vi.fn(), delete: mocks.httpDelete },
  }
})

import { init, resetSdkConfig } from '../config'
import { setRunContext, clearRunContext } from '../pageContext'
import { resetTokenRefreshSingleFlight } from '../client'
import { resetRunningListCache, type PendingToolCallInfo } from '../runs'
import { normalizeToolCallScope, pendingScopeDigest } from '../scope'
import { useAssistantStore } from '../store/assistant'
import type { AgentConversation } from '../conversations'

// ============ SSE 测试工具 (同源测试范式) ============

const encoder = new TextEncoder()

function sseBlock(sequence: number, data: object, runId = 'run-1'): string {
  return `id: ${runId}:${sequence}\ndata: ${JSON.stringify({ schemaVersion: 1, runId, sequence, conversationId: 'conv-1', ...data })}\n\n`
}

function manualStream(): { response: Response; push: (text: string) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  return {
    response: { ok: true, status: 200, body } as unknown as Response,
    push: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 11,
    conversationId: 'conv-1',
    userId: 1,
    projectId: null,
    category: 'assistant',
    title: '旧会话',
    messageCount: 2,
    status: 'completed',
    ...overrides,
  }
}

function runningEntry(status: string, lastSequence: number): Record<string, unknown> {
  return {
    runId: 'run-9', conversationId: 'conv-1', projectId: 1, title: '旧会话', category: 'assistant',
    status, lastSequence, startedAt: '2026-01-01T00:00:00Z',
  }
}

function callOf(fn: { mock: { calls?: unknown[][] } }, index: number): unknown[] {
  const call = fn.mock.calls?.[index]
  expect(call).toBeDefined()
  return call as unknown[]
}

async function tick(ms = 16): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function freshSdk(): void {
  resetSdkConfig()
  resetTokenRefreshSingleFlight()
  resetRunningListCache()
  init({ appKey: 'demo', tokenGetter: async () => 'tok-1' })
}

describe('store/assistant (会话加载 / 选择 / 历史回放)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => setTimeout(() => cb(0), 16))
    localStorage.clear()
    setActivePinia(createPinia())
    freshSdk()
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
    clearRunContext()
  })

  it('initializeForUser: 拉取第 1 页 (pageSize 20, category assistant), 构建 runtime, 恢复选中', async () => {
    mocks.httpGet.mockResolvedValue({
      list: [conversation(), conversation({ conversationId: 'conv-pipeline', category: 'pipeline' })],
      total: 21,
    })
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)

    expect(mocks.httpGet).toHaveBeenCalledExactlyOnceWith(
      '/ia/api/v1/conversations?pageNo=1&pageSize=20&category=assistant',
    )
    // 非 assistant 类别的会话被过滤
    expect(store.conversations).toHaveLength(1)
    expect(store.conversationStates['conv-1']).toBeTruthy()
    expect(store.conversationStates['conv-pipeline']).toBeUndefined()
    expect(store.conversationPage).toBe(1)
    expect(store.hasMoreConversations).toBe(true)
    expect(store.conversationStates['conv-1']?.messagesLoaded).toBe(false)
  })

  it('selectConversation (窗口打开): 拉消息 + mergeMessages 回放 timeline', async () => {
    mocks.httpGet
      .mockResolvedValueOnce({ list: [conversation()], total: 1 })
      .mockResolvedValueOnce([
        { id: 1, conversationId: 'conv-1', role: 'user', content: '问题', messageOrder: 1 },
        { id: 2, conversationId: 'conv-1', role: 'assistant', content: '回答', messageOrder: 2 },
      ])
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.selectConversation('conv-1')
    await tick(0)

    expect(mocks.httpGet).toHaveBeenLastCalledWith('/ia/api/v1/conversations/conv-1/messages')
    const runtime = store.conversationStates['conv-1']
    expect(runtime?.messagesLoaded).toBe(true)
    expect(runtime?.messages).toHaveLength(2)
    expect(runtime?.pipeline.timeline).toEqual([{ type: 'content', text: '回答' }])
  })

  it('loadMoreConversations: 翻页 + conversationId 去重', async () => {
    mocks.httpGet
      .mockResolvedValueOnce({ list: [conversation()], total: 2 })
      .mockResolvedValueOnce({ list: [conversation(), conversation({ id: 12, conversationId: 'conv-2', title: '第二页' })], total: 2 })
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.loadMoreConversations()
    await tick(0)

    expect(mocks.httpGet).toHaveBeenLastCalledWith('/ia/api/v1/conversations?pageNo=2&pageSize=20&category=assistant')
    expect(store.conversations.map((c) => c.conversationId)).toEqual(['conv-1', 'conv-2'])
    expect(store.hasMoreConversations).toBe(false)
    expect(store.conversationPage).toBe(2)
  })

  it('deleteConversation: 运行中拒绝; 乐观会话 (id<0) 走 by-conversation-id', async () => {
    mocks.httpGet
      .mockResolvedValueOnce({ list: [conversation()], total: 1 })
      .mockResolvedValue([])
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)

    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    store.setOpen(true)
    await store.sendMessage('新消息', null, null)
    await tick(0)
    const optimisticId = store.selectedConversationId
    expect(optimisticId).toBeTruthy()
    await expect(store.deleteConversation(optimisticId!, -Date.now())).rejects.toThrow('运行中的会话不能删除')

    stream.push(sseBlock(1, { outputType: 'DONE' }))
    stream.close()
    await tick(32)
    mocks.httpDelete.mockResolvedValue(undefined)
    await store.deleteConversation(optimisticId!, -1)
    expect(mocks.httpDelete).toHaveBeenCalledWith(
      '/ia/api/v1/conversations/by-conversation-id/' + optimisticId,
    )
    expect(store.conversations.find((c) => c.conversationId === optimisticId)).toBeUndefined()
    expect(store.selectedConversationId).toBeNull()
  })
})

describe('store/assistant (发送消息 + SSE 事件驱动)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => setTimeout(() => cb(0), 16))
    localStorage.clear()
    setActivePinia(createPinia())
    freshSdk()
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.httpGet.mockResolvedValue({ list: [], total: 0 })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
    clearRunContext()
  })

  it('sendMessage 新会话: 乐观会话置顶选中 + POST /runs 契约 (agentType/assistant/标题/执行模式)', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    store.setToolExecutionMode('ALWAYS_ASK')

    await store.sendMessage('  帮我生成分镜  ', 5, 'high', undefined, undefined)
    await tick(0)

    const conversationId = store.selectedConversationId
    expect(conversationId).toBeTruthy()
    const optimistic = store.conversations[0]
    expect(optimistic!.id).toBeLessThan(0)
    expect(optimistic!.category).toBe('assistant')
    expect(optimistic!.title).toBe('帮我生成分镜')
    expect(store.newDraft).toBe('')

    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/runs')
    const body = JSON.parse(req.body as string)
    expect(body).toMatchObject({
      message: '帮我生成分镜',
      conversationId,
      modelId: 5,
      reasoningEffort: 'high',
      agentType: 'ai_media',
      category: 'assistant',
      title: '帮我生成分镜',
      toolExecutionMode: 'ALWAYS_ASK',
    })

    // SSE 事件驱动 runtime (store 每次更新替换 runtime 对象, 需实时读取)
    stream.push(sseBlock(1, { outputType: 'CONTENT', content: '好的' }))
    await tick(32)
    const runtime = store.conversationStates[conversationId!]
    expect(runtime?.pipeline.timeline).toEqual([{ type: 'content', text: '好的' }])
    expect(runtime?.status).toBe('running')

    stream.push(sseBlock(2, { outputType: 'DONE', content: '，完成' }))
    await tick(32)
    const settled = store.conversationStates[conversationId!]
    expect(settled?.status).toBe('completed')
    expect(settled?.pipeline.timeline[0]).toEqual({ type: 'content', text: '好的，完成' })
    expect(settled?.statusConfirmed).toBe(true)
    expect(settled?.pipeline.runId).toBe('run-1')
  })

  it('契约: setRunContext({page,object}) 注入请求体 context (02-技术方案 §7.1)', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    setRunContext({ page: 'project-detail', object: { type: 'script', id: 7 } })
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)

    await store.sendMessage('带上下文', null, null)
    await tick(0)

    const body = JSON.parse((callOf(fetchMock, 0)[1] as RequestInit).body as string)
    expect(body.context).toEqual({ page: 'project-detail', object: { type: 'script', id: 7 } })
  })

  it('sendMessage 防重入: 运行中再发抛错; 空消息忽略', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)

    await expect(store.sendMessage('', 5, null)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()

    await store.sendMessage('第一句', null, null)
    await tick(0)
    await expect(store.sendMessage('第二句', null, null)).rejects.toThrow('当前会话仍在生成中')
  })

  it('start 分支连接失败 (无 runId): 会话置 failed 并写 connectionError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => JSON.stringify({ code: 1, msg: '模型未配置' }), body: null } as unknown as Response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('触发失败', null, null)
    await tick(32)

    const conversationId = store.selectedConversationId!
    const runtime = store.conversationStates[conversationId]
    expect(runtime?.status).toBe('failed')
    expect(runtime?.connectionError).toContain('模型未配置')
  })

  it('stopGeneration: cancelRun({runId}) → POST /runs/{runId}/cancel; SSE CANCELLED 落终态', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response) // /runs
    mocks.httpPost.mockResolvedValue(undefined) // /cancel
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('要取消的', null, null)
    await tick(0)
    stream.push(sseBlock(1, { outputType: 'CONTENT', content: '输出' }))
    await tick(32)

    await store.stopGeneration()
    await tick(0)
    const conversationId = store.selectedConversationId!
    expect(store.conversationStates[conversationId]?.status).toBe('CANCEL_REQUESTED')
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-1/cancel')

    stream.push(sseBlock(2, { outputType: 'CANCELLED' }))
    await tick(32)
    expect(store.conversationStates[conversationId]?.status).toBe('cancelled')
  })
})

describe('store/assistant (工具确认: 单个/批量/过期 + reconnect 续流)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => setTimeout(() => cb(0), 16))
    localStorage.clear()
    setActivePinia(createPinia())
    freshSdk()
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.httpGet.mockResolvedValue({ list: [], total: 0 })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
    clearRunContext()
  })

  /** 推进到「双工具等待确认」场景, 返回悬挂的 /runs 流 */
  async function setupPendingConfirmation(): Promise<{ stream: ReturnType<typeof manualStream>; store: ReturnType<typeof useAssistantStore>; conversationId: string }> {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('执行写入', null, null)
    await tick(0)
    const conversationId = store.selectedConversationId!
    stream.push(sseBlock(1, {
      outputType: 'TOOL_CALL', replyId: 'reply-1',
      toolCalls: [
        { id: 'tc-1', name: 'save_script_episode', arguments: '{}' },
        { id: 'tc-2', name: 'save_script_episode', arguments: '{}' },
      ],
    }))
    await tick(32)
    stream.push(sseBlock(2, {
      outputType: 'USER_CONFIRMATION_REQUIRED', replyId: 'reply-1',
      expiresAt: '2030-01-01T00:00:00Z',
      pendingToolCalls: [
        { toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}' },
        { toolCallId: 'tc-2', toolName: 'save_script_episode', argumentsPreview: '{}' },
      ],
    }))
    await tick(32)
    return { stream, store, conversationId }
  }

  it('USER_CONFIRMATION_REQUIRED → pendingConfirmation + 工具 awaiting_approval + 状态 WAITING_CONFIRMATION', async () => {
    const { store, conversationId } = await setupPendingConfirmation()
    const runtime = store.conversationStates[conversationId]
    expect(runtime?.status).toBe('WAITING_CONFIRMATION')
    expect(runtime?.pipeline.pendingConfirmation).toMatchObject({
      runId: 'run-1', replyId: 'reply-1', submitting: false,
    })
    expect(runtime?.pipeline.pendingConfirmation?.toolCalls).toHaveLength(2)
    expect(runtime?.pipeline.timeline[0]).toMatchObject({ status: 'awaiting_approval' })
  })

  it('单个决定→批量决定集齐后提交 /runs/{runId}/confirm, 随后 reconnect (GET /runs/{runId}/events) 续流', async () => {
    const { store, conversationId } = await setupPendingConfirmation()
    const reconnectStream = manualStream()
    mocks.httpPost.mockResolvedValue(undefined) // /confirm
    fetchMock.mockResolvedValue(reconnectStream.response) // confirm 后 reconnect

    await store.respondToToolConfirmation('tc-1', true)
    await tick(0)
    expect(mocks.httpPost).not.toHaveBeenCalled()
    let pending = store.conversationStates[conversationId]?.pipeline.pendingConfirmation
    expect(pending?.decisions).toEqual({ 'tc-1': true })

    await store.respondToToolConfirmation('tc-2', false)
    await tick(0)
    expect(mocks.httpPost).toHaveBeenCalledTimes(1)
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-1/confirm', {
      replyId: 'reply-1',
      decisions: [
        { toolCallId: 'tc-1', approved: true },
        { toolCallId: 'tc-2', approved: false },
      ],
    })
    pending = store.conversationStates[conversationId]?.pipeline.pendingConfirmation
    expect(pending?.submitting).toBe(true)

    // confirm 成功 → 显式 reconnect (Last-Event-ID = run-1:2)
    await tick(32)
    const [reconnectUrl, reconnectInit] = callOf(fetchMock, 1) as [string, RequestInit]
    expect(reconnectUrl).toBe('/ia/api/v1/runs/run-1/events')
    expect(new Headers(reconnectInit.headers).get('last-event-id')).toBe('run-1:2')

    reconnectStream.push(sseBlock(3, {
      outputType: 'USER_CONFIRM_RESULT', replyId: 'reply-1',
      decisions: [
        { toolCallId: 'tc-1', approved: true },
        { toolCallId: 'tc-2', approved: false },
      ],
    }))
    await tick(32)
    const runtime = store.conversationStates[conversationId]
    expect(runtime?.pipeline.pendingConfirmation).toBeUndefined()
    expect(runtime?.pipeline.timeline[0]).toMatchObject({ status: 'approved' })
    expect(runtime?.pipeline.timeline[1]).toMatchObject({ status: 'rejected' })
  })

  it('respondToAllToolConfirmations: 一键全批 → 直接提交 confirm', async () => {
    const { store } = await setupPendingConfirmation()
    mocks.httpPost.mockResolvedValue(undefined)
    await store.respondToAllToolConfirmations(true)
    await tick(0)
    expect(mocks.httpPost).toHaveBeenCalledTimes(1)
    const body = mocks.httpPost.mock.calls[0]?.[1] as { decisions: Array<{ toolCallId: string; approved: boolean }> }
    expect(body.decisions).toEqual([
      { toolCallId: 'tc-1', approved: true },
      { toolCallId: 'tc-2', approved: true },
    ])
  })

  it('已过期的确认: 决定不提交, 转状态轮询; expireToolConfirmation 提交 /runs/{runId}/confirm/expire', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('过期场景', null, null)
    await tick(0)
    stream.push(sseBlock(1, {
      outputType: 'TOOL_CALL', replyId: 'reply-1',
      toolCalls: [{ id: 'tc-1', name: 'generate_image', arguments: '{}' }],
    }))
    stream.push(sseBlock(2, {
      outputType: 'USER_CONFIRMATION_REQUIRED', replyId: 'reply-1',
      expiresAt: '2000-01-01T00:00:00Z', // 已过期
      pendingToolCalls: [{ toolCallId: 'tc-1', toolName: 'generate_image', argumentsPreview: '{}' }],
    }))
    await tick(32)

    await store.respondToAllToolConfirmations(true)
    await tick(0)
    expect(mocks.httpPost).not.toHaveBeenCalled()

    mocks.httpPost.mockResolvedValue(undefined)
    await store.expireToolConfirmation()
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-1/confirm/expire', {
      replyId: 'reply-1',
    })
  })

  // [new] P2-scope 任务 #15:确认等待事件 scope 字段 —— 事件→store→提取全链
  it('USER_CONFIRMATION_REQUIRED 的 scope 字段进 store;normalize/pendingScopeDigest 可提取(旧事件缺字段归一 degraded)', async () => {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('带约束范围的确认', null, null)
    await tick(0)
    const conversationId = store.selectedConversationId!
    stream.push(sseBlock(1, {
      outputType: 'TOOL_CALL', replyId: 'reply-1',
      toolCalls: [
        { id: 'tc-1', name: 'save_script_episode', arguments: '{}' },
        { id: 'tc-2', name: 'query_contact', arguments: '{}' },
      ],
    }))
    stream.push(sseBlock(2, {
      outputType: 'USER_CONFIRMATION_REQUIRED', replyId: 'reply-1',
      expiresAt: '2030-01-01T00:00:00Z',
      pendingToolCalls: [
        {
          toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}',
          scope: { resolved: false, degraded: true, summary: '宿主未实现约束范围反查' },
        },
        {
          toolCallId: 'tc-2', toolName: 'query_contact', argumentsPreview: '{}',
          scope: { resolved: true, degraded: false },
        },
      ],
    }))
    await tick(32)

    const runtime = store.conversationStates[conversationId]
    const pending = runtime?.pipeline.pendingConfirmation
    expect(pending?.toolCalls?.[0]?.scope).toEqual({ resolved: false, degraded: true, summary: '宿主未实现约束范围反查' })
    expect(pending?.toolCalls?.[1]?.scope).toEqual({ resolved: true, degraded: false })
    // 提取层:任一 degraded → 整批 degraded(fail-closed),degraded 摘要优先
    expect(pendingScopeDigest(pending?.toolCalls)).toEqual({
      resolved: false, degraded: true, summary: '宿主未实现约束范围反查',
    })
    // 旧事件兼容:无 scope 字段 → 归一化为 degraded(弱提示,不抛协议错)
    const legacyToolCalls: PendingToolCallInfo[] = [
      { toolCallId: 'tc-1', toolName: 'legacy', argumentsPreview: '{}' },
    ]
    expect(normalizeToolCallScope(legacyToolCalls[0]?.scope)).toEqual({
      resolved: false, degraded: true,
    })

    // 决策提交链不受 scope 字段影响(decisions 仅 toolCallId/approved)
    mocks.httpPost.mockResolvedValue(undefined)
    await store.respondToAllToolConfirmations(true)
    await tick(0)
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-1/confirm', {
      replyId: 'reply-1',
      decisions: [
        { toolCallId: 'tc-1', approved: true },
        { toolCallId: 'tc-2', approved: true },
      ],
    })
  })
})

describe('store/assistant (后台状态轮询 / 持久化)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => setTimeout(() => cb(0), 16))
    localStorage.clear()
    setActivePinia(createPinia())
    freshSdk()
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
    clearRunContext()
  })

  it('后台轮询: 非选中运行中会话经 GET /runs/running 匹配; 消失于列表 → 合成终态 + 未读标记', async () => {
    mocks.httpGet
      .mockResolvedValueOnce({ list: [conversation({ status: 'running' })], total: 1 })
      .mockResolvedValueOnce([runningEntry('RUNNING', 1)])
      .mockResolvedValueOnce([]) // 第二轮: run 已不在运行列表 → 合成 COMPLETED
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(false)
    await tick(1100)

    expect(mocks.httpGet).toHaveBeenLastCalledWith('/ia/api/v1/runs/running')
    expect(store.conversationStates['conv-1']?.status).toBe('running')
    expect(store.conversationStates['conv-1']?.statusConfirmed).toBe(true)
    expect(store.conversationStates['conv-1']?.knownRunId).toBe('run-9')

    await tick(2100)
    const runtime = store.conversationStates['conv-1']
    expect(runtime?.status).toBe('completed')
    expect(runtime?.unread).toBe(true)
  })

  it('持久化: 草稿/选中会话/执行模式写入 localStorage (inneragent-assistant:*), initializeForUser 恢复', async () => {
    mocks.httpGet.mockResolvedValue({ list: [], total: 0 })
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setDraft(null, '未发送的草稿')
    store.setToolExecutionMode('ALWAYS_ALLOW')
    await tick(300) // 250ms debounce

    const raw = localStorage.getItem('inneragent-assistant:1:v1')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw!)
    expect(persisted.drafts).toMatchObject({ __new__: '未发送的草稿' })
    expect(persisted.newToolExecutionMode).toBe('ALWAYS_ALLOW')

    setActivePinia(createPinia())
    const store2 = useAssistantStore()
    store2.initializeForUser(1)
    await tick(0)
    expect(store2.newDraft).toBe('未发送的草稿')
    expect(store2.newToolExecutionMode).toBe('ALWAYS_ALLOW')
  })

  it('resetForUser: 清空会话/断连/清持久化定时器', async () => {
    mocks.httpGet.mockResolvedValue({ list: [conversation()], total: 1 })
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.resetForUser()
    expect(store.initialized).toBe(false)
    expect(store.hydratedUserId).toBeNull()
    expect(store.conversations).toHaveLength(0)
    expect(store.conversationStates).toEqual({})
  })
})
