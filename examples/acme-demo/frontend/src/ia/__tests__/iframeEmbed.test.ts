import { describe, it, expect } from 'vitest'
import {
  IA_FRAME_PATH,
  assertNoTokenInSrc,
  buildIframeEmbedOptions,
  describeEmbedEvent,
  resolveFrameSrc,
} from '@/ia/iframeEmbed'

const ORIGIN = 'http://localhost:9203'

describe('resolveFrameSrc(iframe 被嵌页地址归一)', () => {
  it('相对路径按当前 origin 解析', () => {
    expect(resolveFrameSrc(IA_FRAME_PATH, ORIGIN)).toBe(`${ORIGIN}/ia/frame.html`)
  })

  it('无前导斜杠自动补齐;绝对地址原样保留', () => {
    expect(resolveFrameSrc('ia/frame.html', ORIGIN)).toBe(`${ORIGIN}/ia/frame.html`)
    expect(resolveFrameSrc('https://host.example.com/ia/frame.html', ORIGIN))
      .toBe('https://host.example.com/ia/frame.html')
  })

  it('空地址抛错', () => {
    expect(() => resolveFrameSrc('', ORIGIN)).toThrow()
  })
})

describe('token 不入 URL 红线(examples/iframe-host README 安全决策)', () => {
  it('src 带 token 形 query → 抛错', () => {
    expect(() => assertNoTokenInSrc(`${ORIGIN}/ia/frame.html?access_token=abc`)).toThrow()
    expect(() => assertNoTokenInSrc(`${ORIGIN}/ia/frame.html?token=abc`)).toThrow()
    expect(() => assertNoTokenInSrc(`${ORIGIN}/ia/frame.html?a=1&ACCESS-TOKEN=x`)).toThrow()
  })

  it('干净 src 通过;buildIframeEmbedOptions 产物不含 token', () => {
    expect(() => assertNoTokenInSrc(`${ORIGIN}/ia/frame.html`)).not.toThrow()
    const options = buildIframeEmbedOptions({
      origin: ORIGIN,
      appKey: 'acme-demo',
      agentType: 'ai_media',
      tokenGetter: async () => null,
      container: document.createElement('div'),
    })
    expect(options.src).toBe(`${ORIGIN}/ia/frame.html`)
    expect(options.appKey).toBe('acme-demo')
    expect(typeof options.tokenGetter).toBe('function')
    expect(String(options.src)).not.toMatch(/token/i)
  })
})

describe('describeEmbedEvent(postMessage 桥事件 → 演示日志行)', () => {
  it('拼接 kind/status/toolName/message,缺省段跳过', () => {
    expect(describeEmbedEvent({ kind: 'status' })).toBe('status')
    expect(describeEmbedEvent({ kind: 'run-terminal', status: 'COMPLETED' })).toBe('run-terminal:COMPLETED')
    expect(describeEmbedEvent({ kind: 'tool-finished', toolName: 'create_ticket', message: 'ok' }))
      .toBe('tool-finished:create_ticket:ok')
  })
})
