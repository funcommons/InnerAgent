/**
 * [new] init 契约测试 (02-技术方案 §8.1 / 任务 P1-T3a 契约)。
 * - 默认值: baseURL '/ia/api/v1'、mode 'wc'、agentType 'ai_media'
 * - appKey/tokenGetter 必填
 * - mode 'iframe' (P4/W15 起): 接受并存入 runtime —— 宿主侧声明 iframe 接入;
 *   实际桥接由 @inneragent/sdk-iframe 的 createIframeEmbed 承载 (token 走
 *   postMessage, 不入 URL)。
 * - theme 令牌写入 document root
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  init,
  resetSdkConfig,
  getSdkConfig,
  getBaseURL,
  applyTheme,
  IA_THEME_TOKENS,
} from '../config'

describe('sdk-core config (init 契约)', () => {
  beforeEach(() => {
    resetSdkConfig()
  })
  afterEach(() => {
    resetSdkConfig()
    if (typeof document !== 'undefined') {
      for (const token of IA_THEME_TOKENS) {
        document.documentElement.style.removeProperty(token)
      }
    }
  })

  it('init: 必填 appKey/tokenGetter; 缺失抛错', () => {
    expect(() => init({ appKey: '', tokenGetter: async () => null })).toThrow('appKey is required')
    expect(() => init({ appKey: 'demo', tokenGetter: undefined as unknown as () => Promise<string | null> }))
      .toThrow('tokenGetter is required')
  })

  it('init: 默认 baseURL=/ia/api/v1, mode=wc, agentType=ai_media', () => {
    const runtime = init({ appKey: 'demo', tokenGetter: async () => 't' })
    expect(runtime.baseURL).toBe('/ia/api/v1')
    expect(runtime.mode).toBe('wc')
    expect(runtime.agentType).toBe('ai_media')
    expect(getBaseURL()).toBe('/ia/api/v1')
  })

  it('init: baseURL 可配置且去除尾部斜杠', () => {
    init({ appKey: 'demo', tokenGetter: async () => 't', baseURL: 'https://host.example/ia/api/v1/' })
    expect(getSdkConfig().baseURL).toBe('https://host.example/ia/api/v1')
  })

  it('mode iframe (P4/W15): 接受并存入 runtime (宿主侧声明; 桥接在 sdk-iframe 包)', () => {
    const runtime = init({ appKey: 'demo', tokenGetter: async () => 't', mode: 'iframe' })
    expect(runtime.mode).toBe('iframe')
  })

  it('未 init 时 getSdkConfig 抛错 (防静默裸奔)', () => {
    expect(() => getSdkConfig()).toThrow('call init({ appKey, tokenGetter }) first')
  })

  it('theme: --ia-* 令牌写入 document root, 未传的令牌不动', () => {
    applyTheme({ '--ia-primary': '#7c3aed', '--ia-danger': '#ef4444' })
    expect(document.documentElement.style.getPropertyValue('--ia-primary')).toBe('#7c3aed')
    expect(document.documentElement.style.getPropertyValue('--ia-danger')).toBe('#ef4444')
    expect(document.documentElement.style.getPropertyValue('--ia-bg')).toBe('')
  })
})
