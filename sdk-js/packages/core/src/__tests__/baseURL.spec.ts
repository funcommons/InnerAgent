/**
 * [new] DEF-05 回归:SDK http 层 baseURL 拼接去重(R1 E2E 2026-09-21-01 §3 取证)。
 *
 * 缺陷:client.ts request() 对相对路径拼 getBaseURL(),而 me.ts / conversations.ts /
 * runs.ts(查询端)/ attachments.ts 调用点又自带 `${getBaseURL()}` 前缀 → 默认
 * '/ia/api/v1' 下实际请求 /ia/api/v1/ia/api/v1/* 全部 404(demo-host 默认接入不可用)。
 *
 * 修复口径:
 * - 调用点只交相对路径,baseURL 由 request() 统一拼接;
 * - request() 对「已含 baseURL 前缀」的路径幂等(不再重复拼,防调用点回归);
 * - SSE 端点(authenticatedFetch 单次拼接)不受影响,不重复覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { init, resetSdkConfig } from '../config'
import { http, resetTokenRefreshSingleFlight } from '../client'
import { aiModelApi, meApi } from '../me'
import {
  deleteConversation,
  deleteConversationByConversationId,
  listConversations,
  listMessages,
} from '../conversations'
import {
  cancelRun,
  confirmRunTools,
  expireRunConfirmation,
  getRunStatus,
  listRunningRuns,
  resetRunningListCache,
} from '../runs'
import { uploadAttachment } from '../attachments'

function callOf(fn: { mock: { calls?: unknown[][] } }, index: number): unknown[] {
  const call = fn.mock.calls?.[index]
  expect(call).toBeDefined()
  return call as unknown[]
}

describe('sdk-core client (DEF-05 baseURL 拼接去重)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    init({ appKey: 'demo', tokenGetter: async () => 'tok-1' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    resetRunningListCache()
  })

  it('默认 baseURL 下 GET /me/models 单前缀(取证场景:L7-07 双拼 404 反转为 200)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: [] }),
    } as unknown as Response)
    await aiModelApi.listByType(1)
    const [url] = callOf(fetchMock, 0) as [string]
    expect(url).toBe('/ia/api/v1/me/models?type=1')
    expect(url).not.toContain('/ia/api/v1/ia/api/v1')
  })

  it('默认 baseURL 下 conversations 域全部单前缀(列表/消息/删除)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: { list: [], total: 0 } }),
    } as unknown as Response)
    await listConversations({ pageNo: 1, pageSize: 20, category: 'assistant' })
    expect(callOf(fetchMock, 0)[0]).toBe('/ia/api/v1/conversations?pageNo=1&pageSize=20&category=assistant')

    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: [] }),
    } as unknown as Response)
    await listMessages('conv-1')
    expect(callOf(fetchMock, 1)[0]).toBe('/ia/api/v1/conversations/conv-1/messages')

    await deleteConversation(7)
    expect(callOf(fetchMock, 2)[0]).toBe('/ia/api/v1/conversations/7')

    await deleteConversationByConversationId('conv-9')
    expect(callOf(fetchMock, 3)[0]).toBe('/ia/api/v1/conversations/by-conversation-id/conv-9')
  })

  it('默认 baseURL 下 runs 查询端全部单前缀(status/running/cancel/confirm/expire)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: null }),
    } as unknown as Response)

    await getRunStatus({ runId: 'run-1' })
    expect(callOf(fetchMock, 0)[0]).toBe('/ia/api/v1/runs/run-1')

    await listRunningRuns()
    expect(callOf(fetchMock, 1)[0]).toBe('/ia/api/v1/runs/running')

    await cancelRun({ runId: 'run-1' })
    expect(callOf(fetchMock, 2)[0]).toBe('/ia/api/v1/runs/run-1/cancel')

    await cancelRun({ conversationId: 'conv-1' })
    expect(callOf(fetchMock, 3)[0]).toBe('/ia/api/v1/runs/cancel?conversationId=conv-1')

    await confirmRunTools({ runId: 'run-1', replyId: 'reply-1', decisions: [] })
    expect(callOf(fetchMock, 4)[0]).toBe('/ia/api/v1/runs/run-1/confirm')

    await expireRunConfirmation({ runId: 'run-1', replyId: 'reply-1' })
    expect(callOf(fetchMock, 5)[0]).toBe('/ia/api/v1/runs/run-1/confirm/expire')
  })

  it('默认 baseURL 下附件上传单前缀(FormData)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: '/attachments/1' }),
    } as unknown as Response)
    const file = new File(['payload'], 'a.png', { type: 'image/png' })
    await expect(uploadAttachment(file, 5, 'base64')).resolves.toBe('/attachments/1')
    const [url] = callOf(fetchMock, 0) as [string]
    expect(url).toBe('/ia/api/v1/attachments')
    expect(url).not.toContain('/ia/api/v1/ia/api/v1')
  })

  it('幂等防护:调用点已带 baseURL 前缀时不重复拼(防回归)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: [] }),
    } as unknown as Response)
    await http.get('/ia/api/v1/me/models?type=1')
    expect(callOf(fetchMock, 0)[0]).toBe('/ia/api/v1/me/models?type=1')
  })

  it('自定义 baseURL 同样单前缀(me/reference-options)', async () => {
    resetSdkConfig()
    init({ appKey: 'demo', tokenGetter: async () => 'tok-1', baseURL: '/custom/prefix/' })
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ code: 0, data: { skills: [], mcpTools: [] } }),
    } as unknown as Response)
    await meApi.referenceOptions()
    const [url] = callOf(fetchMock, 0) as [string]
    expect(url).toBe('/custom/prefix/me/reference-options')
    expect(url).not.toContain('/custom/prefix//')
  })
})
