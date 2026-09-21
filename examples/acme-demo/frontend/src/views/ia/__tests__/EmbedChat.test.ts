import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import EmbedChat from '@/views/ia/EmbedChat.vue'
import type { InnerAgentSdkModule } from '@/ia/sdkLoader'
import type { SelectOption } from '@/components/sdk'
import { DEMO_AGENT_TYPES, IA_EMBED_AGENT_TYPE_KEY } from '@/ia/demoAgents'

// api 层全 mock(避免 axios/router 重链路);sdkLoader mock 掉动态 import
const configMock = vi.fn()
const fetchTokenMock = vi.fn()
vi.mock('@/api/demo', () => ({
  demoApi: { config: (...args: unknown[]) => configMock(...args) },
}))
vi.mock('@/api/ia', () => ({
  fetchIaEmbedToken: (...args: unknown[]) => fetchTokenMock(...args),
}))

const initMock = vi.fn()
const registerMock = vi.fn()
const createIframeEmbedMock = vi.fn()
const iframeEmbedHandle = {
  ready: Promise.resolve(),
  setPage: vi.fn(),
  setObject: vi.fn(),
  clearContext: vi.fn(),
  refreshToken: vi.fn(),
  destroy: vi.fn(),
}

vi.mock('@/ia/sdkLoader', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ia/sdkLoader')>()
  return {
    ...original,
    loadInnerAgentSdk: vi.fn(async () => ({
      init: initMock,
      registerInnerAgentChat: registerMock,
    }) as unknown as InnerAgentSdkModule),
    loadIframeEmbed: vi.fn(async () => ({
      createIframeEmbed: createIframeEmbedMock.mockReturnValue(iframeEmbedHandle),
    })),
  }
})

function mountChat() {
  return mount(EmbedChat, { attachTo: document.body })
}

beforeEach(() => {
  vi.clearAllMocks()
  configMock.mockResolvedValue({
    inneragentBaseUrl: 'http://localhost:18090',
    appKey: 'acme-demo',
    agentType: 'ai_media',
  })
  fetchTokenMock.mockResolvedValue('header.eyJleHAiOjQxMDI0NDQ4MDB9.sig')
})

