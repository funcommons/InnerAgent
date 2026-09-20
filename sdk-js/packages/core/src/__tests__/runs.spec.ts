/**
 * [adapt] Run API 测试 — 源: $SRC/src/api/__tests__/ai-pipeline.spec.ts。
 *
 * 断言行为与源一致, 端点断言重映射为 InnerAgent 契约路径 (02-技术方案 §7.1):
 * run→POST /ia/api/v1/runs、reconnect→GET /runs/{runId}/events (Last-Event-ID)、
 * cancel/confirm/expire→/runs/{runId}/*、status→/runs/{runId}、running→/runs/running。
 * SSE 解析协议 (runId:seq、schemaVersion 1、终态必需) 断言逐条保留。
 * token 来源: 源 useUserStore → 契约 tokenGetter (401 懒换断言保留)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============ mock 基建 (vi.hoisted: 工厂被提升后仍可引用) ============

const mocks = vi.hoisted(() => ({
  httpGet: vi.fn(),
  httpPost: vi.fn(),
  tokenGetter: vi.fn(),
}))

// http 层 mock (查询端点走它); resolveToken/refreshTokenSingleFlight 用真实实现 (共享单飞窗口)
vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return {
    ...actual,
    http: { get: mocks.httpGet, post: mocks.httpPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
  }
})

import { init, resetSdkConfig } from '../config'
import { resetTokenRefreshSingleFlight } from '../client'
import {
  cancelRun,
  confirmRunTools,
  continueRunStream,
  expireRunConfirmation,
  getRunStatus,
  listRunningRuns,
  reconnectRunStream,
  resetRunningListCache,
  startRunStream,
  type AiChatStreamEvent,
} from '../runs'

// ============ SSE 测试工具 ([port] 同源测试范式) ============

const RUN_ID = 'run-1'
const CONV_ID = 'conv-1'
const encoder = new TextEncoder()

/** 组装一个 journal 事件 (schemaVersion 1 + runId + sequence 身份三元组) */
function event(
  sequence: number,
  outputType: AiChatStreamEvent['outputType'],
  extra: Partial<AiChatStreamEvent> = {},
): AiChatStreamEvent {
  return { schemaVersion: 1, runId: RUN_ID, sequence, conversationId: CONV_ID, outputType, ...extra }
}

/** 组装一个合法 SSE 块文本 (id 行 + data 行 + 空行); id 的 runId 取自 data.runId */
function sseBlock(sequence: number, data: object): string {
  const runId = (data as { runId?: string }).runId ?? RUN_ID
  return `id: ${runId}:${sequence}\ndata: ${JSON.stringify(data)}\n\n`
}

/** fetch mock 用: 多 chunk 组成的 200 SSE 流 */
function streamResponse(chunks: string | string[]): Response {
  const list = Array.isArray(chunks) ? chunks : [chunks]
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of list) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  } as unknown as Response
}

/** fetch mock 用: 非 200 + 文本响应体 */
function textResponse(status: number, bodyText: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => bodyText, body: null } as unknown as Response
}

