import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ArchDiagram from '@/components/site/ArchDiagram.vue'

describe('ArchDiagram(架构一图流,内联 SVG)', () => {
  function mountDiagram() {
    return mount(ArchDiagram)
  }

  it('渲染 role=img 的 svg 且带可访问标题', () => {
    const w = mountDiagram()
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('role')).toBe('img')
    const title = svg.find('title')
    // 空测试 i18n 下 t 回退 key:标题 key 必须存在(防漏翻)
    expect(title.text()).toBe('home.arch.title')
    w.unmount()
  })

  it('四个图层框 + 三条数据流 + 令牌标注齐全', () => {
    const w = mountDiagram()
    const text = w.find('svg').text()
    // 图层(i18n key 形态)
    expect(text).toContain('home.arch.host-app')
    expect(text).toContain('home.arch.host-frontend')
    expect(text).toContain('home.arch.host-backend')
    expect(text).toContain('home.arch.ia-core')
    expect(text).toContain('home.arch.ia-admin')
    expect(text).toContain('home.arch.model')
    // 数据流标注(双级令牌 + MCP + 模型调用)
    expect(text).toContain('home.arch.flow-embed')
    expect(text).toContain('home.arch.flow-act')
    expect(text).toContain('home.arch.flow-mcp')
    expect(text).toContain('home.arch.flow-model')
    w.unmount()
  })

  it('箭头使用 marker 且不引用任何外部图片资源', () => {
    const w = mountDiagram()
    const html = w.find('svg').html()
    expect(html).toContain('marker-end')
    expect(html).not.toMatch(/<image/i)
    expect(html).not.toMatch(/url\((?!#)/)
    w.unmount()
  })
})
