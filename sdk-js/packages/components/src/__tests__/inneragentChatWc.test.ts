/**
 * [new] <inneragent-chat> Web Component 注册冒烟 (jsdom)。
 * - defineCustomElement 产出 Vue 自定义元素类 (VueElement)
 * - customElements.define 后 createElement 建立实例, 挂载后形成 Shadow Root
 * - Shadow DOM 隔离: 组件内容渲染在 shadowRoot 内, light DOM 只有宿主标签
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { init, resetSdkConfig } from '@inneragent/sdk-core'
import { InnerAgentChatElement, registerInnerAgentChat } from '../inneragent-chat'

describe('<inneragent-chat> WC 注册冒烟', () => {
  beforeAll(() => {
    resetSdkConfig()
    init({ appKey: 'wc-demo', tokenGetter: async () => null })
  })

  it('defineCustomElement 产出元素构造器 (VueElement)', () => {
    expect(typeof InnerAgentChatElement).toBe('function')
    // VueElement 原型具备 custom element 生命周期挂载入口
    const proto = InnerAgentChatElement.prototype as unknown as Record<string, unknown>
    expect(typeof proto.connectedCallback).toBe('function')
  })

  it('customElements.define 注册成功且幂等', () => {
    registerInnerAgentChat()
    expect(customElements.get('inneragent-chat')).toBe(InnerAgentChatElement)
    // 重复注册不抛错 (幂等跳过)
    expect(() => registerInnerAgentChat()).not.toThrow()
  })

  it('createElement + connect → Shadow Root 建立, light DOM 保持隔离', async () => {
    registerInnerAgentChat()
    const host = document.createElement('inneragent-chat')
    host.setAttribute('view', 'chat')
    document.body.appendChild(host)
    // Vue 自定义元素在 connectedCallback 同步挂载; 等 microtask 完成渲染
    await Promise.resolve()
    await Promise.resolve()

    const shadowRoot = host.shadowRoot
    expect(shadowRoot).toBeTruthy()
    // 组件内容在 shadow root 内
    expect(shadowRoot!.querySelector('[data-testid="assistant-window"]')).toBeTruthy()
    // light DOM 无业务节点 (Shadow DOM 隔离)
    expect(host.querySelector('[data-testid="assistant-window"]')).toBeNull()
    host.remove()
  })
})
