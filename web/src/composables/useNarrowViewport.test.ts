/**
 * [new] useNarrowViewport 窄屏探测测试(#26 短期方案)。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useNarrowViewport } from './useNarrowViewport'

let originalMatchMedia: typeof window.matchMedia | undefined

function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('useNarrowViewport', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })
  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia
  })

  it('视口 <1280 → narrow=true;>=1280 → false(次要列收起依据)', async () => {
    stubMatchMedia(true)
    const host = defineComponent({
      setup() {
        const narrow = useNarrowViewport()
        return () => h('span', { 'data-narrow': String(narrow.value) })
      },
    })
    const wrapper = mount(host)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('span').attributes('data-narrow')).toBe('true')
    wrapper.unmount()

    stubMatchMedia(false)
    const wrapper2 = mount(host)
    await wrapper2.vm.$nextTick()
    expect(wrapper2.find('span').attributes('data-narrow')).toBe('false')
    wrapper2.unmount()
  })

  it('默认断点 1280:生成 (max-width: 1279px) 查询', () => {
    let captured = ''
    window.matchMedia = ((query: string) => {
      captured = query
      return {
        matches: false, media: query, onchange: null,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
      }
    }) as unknown as typeof window.matchMedia
    const host = defineComponent({ setup: () => () => h('i') })
    mount(host, { setup() { useNarrowViewport(); return () => h('i') } })
    expect(captured).toBe('(max-width: 1279px)')
  })
})
