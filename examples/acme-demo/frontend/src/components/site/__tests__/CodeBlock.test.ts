import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CodeBlock from '@/components/site/CodeBlock.vue'

describe('CodeBlock(代码块:着色 + 一键复制)', () => {
  const writeText = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('渲染代码文本与语言徽标', () => {
    const w = mount(CodeBlock, { props: { code: 'const a = 1', lang: 'js' } })
    expect(w.find('pre').text()).toContain('const a = 1')
    expect(w.find('.code-block__lang').text()).toBe('js')
    expect(w.find('[data-testid="code-block"]').exists()).toBe(true)
    w.unmount()
  })

  it('着色:关键字/字符串有 token 类名', () => {
    const w = mount(CodeBlock, { props: { code: 'const a = "x"', lang: 'js' } })
    expect(w.find('.tok-keyword').exists()).toBe(true)
    expect(w.find('.tok-string').exists()).toBe(true)
    w.unmount()
  })

  it('一键复制:写入剪贴板成功 → 进入已复制态', async () => {
    vi.useFakeTimers()
    const w = mount(CodeBlock, { props: { code: 'hello-copy', lang: 'text' } })
    expect(writeText).not.toHaveBeenCalled()
    await w.find('[data-testid="code-copy"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(writeText).toHaveBeenCalledWith('hello-copy')
    expect(w.find('[data-testid="code-copy-done"]').exists()).toBe(true)
    // 2s 后自动退出已复制态
    await vi.advanceTimersByTimeAsync(2100)
    expect(w.find('[data-testid="code-copy"]').exists()).toBe(true)
    w.unmount()
    vi.useRealTimers()
  })

  it('复制失败:停留在可复制态,不误报成功', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    const w = mount(CodeBlock, { props: { code: 'x', lang: 'text' } })
    await w.find('[data-testid="code-copy"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    expect(w.find('[data-testid="code-copy-done"]').exists()).toBe(false)
    expect(w.find('[data-testid="code-copy"]').exists()).toBe(true)
    w.unmount()
  })
})
