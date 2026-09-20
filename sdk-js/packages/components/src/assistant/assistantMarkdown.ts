/**
 * [port] assistantMarkdown — 源: $SRC/src/components/assistant/assistantMarkdown.ts。
 * 轻量安全 Markdown 渲染器 (纯函数), 逻辑 1:1 复制, 无 import 改动。
 */
/**
 * assistantMarkdown — 助手消息轻量 Markdown 渲染器 (纯函数).
 *
 * 对应旧 ai-fusion-video-web/components/dashboard/stream-markdown.tsx
 * (@ant-design/x-markdown + Prism 高亮) 的功能性降级子集: 新前端 package.json
 * 无 markdown 依赖 (经主控口径不新增包), 表格/代码高亮按轻量解析降级:
 * - 块级: ATX 标题 / 围栏代码块 (带语言标签, 不做语法高亮) / 有序无序列表 /
 *   引用块 / 水平线 / 表格 (完整表头+分隔行才渲染, 流式未完成降级为段落)
 * - 行内: **粗** / *斜* / ~~删~~ / `code` / [链接](http) / ![图](http)
 * - 安全: 全量 HTML 转义后再套标签; 链接/图片仅接受 http(s), 其余协议降级纯文字
 * - 流式: 未闭合围栏按代码到末尾, 未闭合行内标记按字面渲染 (下个增量重渲)
 *
 * 渲染挂点: AssistantTimeline 的 content / 工具结果 / 子 Agent content / reasoning
 * (旧 timeline.tsx:219,414,481 均走 StreamMarkdown)。
 */

/** HTML 转义 (先转义再套标签, 杜绝注入) */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const HTTP_URL = /^https?:\/\//i

interface CodeBlock {
  html: string
}

/** 围栏代码块 → md-codeblock; 未闭合 (流式) 到末尾都按代码 (输入已在入口统一转义) */
function renderCodeBlock(info: string, body: string): CodeBlock {
  const lang = info.trim().split(/\s+/)[0] ?? ''
  return {
    html: [
      '<div class="md-codeblock">',
      `<div class="md-codeblock__head"><span class="md-code-lang">${lang || 'text'}</span></div>`,
      `<pre class="md-pre"><code class="md-code">${body.replace(/\n$/, '')}</code></pre>`,
      '</div>',
    ].join(''),
  }
}

/** 行内标记渲染 (输入已 HTML 转义; 行内代码用占位符保护) */
function renderInline(escaped: string): string {
  const codes: string[] = []
  let text = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code)
    return `\x00${codes.length - 1}\x00`
  })

  // 图片: ![alt](url) — 仅 http(s)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    if (!HTTP_URL.test(url)) return `${alt} (${url})`
    return `<img class="md-img" src="${url}" alt="${alt}" loading="lazy">`
  })

  // 链接: [text](url) — 仅 http(s), 其余降级 "text (url)" 纯文字
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (!HTTP_URL.test(url)) return `${label} (${url})`
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })

  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  // 还原行内代码 (代码内容已在提取时保持转义态, 不再吃行内样式)
  return text.replace(/\x00(\d+)\x00/g, (_m, index: string) => {
    const code = codes[Number(index)] ?? ''
    return `<code class="md-code">${code}</code>`
  })
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** 表格 → md-table (thead + tbody) */
function renderTable(headerCells: string[], bodyRows: string[][]): string {
  const head = `<thead><tr>${headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`
  const body = `<tbody>${bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  return `<table class="md-table">${head}${body}</table>`
}

/**
 * Markdown → 安全 HTML. 输入原样 (含未转义 HTML), 输出可直接 v-html。
 * 空白输入返回空串。
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) return ''
  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n')

  const blocks: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let listOrdered = false
  let quoteLines: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push(`<p class="md-p">${renderInline(paragraph.join('<br>'))}</p>`)
    paragraph = []
  }
  const flushList = (): void => {
    if (listItems.length === 0) return
    const tag = listOrdered ? 'ol' : 'ul'
    const orderedClass = listOrdered ? ' md-list--ordered' : ''
    blocks.push(`<${tag} class="md-list${orderedClass}">${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`)
    listItems = []
  }
  const flushQuote = (): void => {
    if (quoteLines.length === 0) return
    blocks.push(`<blockquote class="md-quote">${renderInline(quoteLines.join('<br>'))}</blockquote>`)
    quoteLines = []
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // 围栏代码块 (``` 或 ~~~; 流式未闭合按代码到末尾)
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(.*)$/)
    if (fence) {
      flushAll()
      const marker = fence[1] ?? '```'
      const info = fence[2] ?? ''
      const body: string[] = []
      let closed = false
      for (i = i + 1; i < lines.length; i++) {
        if (new RegExp(`^\\s*${marker[0]}{3,}\\s*$`).test(lines[i] ?? '')) {
          closed = true
          break
        }
        body.push(lines[i] ?? '')
      }
      blocks.push(renderCodeBlock(info, body.join('\n')).html)
      if (!closed) break
      continue
    }

    // 引用块
    if (/^\s*&gt;\s?/.test(line) || /^\s*>\s?/.test(line)) {
      flushParagraph()
      flushList()
      quoteLines.push(line.replace(/^\s*(&gt;|>)\s?/, ''))
      continue
    }
    flushQuote()

    // 表格: 当前行含 | 且下一行是分隔行
    const nextLine = lines[i + 1] ?? ''
    if (line.includes('|') && isTableSeparator(nextLine)) {
      flushAll()
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(splitTableRow(lines[i] ?? ''))
        i += 1
      }
      i -= 1
      blocks.push(renderTable(header, rows))
      continue
    }

    // 水平线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll()
      blocks.push('<hr class="md-hr">')
      continue
    }

    // ATX 标题
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushAll()
      const level = (heading[1] ?? '#').length
      blocks.push(`<h${level} class="md-heading">${renderInline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    // 列表 (无序 - * + / 有序 1. 1.))
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const isOrdered = !!ordered
      if (listItems.length > 0 && isOrdered !== listOrdered) flushList()
      listOrdered = isOrdered
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? '').trim())
      continue
    }
    flushList()

    // 空行 → 段落边界
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    paragraph.push(line.trim())
  }
  flushAll()

  return blocks.join('')
}
