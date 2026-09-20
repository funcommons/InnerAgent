/**
 * [new] P1 优化建议 #5:断流静默提示 —— store 区分「可自动恢复的传输错误」与「终态失败」。
 *
 * 契约(test-report/2026-09-21-02/99-优化建议.md #5,证据 L8-03「断流瞬间暴露
 * 原始错误 network error + 重试按钮,数秒后自动重连成功又自行消失」):
 * - 可恢复传输错误(已有 runId / reconnect 模式,run 仍在进行)→ runtime.reconnecting
 *   提示态 + connectionError 抑制(UI 渲染非阻断「连接中断,自动重连中…」并抑制手动重试);
 * - 新事件送达(自动重连恢复)→ 提示态清除;
 * - 自动重连耗尽(沿用既有 5 次上限,与 DEF-06 补偿回填 REPLAY_MAX_ATTEMPTS 同源)
 *   → 升级错误态(connectionError 可读文案 + reconnecting=false)并停止自动重试;
 *   会话状态不伪造为 failed —— 保留服务端真实 run 状态,由状态轮询收敛终态;
 * - start 分支无 runId 的建流拒绝(模型未配置等)仍是终态失败,既有语义不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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
import { clearRunContext } from '../pageContext'
import { resetTokenRefreshSingleFlight } from '../client'
import { resetRunningListCache } from '../runs'
import { useAssistantStore } from '../store/assistant'

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

async function tick(ms = 16): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function freshSdk(): void {
  resetSdkConfig()
  resetTokenRefreshSingleFlight()
  resetRunningListCache()
  init({ appKey: 'demo', tokenGetter: async () => 'tok-1' })
}

describe('store/assistant (P1 #5: 断流静默提示态 / 重连耗尽升级错误态)', () => {
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

  /** 进入「流式输出中」场景: run-1 已投递 CONTENT seq1(runId 已知 → 传输错误可自动恢复) */
  async function setupStreaming(): Promise<{
    store: ReturnType<typeof useAssistantStore>
    conversationId: string
    stream: ReturnType<typeof manualStream>
  }> {
    const stream = manualStream()
    fetchMock.mockResolvedValue(stream.response)
    const store = useAssistantStore()
    store.initializeForUser(1)
    await tick(0)
    store.setOpen(true)
    await store.sendMessage('断流场景', null, null)
    await tick(0)
    const conversationId = store.selectedConversationId!
    stream.push(sseBlock(1, { outputType: 'CONTENT', content: '正在生成' }))
    await tick(32)
    return { store, conversationId, stream }
  }

  it('传输错误(已具 runId)→ 提示态 reconnecting=true 且 connectionError 抑制;状态不伪造为 failed', async () => {
    const { store, conversationId, stream } = await setupStreaming()

    stream.close() // 流中断(未交付根终态) → 可自动恢复的传输错误
    await tick(32)

    const runtime = store.conversationStates[conversationId]
    expect(runtime?.reconnecting).toBe(true)
    // 原始错误被抑制: 不再渲染「network error + 重试按钮」的阻断式错误
    expect(runtime?.connectionError).toBeUndefined()
    // run 状态保留(仍运行中, 自动重连继续)
    expect(runtime?.status).toBe('running')
    expect(statusIsRunningRuntime(runtime?.status))
  })

  it('自动重连恢复(事件送达)→ 提示态清除', async () => {
    const { store, conversationId, stream } = await setupStreaming()
    stream.close()
    await tick(32)
    expect(store.conversationStates[conversationId]?.reconnecting).toBe(true)

    // ensure 重试(5s)后经 /events 从游标重连; 连接尝试在途时提示态保持
    // (失败会再次回到错误循环), 新事件送达才算传输恢复
    const resumed = manualStream()
    fetchMock.mockResolvedValue(resumed.response)
    await tick(5000)
    await tick(32)
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/runs/run-1/events')
    expect(new Headers(init.headers).get('last-event-id')).toBe('run-1:1')
    expect(store.conversationStates[conversationId]?.reconnecting).toBe(true)

    resumed.push(sseBlock(2, { outputType: 'CONTENT', content: '，续传内容' }))
    resumed.push(sseBlock(3, { outputType: 'DONE', content: '，完成' }))
    await tick(32)
    const settled = store.conversationStates[conversationId]
    expect(settled?.status).toBe('completed')
    expect(settled?.reconnecting).toBe(false)
    expect(settled?.connectionError).toBeUndefined()
  })

  it('自动重连耗尽(连续 5 次传输失败)→ 升级错误态并停止自动重试;状态保留由轮询收敛', async () => {
    const { store, conversationId, stream } = await setupStreaming()
    stream.close()
    await tick(32)

    // 后续所有重连请求一律失败 → 逐次计数直至耗尽(上限 5)
    fetchMock.mockRejectedValue(new TypeError('network error'))
    for (let round = 0; round < 6 && !store.conversationStates[conversationId]?.connectionError; round++) {
      await tick(5000)
      await tick(32)
    }

    const exhausted = store.conversationStates[conversationId]
    expect(exhausted?.reconnecting).toBe(false)
    expect(exhausted?.connectionError).toContain('network error')
    expect(exhausted?.connectionError).toContain('自动重连未成功')
    // 不伪造终态: 服务端 run 真实状态未知, 保留 running 交由状态轮询收敛
    expect(exhausted?.status).toBe('running')

    // 耗尽后停止自动重试循环: 再推进多轮, 不再产生新的连接请求
    const callsAfterExhaustion = fetchMock.mock.calls.length
    await tick(20000)
    expect(fetchMock.mock.calls.length).toBe(callsAfterExhaustion)
  })

  it('start 分支无 runId 的建流拒绝仍是终态失败(语义不变, 不进入提示态)', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 500,
      text: async () => JSON.stringify({ code: 1, msg: '模型未配置' }),
      body: null,
    } as unknown as Response)
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
    expect(runtime?.reconnecting).toBe(false)
  })
})

function statusIsRunningRuntime(status: string | undefined): boolean {
  return status === 'running' || status === 'pending' || status === 'RUNNING'
    || status === 'WAITING_CONFIRMATION' || status === 'WAITING_EXTERNAL'
    || status === 'CANCEL_REQUESTED'
}
