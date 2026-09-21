/**
 * [new] 工具体检三态徽标测试(V17):绿=ok / 黄=degraded / 红=unreachable,
 * NULL=未体检灰;未知码值兜底原样展示。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import IaToolHealthBadge from '../IaToolHealthBadge.vue'

function mountBadge(status: string | null | undefined) {
  return mount(IaToolHealthBadge, {
    props: { status },
    global: { plugins: [ElementPlus] },
  })
}

describe('IaToolHealthBadge 体检三态徽标(V17)', () => {
  it('ok → 绿(健康);degraded → 黄(漂移);unreachable → 红(不可达)', () => {
    const ok = mountBadge('ok')
    expect(ok.find('.health-badge--ok').exists()).toBe(true)
    expect(ok.text()).toContain('健康')

    const degraded = mountBadge('degraded')
    expect(degraded.find('.health-badge--degraded').exists()).toBe(true)
    expect(degraded.text()).toContain('漂移')

    const unreachable = mountBadge('unreachable')
    expect(unreachable.find('.health-badge--unreachable').exists()).toBe(true)
    expect(unreachable.text()).toContain('不可达')
  })

  it('NULL → 未体检灰(引导执行立即体检)', () => {
    for (const status of [null, undefined]) {
      const wrapper = mountBadge(status)
      expect(wrapper.find('.health-badge--none').exists()).toBe(true)
      expect(wrapper.text()).toContain('未体检')
      wrapper.unmount()
    }
  })

  it('未知码值兜底原样展示(不静默吞)', () => {
    const wrapper = mountBadge('maintenance')
    expect(wrapper.find('.health-badge--maintenance').exists()).toBe(true)
    expect(wrapper.text()).toContain('maintenance')
  })
})
