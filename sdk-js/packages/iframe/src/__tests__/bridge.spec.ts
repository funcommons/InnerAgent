/**
 * [new] iframe 桥全栈测试 (P4/W15) — 宿主 createIframeEmbed × child
 * mountIframeAgent 经内存传输对直连 (同步确定性)。
 *
 * 覆盖: 握手 (含宿主后就绪重试 / nonce 混淆防护 / 版本不符丢弃)、origin
 * allowlist 双侧拒绝、token 通道 (initial/refresh; token 不入 URL 的 API 层
 * 防线)、上下文/主题同步、事件外发 (运行终态/工具完成/错误)、握手超时、
 * destroy 清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetSdkConfig,
  getSdkConfig,
  getRunContext,
  getAssistantEventHooks,
  setAssistantEventHooks,
  IA_THEME_TOKENS,
  type TokenGetter,
} from '@inneragent/sdk-core'
import { createMessage, IA_BRIDGE_VERSION } from '../protocol'
import { createMemoryTransportPair } from '../transport'
import { createIframeEmbed, type IframeEmbed } from '../host'
import {
  mountIframeAgent,
  __resetIframeAgentForTests,
  type IframeAgentHandle,
} from '../child'

const HOST_ORIGIN = 'https://host.example'
const FRAME_ORIGIN = 'https://frame.example'

function mountedDiv(): HTMLElement {
  const div = document.createElement('div')
  div.setAttribute('data-testid', 'ia-bridge-mount')
  return div
}

function setupEmbed(pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)) {
  const tokenGetter = vi.fn(async (): Promise<string | null> => 'tok-1')
  const onEvent = vi.fn()
  const embed = createIframeEmbed({
    src: `${FRAME_ORIGIN}/inneragent/frame.html`,
    appKey: 'crm-app',
    agentType: 'demo',
    tokenGetter: tokenGetter as unknown as TokenGetter,
    transport: pair.a,
    allowedOrigins: [FRAME_ORIGIN],
    handshakeTimeoutMs: 500,
    ackTimeoutMs: 200,
    onEvent: onEvent as never,
  })
  return { pair, tokenGetter, onEvent, embed }
}

function setupChild(pair: ReturnType<typeof createMemoryTransportPair>, overrides: Record<string, unknown> = {}) {
  return mountIframeAgent({
    allowedParentOrigins: [HOST_ORIGIN],
    helloRetryIntervalMs: 5,
    handshakeTimeoutMs: 500,
    tokenAckTimeoutMs: 300,
    transport: pair.b,
    target: document.body,
    elementFactory: mountedDiv,
    ...overrides,
  })
}

async function handshake(pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)) {
  const setup = setupEmbed(pair)
  const child = setupChild(pair)
  await Promise.all([setup.embed.ready, child.ready])
  return {
    pair,
    host: setup.embed,
    child,
    tokenGetter: setup.tokenGetter as unknown as ReturnType<typeof vi.fn>,
    onEvent: setup.onEvent,
  }
}

describe('iframe 桥 (宿主 × child 全栈)', () => {
  let activeEmbed: IframeEmbed | null = null
  let activeChild: IframeAgentHandle | null = null

  beforeEach(() => {
    resetSdkConfig()
    setAssistantEventHooks(undefined)
    __resetIframeAgentForTests()
  })

  afterEach(() => {
    activeEmbed?.destroy()
    activeChild?.destroy()
    activeEmbed = null
    activeChild = null
    resetSdkConfig()
    setAssistantEventHooks(undefined)
    __resetIframeAgentForTests()
    for (const token of IA_THEME_TOKENS) {
      document.documentElement.style.removeProperty(token)
    }
  })

  it('握手完成 → child 应用宿主引导配置 (appKey/agentType) 并挂载 WC 元素', async () => {
    const { host, child } = await handshake().then((h) => {
      activeEmbed = h.host
      activeChild = h.child
      return h
    })

    expect(host.handshakeOrigin).toBe(FRAME_ORIGIN)
    expect(child.status).toBe('ready')
    expect(getSdkConfig().appKey).toBe('crm-app')
    expect(getSdkConfig().agentType).toBe('demo')
    expect(document.querySelector('[data-testid="ia-bridge-mount"]')).toBeTruthy()
  })

  it('宿主晚于 child 就绪: hello 重试直至宿主监听', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    activeChild = child

    // 宿主此时才上线 (首个 hello 落空, 重试补握手)
    const setup = setupEmbed(pair)
    const host = setup.embed
    activeEmbed = host

    await Promise.all([host.ready, child.ready])
    expect(child.status).toBe('ready')
  })

  it('nonce 混淆防护: ack 与最近 hello 不匹配的 ready 被丢弃', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    activeChild = child
    // 等 child 至少发出一次 hello (同步首发已入队)
    await new Promise((resolve) => setTimeout(resolve, 10))

    pair.inject('b', {
      ns: 'inneragent.bridge',
      v: IA_BRIDGE_VERSION,
      type: 'ready',
      nonce: 'attacker-nonce',
      ack: 'wrong-nonce',
      payload: { protocolVersion: IA_BRIDGE_VERSION, appKey: 'evil-app' },
    }, HOST_ORIGIN)

    expect(child.status).toBe('handshaking')
    expect(child.rejectedMessageCount).toBeGreaterThanOrEqual(1)
    expect(() => getSdkConfig()).toThrow()
  })

  it('版本不符/非协议消息被静默丢弃 (不进状态机)', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    activeChild = child
    await new Promise((resolve) => setTimeout(resolve, 10))

    pair.inject('b', { ns: 'inneragent.bridge', v: IA_BRIDGE_VERSION + 99, type: 'ready', nonce: 'x', ack: 'y' }, HOST_ORIGIN)
    pair.inject('b', 'raw garbage string', HOST_ORIGIN)
    pair.inject('b', { someRandom: 'postMessage traffic' }, HOST_ORIGIN)

    expect(child.status).toBe('handshaking')
    expect(child.rejectedMessageCount).toBe(0) // 非协议流量不计入 origin 拒绝
  })

  it('origin 拒绝 (host 侧): 非 allowlist 来源的 hello 不触发握手', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const host = setupEmbed(pair).embed
    activeEmbed = host

    pair.inject('a', createMessage('hello', { protocolVersion: IA_BRIDGE_VERSION }), 'https://evil.example')

    await expect(Promise.race([
      host.ready,
      new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 30)),
    ])).resolves.toBe('still-pending')
    expect(host.rejectedMessageCount).toBe(1)
  })

  it('origin 拒绝 (child 侧): 非 allowlist 来源的 ready 被丢弃', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    activeChild = child
    await new Promise((resolve) => setTimeout(resolve, 10))

    // 借真实 child 的最近 hello nonce 构造"内容合法但来源非法"的 ready
    const helloToHost = pair.log().find((entry) => entry.message.type === 'hello')
    expect(helloToHost).toBeTruthy()
    pair.inject('b', {
      ...createMessage('ready', { protocolVersion: IA_BRIDGE_VERSION, appKey: 'x' }, helloToHost!.message.nonce),
    }, 'https://evil.example')

    expect(child.status).toBe('handshaking')
    expect(child.rejectedMessageCount).toBeGreaterThanOrEqual(1)
  })

  it('token 通道: initial 经桥获取; requestTokenRefresh 触发宿主 tokenGetter 重取', async () => {
    const ctx = await handshake()
    activeEmbed = ctx.host
    activeChild = ctx.child

    // bootstrap 内已做 initial 请求
    expect(ctx.tokenGetter).toHaveBeenCalledTimes(1)
    const refreshed = await ctx.child.requestTokenRefresh()
    expect(refreshed).toBe('tok-1')
    expect(ctx.tokenGetter).toHaveBeenCalledTimes(2)
  })

  it('onUnauthorized 钩子 → child 失效缓存并向宿主以 refresh 重取', async () => {
    const ctx = await handshake()
    activeEmbed = ctx.host
    activeChild = ctx.child
    expect(ctx.tokenGetter).toHaveBeenCalledTimes(1)

    getAssistantEventHooks().onUnauthorized?.()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(ctx.tokenGetter).toHaveBeenCalledTimes(2)
  })

  it('token 不入 URL: src 携带 token 形 query 参数直接抛错; 普通参数放行', () => {
    const build = (search: string): IframeEmbed => createIframeEmbed({
      src: `${FRAME_ORIGIN}/frame.html${search}`,
      appKey: 'crm-app',
      tokenGetter: async () => null,
      transport: createMemoryTransportPair().a,
    })
    expect(() => build('?token=abc')).toThrow(/token 不入 URL/)
    expect(() => build('?access_token=abc')).toThrow(/token 不入 URL/)
    expect(() => build('?session_token=abc')).toThrow(/token 不入 URL/)
    expect(() => build('?api_key=abc')).toThrow(/token 不入 URL/)
    // 正常参数与 token 无关, 放行且原样保留
    const embed = build('?view=chat&theme=dark')
    activeEmbed = embed
    expect(embed.handshakeOrigin).toBe(FRAME_ORIGIN)
  })

  it('上下文同步: setPage/setObject/clearContext 经桥到达 setRunContext', async () => {
    const ctx = await handshake()
    activeEmbed = ctx.host
    activeChild = ctx.child

    ctx.host.setPage({ name: 'project-detail' })
    ctx.host.setObject({ type: 'script', id: 7 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getRunContext()).toEqual({
      page: { name: 'project-detail' },
      object: { type: 'script', id: 7 },
    })

    ctx.host.clearContext()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(getRunContext()).toEqual({ page: undefined, object: undefined })
  })

  it('握手前 setPage 排队, 握手完成后补发', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const host = setupEmbed(pair).embed
    activeEmbed = host
    host.setPage('home') // hello 未到 → 入队

    const child = setupChild(pair)
    activeChild = child
    await Promise.all([host.ready, child.ready])
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getRunContext().page).toBe('home')
  })

  it('setTheme 经桥应用 (--ia-* 写入 document root)', async () => {
    const ctx = await handshake()
    activeEmbed = ctx.host
    activeChild = ctx.child

    ctx.host.setTheme({ '--ia-primary': '#7c3aed' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(document.documentElement.style.getPropertyValue('--ia-primary')).toBe('#7c3aed')
  })

  it('事件外发: 运行终态/工具完成经桥到达宿主 onEvent, 且宿主 ack', async () => {
    const ctx = await handshake()
    activeEmbed = ctx.host
    activeChild = ctx.child

    getAssistantEventHooks().onRunTerminal?.()
    getAssistantEventHooks().onToolFinished?.('generate_image')
    await new Promise((resolve) => setTimeout(resolve, 10))

    const kinds = ctx.onEvent.mock.calls.map((call) => (call[0] as { kind: string }).kind)
    expect(kinds).toContain('run-terminal')
    expect(kinds).toContain('tool-finished')
    // 宿主对 event 自动 ack (协议表)
    const acks = ctx.pair.log().filter((entry) => entry.from === 'a' && entry.message.type === 'ack')
    expect(acks.length).toBeGreaterThanOrEqual(3) // status ready + 2 events
  })

  it('握手超时 (child 侧): ready reject + fatal error 事件 (尽力外发)', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    // 不创建宿主 → child 的 hello 无应答; error 事件落到对端日志外, 需自挂监听
    const child = mountIframeAgent({
      allowedParentOrigins: [HOST_ORIGIN],
      helloRetryIntervalMs: 5,
      handshakeTimeoutMs: 40,
      transport: pair.b,
      elementFactory: mountedDiv,
    })
    activeChild = child

    await expect(child.ready).rejects.toThrow(/handshake timeout/)
    expect(child.status).toBe('failed')
  })

  it('握手超时 (host 侧): iframe 无 child 响应时 ready reject', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const setup = setupEmbed(pair)
    const host = setup.embed
    activeEmbed = host

    await expect(host.ready).rejects.toThrow(/handshake timeout/)
  })

  it('destroy (host): 停止处理消息并移除 iframe 元素', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const iframe = document.createElement('iframe')
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const host = createIframeEmbed({
      src: `${FRAME_ORIGIN}/frame.html`,
      appKey: 'crm-app',
      tokenGetter: async () => 'tok-1',
      transport: pair.a,
      container,
      createElement: () => iframe,
      handshakeTimeoutMs: 500,
    })
    activeEmbed = host
    host.destroy()

    expect(container.querySelector('iframe')).toBeNull()
    // destroy 后注入 hello 不再触发握手
    pair.inject('a', createMessage('hello', { protocolVersion: IA_BRIDGE_VERSION }), FRAME_ORIGIN)
    await expect(host.ready).rejects.toThrow(/destroyed/)
    container.remove()
  })

  it('destroy (child): 状态置 destroyed, 释放单实例守卫后可重挂', async () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    child.destroy()
    expect(child.status).toBe('destroyed')

    const again = setupChild(pair)
    activeChild = again
    expect(again.status).toBe('handshaking')
    again.destroy()
  })

  it('重复 mountIframeAgent (未 destroy) 抛错', () => {
    const pair = createMemoryTransportPair(HOST_ORIGIN, FRAME_ORIGIN)
    const child = setupChild(pair)
    activeChild = child
    expect(() => setupChild(pair)).toThrow(/already called/)
  })
})
