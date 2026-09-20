/**
 * assistantMarkdown 轻量渲染器测试 — 对齐旧 StreamMarkdown (@ant-design/x-markdown)
 * 的功能性降级子集: package.json 无 markdown 依赖, 按主控口径写轻量解析器
 * (标题/列表/表格/围栏代码/行内样式/链接, 全量 HTML 转义防 XSS)。
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../assistant/assistantMarkdown'

describe('assistantMarkdown.renderMarkdown (轻量 Markdown 渲染)', () => {
  it('纯文本单段 → p 标签保留换行为 br', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p class="md-p">第一行<br>第二行</p>')
  })

  it('ATX 标题 # ~ ###### → 对应 h1~h6', () => {
    expect(renderMarkdown('# 大标题')).toBe('<h1 class="md-heading">大标题</h1>')
    expect(renderMarkdown('### 三级')).toBe('<h3 class="md-heading">三级</h3>')
    expect(renderMarkdown('###### 六级')).toBe('<h6 class="md-heading">六级</h6>')
  })

  it('行内样式: 粗体/斜体/删除线/行内代码', () => {
    expect(renderMarkdown('**加粗** 与 *斜体* 与 ~~删除~~ 与 `code()`'))
      .toBe('<p class="md-p"><strong>加粗</strong> 与 <em>斜体</em> 与 <del>删除</del> 与 <code class="md-code">code()</code></p>')
  })

  it('链接: http(s) 渲染 a 标签新窗口; javascript: 协议只保留文字', () => {
    expect(renderMarkdown('[官网](https://example.com)'))
      .toBe('<p class="md-p"><a href="https://example.com" target="_blank" rel="noopener noreferrer">官网</a></p>')
    // 非 http(s) 协议降级为纯文字, 不产出可点击链接
    expect(renderMarkdown('[坏链](javascript:alert(1))'))
      .toBe('<p class="md-p">坏链 (javascript:alert(1))</p>')
  })

  it('图片: http(s) 渲染 img; 非 http 协议降级为纯文字', () => {
    expect(renderMarkdown('![图](https://cdn.example.com/a.png)'))
      .toBe('<p class="md-p"><img class="md-img" src="https://cdn.example.com/a.png" alt="图" loading="lazy"></p>')
    expect(renderMarkdown('![x](data:text/html;base64,xxx)')).toBe('<p class="md-p">x (data:text/html;base64,xxx)</p>')
  })

  it('HTML 转义: script/标签按文本呈现不执行', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<b>粗</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>粗</b>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('围栏代码块: 语言标签 + 内容转义; 未闭合围栏 (流式) 到末尾都算代码', () => {
    const closed = renderMarkdown('```python\nx = "<b>"\n```')
    expect(closed).toContain('md-codeblock')
    expect(closed).toContain('<span class="md-code-lang">python</span>')
    expect(closed).toContain('x = &quot;&lt;b&gt;&quot;')

    const streaming = renderMarkdown('```js\nconst a = 1;')
    expect(streaming).toContain('md-codeblock')
    expect(streaming).toContain('const a = 1;')
  })

  it('表格: 表头 + 分隔行 + 数据行 → table/thead/tbody', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table class="md-table">')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<th>B</th>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<td>2</td>')
  })

  it('未完成表格 (无分隔行, 流式中) → 按普通段落降级', () => {
    const html = renderMarkdown('| A | B |')
    expect(html).not.toContain('<table')
    expect(html).toContain('| A | B |')
  })

  it('无序列表与有序列表', () => {
    const ul = renderMarkdown('- 甲\n- 乙')
    expect(ul).toContain('<ul class="md-list">')
    expect(ul).toContain('<li>甲</li>')
    expect(ul).toContain('<li>乙</li>')

    const ol = renderMarkdown('1. 一\n2. 二')
    expect(ol).toContain('<ol class="md-list md-list--ordered">')
    expect(ol).toContain('<li>一</li>')
  })

  it('引用块: 连续 > 行合并为 blockquote', () => {
    const html = renderMarkdown('> 引用一\n> 引用二')
    expect(html).toContain('<blockquote class="md-quote">')
    expect(html).toContain('引用一<br>引用二')
  })

  it('水平分隔线', () => {
    expect(renderMarkdown('---')).toBe('<hr class="md-hr">')
  })

  it('混合文档: 标题+段落+列表+代码块分块渲染', () => {
    const html = renderMarkdown('# 计划\n\n这是**重点**。\n\n- 步骤一\n- 步骤二\n\n```\ncode\n```')
    expect(html).toContain('<h1 class="md-heading">计划</h1>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<li>步骤一</li>')
    expect(html).toContain('md-codeblock')
  })

  it('空内容 → 空串', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
  })
})
