import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSectionHeader from './FcSectionHeader.vue'

describe('FcSectionHeader', () => {
  it('渲染 title 到 fc-section-header__title', () => {
    const w = mountFc(FcSectionHeader, { props: { title: '页面标题' } })
    expect(w.find('.fc-section-header__title').text()).toBe('页面标题')
  })

  it('subtitle 渲染到 fc-section-header__subtitle', () => {
    const w = mountFc(FcSectionHeader, { props: { title: 't', subtitle: 'sub' } })
    expect(w.find('.fc-section-header__subtitle').text()).toBe('sub')
  })

  it('无 subtitle 时不渲染 subtitle 元素', () => {
    const w = mountFc(FcSectionHeader, { props: { title: 't' } })
    expect(w.find('.fc-section-header__subtitle').exists()).toBe(false)
  })

  it('back=false (默认) 不渲染 back 按钮', () => {
    const w = mountFc(FcSectionHeader, { props: { title: 't' } })
    expect(w.find('.fc-section-header__back').exists()).toBe(false)
  })

  it('back=true 渲染 back 按钮 + 点击 emit back', async () => {
    const w = mountFc(FcSectionHeader, { props: { title: 't', back: true } })
    expect(w.find('.fc-section-header__back').exists()).toBe(true)
    await w.find('.fc-section-header__back').trigger('click')
    expect(emittedOf(w, 'back').length).toBe(1)
  })

  it('actions slot 渲染到 fc-section-header__actions', () => {
    const w = mountFc(FcSectionHeader, {
      props: { title: 't' },
      slots: { actions: '<button class="custom-act">x</button>' },
    })
    expect(w.find('.fc-section-header__actions button.custom-act').exists()).toBe(true)
  })

  it('welcome slot 渲染到 fc-section-header__welcome', () => {
    const w = mountFc(FcSectionHeader, {
      props: { title: 't' },
      slots: { welcome: '<div class="w-banner">welcome</div>' },
    })
    expect(w.find('.fc-section-header__welcome .w-banner').exists()).toBe(true)
  })

  /**
   * §E3 插槽契约守卫(2026-09-23):DEF-01 暴露的具名插槽错配风险——
   * 客户端误用未声明的插槽名时,Vue 静默丢弃内容。
   * 这里只冒烟「actions 插槽可见」,真正的契约锁定留待各调用点自测。
   */
  it('actions 插槽内容能被命中(防止错配 #extra/#action 等被静默丢弃)', () => {
    const w = mountFc(FcSectionHeader, {
      props: { title: 't' },
      slots: { actions: '<button class="state-tag">已注册</button>' },
    })
    expect(w.find('.fc-section-header__actions .state-tag').exists()).toBe(true)
    expect(w.text()).toContain('已注册')
  })
})