describe('EmbedChat(WC 直挂)', () => {
  it('挂载成功:init 契约(appKey/tokenGetter/baseURL/agentType)+ WC 元素渲染', async () => {
    const w = mountChat()
    await flushPromises()
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()

    expect(initMock).toHaveBeenCalledTimes(1)
    const options = initMock.mock.calls[0]![0] as Record<string, unknown>
    expect(options.appKey).toBe('acme-demo')
    expect(options.baseURL).toBe('http://localhost:18090/ia/api/v1')
    expect(options.agentType).toBe('ai_media')
    expect(typeof options.tokenGetter).toBe('function')
    // tokenGetter 契约:指向宿主端点,返回 fetch 到的 token
    await expect((options.tokenGetter as () => Promise<string | null>)()).resolves.toBe(
      'header.eyJleHAiOjQxMDI0NDQ4MDB9.sig',
    )
    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(w.find('[data-testid="ia-chat"]').exists()).toBe(true)
    expect(w.find('[data-testid="embed-error"]').exists()).toBe(false)
    w.unmount()
  })

  it('预取 token 失败 → 错误卡 + 重试,不白屏不加载 SDK', async () => {
    fetchTokenMock.mockResolvedValue(null)
    const w = mountChat()
    await flushPromises()
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()

    expect(w.find('[data-testid="embed-error"]').exists()).toBe(true)
    expect(initMock).not.toHaveBeenCalled()

    // 修复后重试 → 走通
    fetchTokenMock.mockResolvedValue('header.eyJleHAiOjQxMDI0NDQ4MDB9.sig')
    await w.find('[data-testid="embed-retry"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="embed-error"]').exists()).toBe(false)
    expect(initMock).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('销毁:WC 元素卸载', async () => {
    const w = mountChat()
    await flushPromises()
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="ia-chat"]').exists()).toBe(true)
    await w.find('[data-testid="embed-destroy"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="ia-chat"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('EmbedChat(iframe postMessage 模式)', () => {
  async function mountIframeMode() {
    const w = mountChat()
    await flushPromises()
    ;(w.vm as unknown as { mode: string }).mode = 'iframe'
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    return w
  }

  it('createIframeEmbed 选项:src 无 token、tokenGetter 注入、事件回日志', async () => {
    const w = await mountIframeMode()
    expect(createIframeEmbedMock).toHaveBeenCalledTimes(1)
    const options = createIframeEmbedMock.mock.calls[0]![0] as {
      src: string
      appKey: string
      tokenGetter: () => Promise<string | null>
      container: HTMLElement
      onEvent: (e: { kind: string; status?: string }) => void
    }
    // jsdom 运行时 origin(非 dev server 的 9203):相对路径按当前 origin 归一
    expect(options.src).toBe(`${window.location.origin}/ia/frame.html`)
    expect(options.src).not.toMatch(/token/i)
    expect(options.appKey).toBe('acme-demo')
    expect(options.container).toBeInstanceOf(HTMLElement)
    await expect(options.tokenGetter()).resolves.toMatch(/\./)

    options.onEvent({ kind: 'run-terminal', status: 'COMPLETED' })
    await flushPromises() // onEvent → 日志 unshift,等待 Vue 渲染
    const log = w.find('[data-testid="embed-log"]').text()
    expect(log).toContain('run-terminal:COMPLETED')
    w.unmount()
  })

  it('握手地址与状态行可见', async () => {
    const w = await mountIframeMode()
    expect(w.find('[data-testid="embed-frame-src"]').text()).toBe(`${window.location.origin}/ia/frame.html`)
    expect(w.find('[data-testid="embed-handshake"]').exists()).toBe(true)
    w.unmount()
  })
})

// ===== agentType 场景选择器(画廊「开始对话」深链 → EmbedChat 预选/重建/持久化)=====

describe('EmbedChat(agentType 场景选择器)', () => {
  function findAgentTypeSelect(w: Awaited<ReturnType<typeof mountChat>>) {
    return w.findComponent({ name: 'FcSelect' })
  }
  function selectOptions(w: Awaited<ReturnType<typeof mountChat>>): SelectOption[] {
    return findAgentTypeSelect(w).props('options') as SelectOption[]
  }
  /** 经 v-model 触发一次选择(FcSelect 的 update:modelValue + change) */
  function choose(w: Awaited<ReturnType<typeof mountChat>>, value: string) {
    const sel = findAgentTypeSelect(w)
    sel.vm.$emit('update:modelValue', value)
    sel.vm.$emit('change', value)
  }
  function lastInitAgentType(): unknown {
    const call = initMock.mock.calls[initMock.mock.calls.length - 1]!
    return (call[0] as Record<string, unknown>).agentType
  }

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('选择器 6 项:后端默认 + 5 个演示场景;默认选中时 init 用后端 agentType', async () => {
    const w = mountChat()
    await flushPromises()
    expect(selectOptions(w).map((o) => o.value)).toEqual(['', ...DEMO_AGENT_TYPES])
    // 当前生效值展示(= 后端默认)
    expect(w.find('[data-testid="embed-agent-type-current"]').text()).toBe('ai_media')

    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    expect(lastInitAgentType()).toBe('ai_media')
    w.unmount()
  })

  it('切换选择器 → 已挂载则以新 agentType 重建(WC 二次 init)并持久化 localStorage', async () => {
    const w = mountChat()
    await flushPromises()
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(1)

    choose(w, 'knowledge-qa')
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(2)
    expect(lastInitAgentType()).toBe('knowledge-qa')
    expect(localStorage.getItem(IA_EMBED_AGENT_TYPE_KEY)).toBe(JSON.stringify('knowledge-qa'))
    w.unmount()
  })

  it('未挂载时切换仅记录选择(不自动拉起)', async () => {
    const w = mountChat()
    await flushPromises()
    choose(w, 'ticket-assistant')
    await flushPromises()
    expect(initMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(IA_EMBED_AGENT_TYPE_KEY)).toBe(JSON.stringify('ticket-assistant'))
    w.unmount()
  })

  it('重进页面:localStorage 恢复上次选择;已下线 agentType 回退后端默认', async () => {
    localStorage.setItem(IA_EMBED_AGENT_TYPE_KEY, JSON.stringify('ops-analyst'))
    const w = mountChat()
    await flushPromises()
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    expect(lastInitAgentType()).toBe('ops-analyst')
    w.unmount()

    localStorage.setItem(IA_EMBED_AGENT_TYPE_KEY, JSON.stringify('legacy-agent'))
    const w2 = mountChat()
    await flushPromises()
    await w2.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    expect(lastInitAgentType()).toBe('ai_media')
    w2.unmount()
  })

  it('深链 ?agentType=…:预选 + 持久化 + 自动挂载;iframe 模式 agentType 进 ready 链路 options', async () => {
    window.history.replaceState({}, '', '/ia/embed?agentType=ticket-assistant')
    const w = mountChat()
    await flushPromises()
    await flushPromises()
    // 深链自动挂载(WC),无需手点「挂载」
    expect(initMock).toHaveBeenCalledTimes(1)
    expect(lastInitAgentType()).toBe('ticket-assistant')
    expect(localStorage.getItem(IA_EMBED_AGENT_TYPE_KEY)).toBe(JSON.stringify('ticket-assistant'))

    // iframe 模式重挂:agentType 经 createIframeEmbed options 携带
    // (vendor 协议:宿主 hello 后回 ready 载荷 {appKey, agentType},child 用它 init)
    ;(w.vm as unknown as { mode: string }).mode = 'iframe'
    await w.find('[data-testid="embed-mount"]').trigger('click')
    await flushPromises()
    const options = createIframeEmbedMock.mock.calls[0]![0] as { agentType?: string }
    expect(options.agentType).toBe('ticket-assistant')
    w.unmount()
  })
})
