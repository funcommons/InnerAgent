import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, type ComputedRef } from 'vue'
import { useSidebarNavItems, NAV_DEFAULT_OPENEDS } from '@/composables/useSidebarNavItems'
import { usePreferenceStore } from '@/store/preference'
import i18n from '@/locales'
import type { NavItem } from '@/components/sdk'

/**
 * 控制台侧栏 nav:既有三入口 + 开发者 + 「返回官网」(公开区 ↔ 控制台一致回路)。
 * useI18n 需 setup 上下文 → 经探针组件挂载,并装真实 i18n 验证双语 label。
 */
const captured: { items: ComputedRef<NavItem[]> | null } = { items: null }

const Probe = defineComponent({
  setup() {
    captured.items = useSidebarNavItems()
    return () => h('div')
  },
})

function items(): NavItem[] {
  return captured.items!.value
}

function mountProbe() {
  const pinia = createPinia()
  const wrapper = mount(Probe, { global: { plugins: [pinia, i18n] } })
  return { wrapper, preference: usePreferenceStore(pinia) }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('useSidebarNavItems(控制台侧栏 nav)', () => {
  it('NAV_DEFAULT_OPENEDS 为空数组(无 sub-menu)', () => {
    expect(NAV_DEFAULT_OPENEDS).toEqual([])
  })

  it('包含 /ia 五入口(总览/画廊/Agent 管理/嵌入/工具)、/dev 与 / 返回官网', () => {
    const { wrapper } = mountProbe()
    expect(items().map((i) => i.index)).toEqual([
      '/ia/overview', '/ia/agents', '/ia/agent-admin', '/ia/embed', '/ia/tools', '/dev', '/',
    ])
    const back = items()[items().length - 1]!
    expect(back.index).toBe('/')
    expect(back.icon).toBeTruthy()
    wrapper.unmount()
  })

  it('切换语言后「返回官网」label 随真实字典更新', async () => {
    const { wrapper, preference } = mountProbe()
    preference.setLocale('zh-CN')
    i18n.global.locale.value = 'zh-CN'
    await flushPromises()
    expect(items()[items().length - 1]!.label).toBe('返回官网')

    preference.setLocale('en-US')
    i18n.global.locale.value = 'en-US'
    await flushPromises()
    expect(items()[items().length - 1]!.label).toBe('Back to site')
    wrapper.unmount()
  })
})
