/**
 * [new] IaEmpty 统一空态组件测试(优化建议 #9)。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import IaEmpty from '../IaEmpty.vue'

describe('IaEmpty 统一空态', () => {
  it('渲染图标 + 一句话说明;无提示/CTA 时不渲染对应块', () => {
    const wrapper = mount(IaEmpty, {
      props: { description: '还没有注册任何工具' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('.ia-empty__desc').text()).toBe('还没有注册任何工具')
    expect(wrapper.find('.ia-empty__icon').exists()).toBe(true)
    expect(wrapper.find('.ia-empty__hint').exists()).toBe(false)
    expect(wrapper.find('.ia-empty__action').exists()).toBe(false)
  })

  it('hint 与 CTA 插槽渲染(表格 0 行 → 明确下一步)', async () => {
    const wrapper = mount(IaEmpty, {
      props: { description: '还没有工具授权记录', hint: '可为宿主用户代授工具' },
      slots: { action: '<button class="cta">代授工具授权</button>' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('.ia-empty__hint').text()).toBe('可为宿主用户代授工具')
    expect(wrapper.find('.cta').text()).toBe('代授工具授权')
  })
})
