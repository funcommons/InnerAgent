/**
 * [new] IaTime 相对时间组件测试(优化建议 #21)。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import IaTime from '../IaTime.vue'

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

describe('IaTime 相对时间', () => {
  it('1 小时前的事件渲染「小时前」;datetime 属性保留 ISO 原值', () => {
    const value = iso(-3_600_000)
    const wrapper = mount(IaTime, {
      props: { value },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.text()).toContain('小时前')
    expect(wrapper.find('time').attributes('datetime')).toBe(value)
  })

  it('未来时间渲染「后」向语义(投递退避场景)', () => {
    const wrapper = mount(IaTime, {
      props: { value: iso(5 * 60_000) },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.text()).toContain('分钟后')
  })

  it('epoch 毫秒输入与 ISO 等价(#18b 时间源)', () => {
    const ms = Date.now() - 2 * 60_000
    const wrapper = mount(IaTime, {
      props: { value: ms },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.text()).toContain('分钟前')
    expect(wrapper.find('time').attributes('datetime')).toBe(new Date(ms).toISOString())
  })

  it('空值/非法值渲染 —;absolute 模式直出 ISO', () => {
    const empty = mount(IaTime, { props: { value: null }, global: { plugins: [ElementPlus] } })
    expect(empty.text()).toBe('—')
    const abs = mount(IaTime, {
      props: { value: iso(-3_600_000), absolute: true },
      global: { plugins: [ElementPlus] },
    })
    expect(abs.text()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