/** 排空微任务队列, 让 fire-and-forget 的流消费链跑完 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

function callOf(fn: { mock: { calls?: unknown[][] } }, index: number): unknown[] {
  const call = fn.mock.calls?.[index]
  expect(call).toBeDefined()
  return call as unknown[]
}

const runReq = {
  message: '解析这段剧本',
  context: { page: 'project-detail', object: { type: 'script', id: 7 } },
  toolExecutionMode: 'DEFAULT',
} as const

describe('runs.startRunStream (POST /ia/api/v1/runs)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    mocks.tokenGetter.mockResolvedValue('tok-1')
    init({ appKey: 'demo', tokenGetter: mocks.tokenGetter })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
  })

  it('run 提交: POST /runs, JSON body = AiChatReq (含 context{page,object}), Bearer token, 返回 AbortController', async () => {
    fetchMock.mockResolvedValue(streamResponse(sseBlock(1, event(1, 'DONE'))))
    const onError = vi.fn()

    const controller = startRunStream(runReq, { onEvent: vi.fn(), onError })
    await flushMicrotasks()

    expect(controller).toBeInstanceOf(AbortController)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/runs')
    expect(req.method).toBe('POST')
    expect(JSON.parse(req.body as string)).toEqual(runReq)
    const headers = new Headers(req.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer tok-1')
    expect(onError).not.toHaveBeenCalled()
  })

  it('SSE 解析: 逐事件 onEvent, 根终态 DONE 触发 onComplete (协议 runId:seq 不变)', async () => {
    const events: AiChatStreamEvent[] = [
      event(1, 'REASONING', { reasoningContent: '思考中' }),
      event(2, 'CONTENT', { content: '剧本解析' }),
      event(3, 'TOOL_CALL_STARTED', { replyId: 'reply-1', toolCalls: [{ id: 'tc-1', name: 'save_script_episode', arguments: '' }] }),
      event(4, 'TOOL_CALL', { replyId: 'reply-1', toolCalls: [{ id: 'tc-1', name: 'save_script_episode', arguments: '{}' }] }),
      event(5, 'TOOL_FINISHED', { toolCallId: 'tc-1', toolName: 'save_script_episode', toolStatus: 'success', toolResult: 'ok' }),
      event(6, 'DONE', { content: '完成' }),
    ]
    fetchMock.mockResolvedValue(streamResponse(events.map((e, i) => sseBlock(i + 1, e))))

    const onEvent = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    startRunStream(runReq, { onEvent, onComplete, onError })
    await flushMicrotasks()

    expect(onEvent).toHaveBeenCalledTimes(6)
    const outputTypes = onEvent.mock.calls?.map((args) => (args[0] as AiChatStreamEvent).outputType)
    expect(outputTypes).toEqual(
      ['REASONING', 'CONTENT', 'TOOL_CALL_STARTED', 'TOOL_CALL', 'TOOL_FINISHED', 'DONE'],
    )
    expect(callOf(onEvent, 2)[0]).toMatchObject({ runId: RUN_ID, sequence: 3, replyId: 'reply-1' })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('跨 chunk 缓冲: 一个 SSE 块被拆到两个 chunk 仍只解析出一个事件', async () => {
    const full = sseBlock(1, event(1, 'CONTENT', { content: '断流重组' }))
    const half = Math.floor(full.length / 2)
    fetchMock.mockResolvedValue(streamResponse([full.slice(0, half), full.slice(half), sseBlock(2, event(2, 'DONE'))]))

    const onEvent = vi.fn()
    startRunStream(runReq, { onEvent })
    await flushMicrotasks()

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect((callOf(onEvent, 0)[0] as AiChatStreamEvent).content).toBe('断流重组')
  })

  it('sequence 去重: sequence <= 游标的事件被静默丢弃', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      sseBlock(1, event(1, 'CONTENT', { content: 'a' })),
      sseBlock(1, event(1, 'CONTENT', { content: '重复' })),
      sseBlock(2, event(2, 'DONE')),
    ]))

    const onEvent = vi.fn()
    startRunStream(runReq, { onEvent })
    await flushMicrotasks()

    expect(onEvent).toHaveBeenCalledTimes(2)
    const contents = onEvent.mock.calls?.map((args) => (args[0] as AiChatStreamEvent).content)
    expect(contents).toEqual(['a', undefined])
  })

  it('CRLF 行尾归一化后仍可解析', async () => {
    const block = `id: ${RUN_ID}:1\r\ndata: ${JSON.stringify(event(1, 'DONE'))}\r\n\r\n`
    fetchMock.mockResolvedValue(streamResponse([block]))

    const onEvent = vi.fn()
    startRunStream(runReq, { onEvent })
    await flushMicrotasks()

    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('流在无终态 journal 事件时结束 → onError "ended before a terminal journal event"', async () => {
    fetchMock.mockResolvedValue(streamResponse(sseBlock(1, event(1, 'CONTENT', { content: '未完' }))))

    const onEvent = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    startRunStream(runReq, { onEvent, onComplete, onError })
    await flushMicrotasks()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((callOf(onError, 0)[0] as Error).message).toBe('Pipeline SSE ended before a terminal journal event')
  })

  it('HTTP 非 200: 抛出响应体 msg 文案', async () => {
    fetchMock.mockResolvedValue(textResponse(500, JSON.stringify({ code: 1, msg: '后端开小差了' })))

    const onError = vi.fn()
    startRunStream(runReq, { onEvent: vi.fn(), onError })
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    expect((callOf(onError, 0)[0] as Error).message).toBe('后端开小差了')
  })

  it('id 与 data 身份不匹配 → onError', async () => {
    fetchMock.mockResolvedValue(streamResponse(
      `id: ${RUN_ID}:1\ndata: ${JSON.stringify(event(2, 'DONE'))}\n\n`,
    ))

    const onError = vi.fn()
    startRunStream(runReq, { onEvent: vi.fn(), onError })
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    expect((callOf(onError, 0)[0] as Error).message).toBe('Pipeline SSE id does not match its data identity')
  })

  it('未知 outputType 被拒绝 (message/progress 之类非 journal 事件进不来)', async () => {
    fetchMock.mockResolvedValue(streamResponse(
      sseBlock(1, event(1, 'progress' as unknown as AiChatStreamEvent['outputType'])),
    ))
    const onError = vi.fn()
    startRunStream(runReq, { onEvent: vi.fn(), onError })
    await flushMicrotasks()
    expect((callOf(onError, 0)[0] as Error).message).toBe('Pipeline SSE outputType is invalid')
  })

  it('SSE 401 → 再次调用 tokenGetter (懒换) → 用新 token 重试成功', async () => {
    mocks.tokenGetter.mockResolvedValueOnce('stale-tok')
      .mockResolvedValue('fresh-tok')
    fetchMock
      .mockResolvedValueOnce(textResponse(401, JSON.stringify({ code: 10200, msg: '未登录' })))
      .mockResolvedValueOnce(streamResponse(sseBlock(1, event(1, 'DONE'))))

    const onEvent = vi.fn()
    const onError = vi.fn()
    startRunStream(runReq, { onEvent, onError })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retryInit = callOf(fetchMock, 1)[1] as RequestInit
    expect(new Headers(retryInit.headers).get('authorization')).toBe('Bearer fresh-tok')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('SSE 并发 401 → 单飞懒换只执行一轮', async () => {
    mocks.tokenGetter.mockImplementation(async () => {
      await Promise.resolve()
      return fetchMock.mock.calls.length < 2 ? 'stale-tok' : 'fresh-tok'
    })
    fetchMock
      .mockImplementationOnce(async () => textResponse(401, ''))
      .mockImplementationOnce(async () => textResponse(401, ''))
      .mockResolvedValue(streamResponse(sseBlock(1, event(1, 'DONE'))))

    startRunStream(runReq, { onEvent: vi.fn() })
    startRunStream(runReq, { onEvent: vi.fn() })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const retryAuths = [callOf(fetchMock, 2), callOf(fetchMock, 3)].map(
      ([, req]) => new Headers((req as RequestInit).headers).get('authorization'),
    )
    expect(retryAuths).toEqual(['Bearer fresh-tok', 'Bearer fresh-tok'])
  })
})

describe('runs.continueRunStream / reconnectRunStream (重映射)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.clearAllMocks()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    mocks.tokenGetter.mockResolvedValue('tok-1')
    init({ appKey: 'demo', tokenGetter: mocks.tokenGetter })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
  })

  it('continue: POST /runs/{runId}/continue, 无请求体 (源 conversationId 查询参数 → runId 路径)', async () => {
    fetchMock.mockResolvedValue(streamResponse(sseBlock(1, { schemaVersion: 1, runId: RUN_ID, sequence: 1, outputType: 'DONE' })))

    continueRunStream(RUN_ID, { onEvent: vi.fn() })
    await flushMicrotasks()

    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/runs/run-1/continue')
    expect(req.method).toBe('POST')
    expect(req.body).toBeUndefined()
  })

  it('continue: 空 runId 同步抛错, 不发起请求', () => {
    expect(() => continueRunStream('  ', { onEvent: vi.fn() })).toThrow('runId is required for Run continuation')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reconnect: GET /runs/{runId}/events + Last-Event-ID 头 (语义不变), 游标从 afterSequence 起', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      sseBlock(1, { schemaVersion: 1, runId: 'run-x', sequence: 1, outputType: 'CONTENT', content: '旧' }),
      sseBlock(2, { schemaVersion: 1, runId: 'run-x', sequence: 2, outputType: 'DONE' }),
    ]))

    const onEvent = vi.fn()
    reconnectRunStream('run-x', 1, { onEvent })
    await flushMicrotasks()

    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/runs/run-x/events')
    expect(req.method).toBe('GET')
    expect(new Headers(req.headers).get('last-event-id')).toBe('run-x:1')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(callOf(onEvent, 0)[0]).toMatchObject({ sequence: 2, outputType: 'DONE' })
  })

  it('reconnect: 非法参数同步抛错', () => {
    expect(() => reconnectRunStream('', 0, { onEvent: vi.fn() })).toThrow('runId is required for Run reconnect')
    expect(() => reconnectRunStream(' run-x', 0, { onEvent: vi.fn() })).toThrow('runId is required for Run reconnect')
    expect(() => reconnectRunStream('run-x', -1, { onEvent: vi.fn() })).toThrow('afterSequence must be a non-negative safe integer')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('runs 查询端点 (http 实例, 契约路径)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    mocks.tokenGetter.mockResolvedValue('tok-1')
    init({ appKey: 'demo', tokenGetter: mocks.tokenGetter })
    resetRunningListCache()
  })
  afterEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
  })

  it('cancelRun: runId → POST /runs/{runId}/cancel (契约); 仅 conversationId → /runs/cancel?conversationId= (兼容兜底)', async () => {
    mocks.httpPost.mockResolvedValue(undefined)
    await cancelRun({ runId: 'run-9' })
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-9/cancel')

    await cancelRun({ conversationId: 'conv-9' })
    expect(mocks.httpPost).toHaveBeenLastCalledWith('/ia/api/v1/runs/cancel?conversationId=conv-9')
  })

  it('confirmRunTools / expireRunConfirmation: POST /runs/{runId}/confirm[,/expire], body 不含 runId', async () => {
    mocks.httpPost.mockResolvedValue(undefined)
    const decisions = [{ toolCallId: 'tc-1', approved: true }]
    await confirmRunTools({ runId: 'run-9', replyId: 'reply-1', decisions })
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-9/confirm', { replyId: 'reply-1', decisions })

    await expireRunConfirmation({ runId: 'run-9', replyId: 'reply-1' })
    expect(mocks.httpPost).toHaveBeenCalledWith('/ia/api/v1/runs/run-9/confirm/expire', { replyId: 'reply-1' })
  })

  it('getRunStatus: runId → GET /runs/{runId}', async () => {
    const status = { runId: 'run-9', status: 'RUNNING', lastSequence: 3 }
    mocks.httpGet.mockResolvedValue(status)
    await expect(getRunStatus({ runId: 'run-9' })).resolves.toBe(status)
    expect(mocks.httpGet).toHaveBeenCalledWith('/ia/api/v1/runs/run-9')
  })

  it('getRunStatus: conversationId → GET /runs/running 匹配; 微缓存内复用同一响应', async () => {
    mocks.httpGet.mockResolvedValue([
      { runId: 'run-9', conversationId: 'conv-9', status: 'RUNNING', lastSequence: 2, title: 't', category: 'assistant', projectId: 1, startedAt: '2026-01-01T00:00:00Z' },
    ])
    const first = await getRunStatus({ conversationId: 'conv-9' })
    const second = await getRunStatus({ conversationId: 'conv-9' })
    expect(first).toMatchObject({ runId: 'run-9', status: 'RUNNING', lastSequence: 2 })
    expect(second).toEqual(first)
    expect(mocks.httpGet).toHaveBeenCalledTimes(1)
  })

  it('getRunStatus: conversationId 不在运行列表 → 合成 COMPLETED 终态 (running 列表即运行中集合)', async () => {
    mocks.httpGet.mockResolvedValue([])
    await expect(getRunStatus({ conversationId: 'conv-none' })).resolves.toEqual({
      runId: '', status: 'COMPLETED', lastSequence: 0,
    })
  })

  it('listRunningRuns: GET /runs/running', async () => {
    const runs = [{ runId: 'run-9', conversationId: 'conv-9', projectId: 1, title: 't', category: 'c', status: 'RUNNING', lastSequence: 0, startedAt: '2026-01-01T00:00:00Z' }]
    mocks.httpGet.mockResolvedValue(runs)
    await expect(listRunningRuns()).resolves.toBe(runs)
    expect(mocks.httpGet).toHaveBeenCalledWith('/ia/api/v1/runs/running')
  })
})
