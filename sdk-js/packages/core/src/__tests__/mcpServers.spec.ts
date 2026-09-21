/**
 * [new] 用户级三方 MCP API 测试 (P4/W15 SDK 配置视图 API 层)。
 *
 * 契约对齐 inneragent-server McpUserServerController (P4 批次① 落地,
 * commit 4212188 / VO McpServerRespVO + McpServerSaveReqVO):
 * - GET    {base}/mcp-servers            本人列表 (行级隔离, 含停用)
 * - GET    {base}/mcp-servers/{id}       详情
 * - POST   {base}/mcp-servers            注册
 * - PUT    {base}/mcp-servers/{id}       更新
 * - POST   {base}/mcp-servers/{id}/enable  启用
 * - POST   {base}/mcp-servers/{id}/disable 停用
 * - DELETE {base}/mcp-servers/{id}       删除
 * - credentials 永不回显原文 (仅打码形 credentialsMasked)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, resetSdkConfig } from '../config'
import { resetTokenRefreshSingleFlight } from '../client'
import { mcpUserServersApi, type McpUserServer } from '../mcpServers'
import { ApiError } from '../errorCodes'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function callOf(fn: { mock: { calls?: unknown[][] } }, index: number): unknown[] {
  const call = fn.mock.calls?.[index]
  expect(call).toBeDefined()
  return call as unknown[]
}

const SAMPLE_SERVER: McpUserServer = {
  id: 7,
  serverKey: 'ucrm',
  name: 'UCRM 客户系统',
  endpointUrl: 'https://mcp.example.com/ia-mcp',
  transport: 'streamable-http',
  authType: 'STATIC_HEADER',
  headerName: 'X-Api-Key',
  credentialsMasked: 'se***',
  timeoutSeconds: 30,
  enabled: true,
  updateTime: '2026-09-20T10:00:00',
}

describe('sdk-core mcpUserServersApi (用户级三方 MCP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    init({ appKey: 'demo', tokenGetter: async () => 'tok-1' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
    resetTokenRefreshSingleFlight()
  })

  it('list: GET /mcp-servers, 信封解包为列表', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: [SAMPLE_SERVER] }))

    const list = await mcpUserServersApi.list()

    expect(list).toEqual([SAMPLE_SERVER])
    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/mcp-servers')
    expect(req.method).toBe('GET')
    expect(new Headers(req.headers).get('authorization')).toBe('Bearer tok-1')
  })

  it('get: GET /mcp-servers/{id}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: SAMPLE_SERVER }))

    const server = await mcpUserServersApi.get(7)

    expect(server.id).toBe(7)
    const [url] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/mcp-servers/7')
  })

  it('register: POST /mcp-servers, 请求体 JSON 序列化 (credentials 仅注册时提交)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: SAMPLE_SERVER }))

    const saved = await mcpUserServersApi.register({
      serverKey: 'ucrm',
      name: 'UCRM 客户系统',
      endpointUrl: 'https://mcp.example.com/ia-mcp',
      headerName: 'X-Api-Key',
      credentials: 'secret-value',
    })

    expect(saved.serverKey).toBe('ucrm')
    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/mcp-servers')
    expect(req.method).toBe('POST')
    expect(JSON.parse(req.body as string)).toMatchObject({
      serverKey: 'ucrm',
      endpointUrl: 'https://mcp.example.com/ia-mcp',
      credentials: 'secret-value',
    })
  })

  it('update: PUT /mcp-servers/{id}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: SAMPLE_SERVER }))

    await mcpUserServersApi.update(7, { serverKey: 'ucrm', name: '改名', endpointUrl: 'https://mcp.example.com/ia-mcp' })

    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/mcp-servers/7')
    expect(req.method).toBe('PUT')
    expect(JSON.parse(req.body as string)).toMatchObject({ name: '改名' })
  })

  it('enable/disable: POST /mcp-servers/{id}/enable|disable (配置视图启停)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: { ...SAMPLE_SERVER, enabled: true } }))
    const enabled = await mcpUserServersApi.enable(7)
    expect(enabled.enabled).toBe(true)

    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: { ...SAMPLE_SERVER, enabled: false } }))
    const disabled = await mcpUserServersApi.disable(7)
    expect(disabled.enabled).toBe(false)

    const [, reqEnable] = callOf(fetchMock, 0) as [string, RequestInit]
    const [urlDisable, reqDisable] = callOf(fetchMock, 1) as [string, RequestInit]
    expect(reqEnable.method).toBe('POST')
    expect(urlDisable).toBe('/ia/api/v1/mcp-servers/7/disable')
    expect(reqDisable.method).toBe('POST')
  })

  it('remove: DELETE /mcp-servers/{id}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { code: 0, data: true }))

    await expect(mcpUserServersApi.remove(7)).resolves.toBe(true)

    const [url, req] = callOf(fetchMock, 0) as [string, RequestInit]
    expect(url).toBe('/ia/api/v1/mcp-servers/7')
    expect(req.method).toBe('DELETE')
  })

  it('业务错误信封 (code!=0) → ApiError (如 OAUTH 501 / SSRF 拒绝)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { code: 400, msg: 'OAUTH 鉴权暂未支持 (占位 501)' }),
    )

    await expect(mcpUserServersApi.register({
      serverKey: 'x', name: 'x', endpointUrl: 'https://x.example', authType: 'OAUTH',
    })).rejects.toThrow(ApiError)
  })
})
