/**
 * [new] view="config" 配置视图测试 (P4/W15; 02-技术方案 §9.1
 * 「Skill/MCP 用户配置 → 迁至 SDK 配置视图」)。
 *
 * 范围口径 (读模式为主):
 * - Skill: 只读列表 (来源 /me/reference-options, P4① 无用户面 Skill API, 见差距清单)
 * - 三方 MCP: 列表 + 用户级启停 (契约 McpUserServerController)
 * - credentials 仅打码形, 原文不可出现在任何渲染文本中
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { init, resetSdkConfig } from '@inneragent/sdk-core'
import AgentConfigPanel from '../config/AgentConfigPanel.vue'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

const REFERENCE_OPTIONS = {
  skills: [
    { id: 'builtin:time', name: 'time', displayName: '时间技能', description: '查询当前时间', source: 'builtin' },
    { id: 'app:crm', name: 'crm', displayName: 'CRM 技能', description: '客户检索话术', source: 'app' },
  ],
  mcpTools: [],
}

const MCP_SERVERS = [
  {
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
  },
  {
    id: 8,
    serverKey: 'wiki',
    name: 'Wiki 检索',
    endpointUrl: 'https://wiki.example.com/mcp',
    transport: 'streamable-http',
    authType: 'STATIC_HEADER',
    headerName: 'Authorization',
    credentialsMasked: null,
    timeoutSeconds: 30,
    enabled: false,
    updateTime: null,
  },
]

function installFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  // async 包装: client.timeoutFetch 对返回值调用 .finally, mock 必须返回 Promise
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>): Array<[string, RequestInit | undefined]> {
  return (fetchMock.mock.calls ?? []) as Array<[string, RequestInit | undefined]>
}

describe('AgentConfigPanel (view="config")', () => {
  beforeEach(() => {
    resetSdkConfig()
    init({ appKey: 'demo', tokenGetter: async () => null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSdkConfig()
  })

  it('加载后渲染 Skill 只读列表与三方 MCP 列表 (credentials 仅打码形)', async () => {
    const fetchMock = installFetch((url) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers')) return jsonResponse(200, { code: 0, data: MCP_SERVERS })
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()

    // Skill 只读区
    const skills = wrapper.findAll('[data-testid="ia-config-skill-item"]')
    expect(skills).toHaveLength(2)
    expect(skills[0]!.text()).toContain('时间技能')
    // Skill 行无启停控件 (读模式)
    expect(skills[0]!.find('[data-testid^="ia-config-mcp-toggle"]').exists()).toBe(false)

    // 三方 MCP 区
    const rows = wrapper.findAll('[data-testid="ia-config-mcp-item"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('UCRM 客户系统')
    expect(rows[0]!.text()).toContain('https://mcp.example.com/ia-mcp')
    // credentials 原文绝不渲染, 仅打码形
    expect(wrapper.text()).toContain('se***')
    expect(wrapper.text()).not.toContain('secret-raw-value')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('启停: 停用已启用服务器 → POST /mcp-servers/{id}/disable → 行状态翻转', async () => {
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(200, { code: 0, data: MCP_SERVERS })
      }
      if (url.endsWith('/mcp-servers/7/disable')) {
        return jsonResponse(200, { code: 0, data: { ...MCP_SERVERS[0], enabled: false } })
      }
      if (url.endsWith('/mcp-servers/7/enable')) {
        return jsonResponse(200, { code: 0, data: { ...MCP_SERVERS[0], enabled: true } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()

    const toggle = wrapper.find('[data-testid="ia-config-mcp-toggle-7"]')
    expect(toggle.text()).toContain('停用') // 已启用 → 动作为"停用"
    await toggle.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ia-config-mcp-toggle-7"]').text()).toContain('启用')

    await wrapper.find('[data-testid="ia-config-mcp-toggle-7"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ia-config-mcp-toggle-7"]').text()).toContain('停用')

    // 两次启停都走 POST 幂等端点
    const postUrls = callsTo(fetchMock)
      .filter(([, reqInit]) => reqInit?.method === 'POST')
      .map(([url]) => url)
    expect(postUrls).toEqual([
      '/ia/api/v1/mcp-servers/7/disable',
      '/ia/api/v1/mcp-servers/7/enable',
    ])
    wrapper.unmount()
  })

  it('启停失败: 行状态回滚 + 错误提示可见', async () => {
    installFetch((url, init) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(200, { code: 0, data: MCP_SERVERS })
      }
      if (url.endsWith('/mcp-servers/7/disable')) {
        return jsonResponse(200, { code: 500, msg: '服务端拒绝' })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()

    await wrapper.find('[data-testid="ia-config-mcp-toggle-7"]').trigger('click')
    await flushPromises()

    // 回滚: 行仍是已启用 (动作为"停用")
    expect(wrapper.find('[data-testid="ia-config-mcp-toggle-7"]').text()).toContain('停用')
    // 错误提示
    expect(wrapper.find('[data-testid="ia-config-mcp-error"]').text()).not.toBe('')
    wrapper.unmount()
  })

  it('加载失败: 错误态 + 重试成功恢复', async () => {
    const fetchMock = installFetch((url) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers')) return jsonResponse(500, { code: 500, msg: 'boom' })
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()
    expect(wrapper.find('[data-testid="ia-config-error"]').exists()).toBe(true)

    // 重试 → 服务恢复 (async: 同 installFetch, client 对返回值调用 .finally)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers')) return jsonResponse(200, { code: 0, data: MCP_SERVERS })
      throw new Error(`unexpected fetch: ${url}`)
    })
    await wrapper.find('[data-testid="ia-config-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="ia-config-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="ia-config-mcp-item"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('空态: 无 Skill 与无三方 MCP 时的占位文案', async () => {
    installFetch((url) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: { skills: [], mcpTools: [] } })
      if (url.endsWith('/mcp-servers')) return jsonResponse(200, { code: 0, data: [] })
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()

    expect(wrapper.find('[data-testid="ia-config-skills-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ia-config-mcp-empty"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('OAuth 占位服务器标注未支持鉴权 (不误导用户)', async () => {
    installFetch((url) => {
      if (url.includes('/me/reference-options')) return jsonResponse(200, { code: 0, data: REFERENCE_OPTIONS })
      if (url.endsWith('/mcp-servers')) {
        return jsonResponse(200, { code: 0, data: [{ ...MCP_SERVERS[0], authType: 'OAUTH' }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const wrapper = mount(AgentConfigPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('OAuth')
    wrapper.unmount()
  })
})
