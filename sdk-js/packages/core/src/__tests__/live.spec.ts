// @vitest-environment node
/**
 * [new] P1 出口验收 · SDK core 活体测试(对真实 inneragent-server 打,默认 skip)。
 *
 * 启用方式(缺省不启用,常规 `pnpm test` 下全部用例 skip、0 失败):
 *
 *   IA_LIVE_BASE=http://localhost:18090 \
 *     pnpm vitest run packages/core/src/__tests__/live.spec.ts
 *
 * - IA_LIVE_BASE:服务端基址(local profile,端口默认 18090)。未设置 → 整文件 skip。
 * - IA_LIVE_DEMO_USER:演示用户 id,默认 '12993'(服务端 local profile 匿名演示头)。
 * - 认证:测试内以 fetch 包装器给所有出站请求注入 `X-IA-Demo-User` 头
 *   (SDK 契约的 Authorization 通道由 tokenGetter 承担,这里恒 null);
 *   **断言对象全部是 @inneragent/sdk-core 的真实导出函数**
 *   (init/http/startRunStream/reconnectRunStream/getRunStatus/listRunningRuns/
 *    cancelRun/listConversations/aiModelApi/uploadAttachment/ApiError)。
 * - 覆盖旅程:POST /runs 建会话(SSE)→ 中途断开 →
 *   Last-Event-ID 重连 /runs/{runId}/events 续流(补齐 CONTENT 增量)→ 终态 DONE →
 *   GET /runs/{runId} 终态字段 → /runs/running?conversationId= 过滤 →
 *   /conversations 列表可见 → 兜底取消 POST /runs/cancel?conversationId=(新会话)→
 *   404 语义(不存在的 run)→ 附件上传(POST /attachments,mock 模型)。
 * - 依赖服务端 V4/V7 seed 的 mock 模型(mock-text,platform='mock')与
 *   demo Agent(agentType='demo',内置 get_current_time 工具)。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  aiModelApi,
  cancelRun,
  confirmRunTools,
  getBaseURL,
  getRunStatus,
  http,
  init,
  listConversations,
  listRunningRuns,
  reconnectRunStream,
  resetRunningListCache,
  resetSdkConfig,
  startRunStream,
  uploadAttachment,
  type AiChatStreamEvent,
  type RunningRun,
} from '../index'

const LIVE_BASE = process.env.IA_LIVE_BASE?.trim() ?? ''
const DEMO_USER = process.env.IA_LIVE_DEMO_USER?.trim() || '12993'
// SDK 契约 baseURL 含 API 前缀(默认 '/ia/api/v1');活体目标 = <IA_LIVE_BASE>/ia/api/v1
const API_BASE = `${LIVE_BASE.replace(/\/+$/, '')}/ia/api/v1`

const describe_live = describe.skipIf(!LIVE_BASE)

// ---- 流收集工具:包装 core 导出的 start/reconnect,回传事件与结束方式 ----

type StreamEnd =
  | { kind: 'complete' }
  | { kind: 'error'; error: Error }
  | { kind: 'timeout' }

interface Collected {
  events: AiChatStreamEvent[]
  end: Promise<StreamEnd>
  controller: AbortController
}

function collectStream(
  spawn: (callbacks: Parameters<typeof startRunStream>[1]) => AbortController,
): Collected {
  const events: AiChatStreamEvent[] = []
  let controller!: AbortController
  let resolveEnd: (end: StreamEnd) => void = () => {}
  const end = new Promise<StreamEnd>((resolve) => { resolveEnd = resolve })
  controller = spawn({
    onEvent: (event) => { events.push(event) },
    onError: (error) => resolveEnd({ kind: 'error', error }),
    onComplete: () => resolveEnd({ kind: 'complete' }),
  })
  return { events, end, controller }
}

/** 等待结束信号;超时返回 { kind: 'timeout' }(主动 abort 的流不会有任何结束回调)。 */
async function waitForEnd(collected: Collected, timeoutMs: number): Promise<StreamEnd> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<StreamEnd>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
  })
  try {
    return await Promise.race([collected.end, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 演示对话请求体(agentType=demo 走内置 get_current_time 工具 + mock 模型脚本) */
function demoRequest(message: string) {
  return {
    message,
    agentType: 'demo',
    toolExecutionMode: 'DEFAULT' as const,
    enabledSkills: [] as string[],
  }
}

describe_live('SDK core 活体测试(P1 出口 · demo-host 全流程 = PRD M0)', () => {
  // 认证:所有出站请求注入演示头(SDK 本身不携带业务头,宿主代理/网关注入场景)
  const realFetch = globalThis.fetch

  beforeAll(() => {
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.set('X-IA-Demo-User', DEMO_USER)
      return realFetch(input, { ...init, headers })
    })
    init({
      appKey: 'p1-exit-live',
      baseURL: API_BASE,
      tokenGetter: async () => null, // 演示头兜底;生产由宿主 embed token 回调承担
    })
  })

  afterEach(() => {
    resetRunningListCache() // 清 /runs/running 500ms 微缓存,保证查询真实性
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
  })

  // ---- 旅程共享状态 ----
  let runId = ''
  let conversationId = ''
  let firstPhaseEvents: AiChatStreamEvent[] = []
  let reconnectStartSeq = 0

  it('POST /runs 建会话:收流后中途断开(运行续跑于服务端)', async () => {
    const collected = collectStream((callbacks) =>
      startRunStream(demoRequest('现在几点了?'), callbacks))

    // 首个 journal 事件到达即断开(此时 mock 运行仍在工具调用阶段,
    // CONTENT 增量与终态尚在其后 —— 断开必然发生在中途,重连才有"补齐"可断言)
    let aborted = false
    let endKind = ''
    void collected.end.then((end) => { endKind = end.kind })
    const watcher = setInterval(() => {
      if (collected.events.length > 0 && !aborted) {
        aborted = true
        collected.controller.abort()
      }
    }, 10)

    // 轮询直到 abort 生效;流提前结束/报错则快速失败(不空转等超时)
    while (!aborted) {
      if (endKind) {
        clearInterval(watcher)
        throw new Error(
          `流在首个事件后即结束(kind=${endKind}, events=${collected.events.length})`)
      }
      await sleep(10)
    }
    await sleep(400) // 留出传输层中止时间
    clearInterval(watcher)

    expect(collected.events.length, '断开前应已收到事件').toBeGreaterThan(0)

    const first = collected.events[0]
    expect(first, '断开前应已收到事件').toBeDefined()
    if (!first) return
    runId = first.runId
    conversationId = first.conversationId ?? ''
    expect(runId, 'journal 事件必须携带 runId').toBeTruthy()
    expect(conversationId, 'journal 事件必须携带 conversationId(建会话)').toBeTruthy()
    for (const event of collected.events) {
      expect(event.schemaVersion).toBe(1)
      expect(event.runId).toBe(runId)
      expect(event.sequence).toBeGreaterThan(0)
    }
    expect(
      collected.events.every((event) => event.outputType !== 'DONE'),
      '断开时不应已收到终态(确系中途)',
    ).toBe(true)
    // SSE id 序列允许空洞(publish_required=false 的内核内部事件不产生 SSE id),
    // 但交付顺序必须严格递增
    let previous = 0
    for (const event of collected.events) {
      expect(event.sequence).toBeGreaterThan(previous)
      previous = event.sequence
    }

    firstPhaseEvents = [...collected.events]
    reconnectStartSeq = Math.max(...collected.events.map((event) => event.sequence))
  }, 60_000)

  it('Last-Event-ID 重连 /runs/{runId}/events:续流无丢失无重复,终态 DONE', async () => {
    expect(runId).toBeTruthy()
    const collected = collectStream((callbacks) =>
      reconnectRunStream(runId, reconnectStartSeq, callbacks))
    const end = await waitForEnd(collected, 60_000)
    expect(end.kind, `重连流应正常完成: ${JSON.stringify(end)}`).toBe('complete')

    const resumed = collected.events
    expect(resumed.length, '重连应补齐断开期间的事件').toBeGreaterThan(0)
    let resumedPrevious = reconnectStartSeq
    for (const event of resumed) {
      expect(event.runId).toBe(runId)
      expect(event.sequence, '续流必须严格从 Last-Event-ID 游标之后开始且递增(无重复)')
        .toBeGreaterThan(resumedPrevious)
      resumedPrevious = event.sequence
    }

    const terminal = resumed.at(-1)
    expect(terminal?.outputType, '重连流必须以根终态 DONE 结束').toBe('DONE')
    expect(
      resumed.some((event) => event.outputType === 'CONTENT'),
      '断开期间产生的 CONTENT 增量应经重连补齐',
    ).toBe(true)

    // 两段拼接 = 完整可交付事件流:严格递增 + 单根终态
    const merged = [...firstPhaseEvents, ...resumed]
    let mergedPrevious = 0
    for (const event of merged) {
      expect(event.sequence).toBeGreaterThan(mergedPrevious)
      mergedPrevious = event.sequence
    }
    expect(merged.filter((event) => event.outputType === 'DONE')).toHaveLength(1)
  }, 60_000)

  it('GET /runs/{runId}:终态字段 COMPLETED 与 lastSequence 对账', async () => {
    const status = await getRunStatus({ runId })
    expect(status.runId).toBe(runId)
    expect(status.status).toBe('COMPLETED')
    expect(status.lastSequence).toBeGreaterThan(reconnectStartSeq)
  }, 30_000)

  it('GET /runs/running?conversationId=:终态会话不再出现于运行列表', async () => {
    const filtered = await http.get<RunningRun[]>(
      `${getBaseURL()}/runs/running?conversationId=${encodeURIComponent(conversationId)}`)
    expect(Array.isArray(filtered)).toBe(true)
    expect(filtered.find((item) => item.conversationId === conversationId)).toBeUndefined()

    // SDK 契约:不在运行列表 = 终态,按会话查询合成 COMPLETED(runId 置空)
    const byConversation = await getRunStatus({ conversationId })
    expect(byConversation.status).toBe('COMPLETED')
    expect(byConversation.runId).toBe('')
  }, 30_000)

  it('GET /conversations:会话列表可见本次会话', async () => {
    const page = await listConversations({ pageNo: 1, pageSize: 50 })
    const mine = page.list.find((item) => item.conversationId === conversationId)
    expect(mine, '新会话必须出现在会话列表').toBeDefined()
    expect(mine!.messageCount).toBeGreaterThan(0)
    expect(page.total).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('兜底取消 POST /runs/cancel?conversationId=:新会话运行被取消', async () => {
    const collected = collectStream((callbacks) =>
      startRunStream(demoRequest('现在几点了?'), callbacks))
    // 等首个事件确认运行已建(必然在 mock 脚本 6s+ 的流式窗口内);提前失败不空转
    let cancelEndKind = ''
    void collected.end.then((end) => { cancelEndKind = end.kind })
    while (collected.events.length === 0) {
      if (cancelEndKind) {
        throw new Error(`运行流在首个事件前即结束(kind=${cancelEndKind})`)
      }
      await sleep(20)
    }
    const firstCancelEvent = collected.events[0]
    expect(firstCancelEvent, '运行中应收到首个 journal 事件').toBeDefined()
    if (!firstCancelEvent) return
    const cancelRunId = firstCancelEvent.runId
    const cancelConversationId = firstCancelEvent.conversationId ?? ''

    // 运行中:按会话过滤可见该 run(positive 过滤断言)
    const filtered = (await listRunningRuns()).filter(
      (item) => item.conversationId === cancelConversationId)
    expect(filtered.map((item) => item.runId)).toContain(cancelRunId)

    // 兜底取消:仅持 conversationId → POST /runs/cancel?conversationId=
    await expect(cancelRun({ conversationId: cancelConversationId })).resolves.toBeUndefined()

    // 终态收敛为 CANCELLED(轮询直查;取消传播 ≤ 数秒)
    const deadline = Date.now() + 30_000
    let status = await getRunStatus({ runId: cancelRunId })
    while (status.status === 'RUNNING' || status.status === 'CANCEL_REQUESTED') {
      if (Date.now() > deadline) break
      await sleep(500)
      status = await getRunStatus({ runId: cancelRunId })
    }
    expect(['CANCELLED', 'COMPLETED']).toContain(status.status)
    // mock 流式窗口 ≥6s,取消请求在其开始后立即发出 → 正常必然 CANCELLED
    expect(status.status, 'mock 运行窗口内取消应生效(CANCELLED)').toBe('CANCELLED')

    collected.controller.abort()
  }, 60_000)

  it('404 语义:不存在的 run 查询抛 ApiError(404)', async () => {
    const missing = 'ia-run-does-not-exist'
    const failure = await getRunStatus({ runId: missing }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure, '不存在的 run 必须报错').toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(404)
  }, 30_000)

  it('P2-scope:ALWAYS_ASK 确认等待事件 pendingToolCalls 携带 scope 字段(降级或解析),批准后 DONE', async () => {
    const collected = collectStream((callbacks) =>
      startRunStream({
        message: '现在几点了?',
        agentType: 'demo',
        toolExecutionMode: 'ALWAYS_ASK', // 所有工具逐次确认 → 触发确认等待事件
        enabledSkills: [] as string[],
        context: { page: { id: 'live-scope-check' }, object: { type: 'doc' } },
      }, callbacks))

    // 等待确认等待事件到达(确认流真机贯通的前置,U1 修复后可用)
    let confirmation: AiChatStreamEvent | undefined
    const confirmationDeadline = Date.now() + 45_000
    while (Date.now() < confirmationDeadline) {
      confirmation = collected.events.find(
        (event) => event.outputType === 'USER_CONFIRMATION_REQUIRED')
      if (confirmation) break
      if ((await Promise.race([collected.end.then(() => true), sleep(50).then(() => false)]))) break
      await sleep(50)
    }
    const pending = confirmation?.pendingToolCalls
    expect(pending, 'ALWAYS_ASK 运行应收到 USER_CONFIRMATION_REQUIRED').toBeTruthy()
    expect(pending!.length, '确认等待事件应携带待确认工具集').toBeGreaterThan(0)
    expect(confirmation!.replyId).toBeTruthy()
    expect(confirmation!.expiresAt).toBeTruthy()

    // scope 契约(任务 #15):每项含 scope{resolved,degraded[,summary]};
    // 宿主(demo-spring-host)是否实现 resolve_scope 决定 degraded/resolved 形态
    for (const toolCall of pending!) {
      const scope = toolCall.scope
      expect(scope, `pendingToolCall ${toolCall.toolCallId} 应携带 scope 字段`).toBeTruthy()
      expect(typeof scope!.resolved, 'scope.resolved 必须是 boolean').toBe('boolean')
      expect(typeof scope!.degraded, 'scope.degraded 必须是 boolean').toBe('boolean')
      if (scope!.summary !== undefined) {
        expect(typeof scope!.summary, 'scope.summary 可选但必须是 string').toBe('string')
      }
    }

    // 全量批准 → 运行续跑至根终态 DONE(确认链 + scope 字段同流验证)
    await confirmRunTools({
      runId: confirmation!.runId,
      replyId: confirmation!.replyId!,
      decisions: pending!.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        approved: true,
      })),
    })
    const end = await waitForEnd(collected, 60_000)
    expect(end.kind, `批准后流应正常完成: ${JSON.stringify(end)}`).toBe('complete')
    expect(
      collected.events.some((event) =>
        !event.parentToolCallId && !event.agentName && event.outputType === 'DONE'),
      '批准后应收到根终态 DONE',
    ).toBe(true)
  }, 120_000)

  it('POST /attachments:mock 模型 base64 上传返回 resourceUrl(core uploadAttachment)', async () => {
    const models = await aiModelApi.listByType(1)
    expect(models.length, '应有 seed 的对话模型').toBeGreaterThan(0)
    const mockModel = models.find((model) => model.code.startsWith('mock-'))
    expect(mockModel, '应能定位 mock 模型(code 以 mock- 前缀标识)').toBeDefined()
    if (!mockModel) return
    expect(mockModel.multimodalInputTypes).toContain('file')

    const file = new File(['live-acceptance-payload'], 'live-acceptance.txt', {
      type: 'text/plain',
    })
    const resourceUrl = await uploadAttachment(file, mockModel.id, 'base64')
    expect(resourceUrl).toMatch(/^\/ia\/api\/v1\/attachments\/\d+$/)
  }, 60_000)
})
