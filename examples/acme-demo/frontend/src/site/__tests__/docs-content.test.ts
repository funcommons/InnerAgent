import { describe, it, expect } from 'vitest'
import {
  getDocSections,
  getDocSection,
  getDocNeighbours,
  getDocStepIndex,
  DOC_SECTION_IDS,
} from '@/site/docs'
import type { DocBlock, DocSection } from '@/site/docs'

const zh = getDocSections('zh-CN')
const en = getDocSections('en-US')

/** 结构指纹:块类型 + 代码语言 + 表格维度(不比文案,允许双语自由表达) */
function shapeOf(blocks: DocBlock[]): string[] {
  return blocks.map((b) => {
    switch (b.type) {
      case 'code': return `code:${b.lang}`
      case 'table': return `table:${b.head.length}x${b.rows.length}x${b.rows[0]?.length ?? 0}`
      case 'list': return `list:${b.items.length}`
      default: return b.type
    }
  })
}

describe('docs content(文档中心结构化内容)', () => {
  it('八个章节,顺序与 DOC_SECTION_IDS 一致(zh/en 同序)', () => {
    expect(DOC_SECTION_IDS).toHaveLength(8)
    expect(zh.map((s) => s.id)).toEqual([...DOC_SECTION_IDS])
    expect(en.map((s) => s.id)).toEqual([...DOC_SECTION_IDS])
  })

  it('zh/en 每章结构同形:标题/摘要非空、块结构指纹一致', () => {
    for (let i = 0; i < DOC_SECTION_IDS.length; i++) {
      const a: DocSection = zh[i]!
      const b: DocSection = en[i]!
      expect(a.title.trim()).toBeTruthy()
      expect(b.title.trim()).toBeTruthy()
      expect(a.summary.trim()).toBeTruthy()
      expect(b.summary.trim()).toBeTruthy()
      expect(shapeOf(b.blocks)).toEqual(shapeOf(a.blocks))
      expect(a.blocks.length).toBeGreaterThan(0)
    }
  })

  it('代码块 zh/en 同构:语言一致、去注释后内容一致(注释允许本地化)', () => {
    const stripComments = (code: string) =>
      code.split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '$1').replace(/\/\*+.*\*+\/?$/, '').replace(/<!--.*-->$/, '').trimEnd())
        .filter((line) => line.trim() !== '')
        .join('\n')
    const codesOf = (sections: DocSection[]) =>
      sections.flatMap((s) => s.blocks.filter((b): b is Extract<DocBlock, { type: 'code' }> => b.type === 'code').map((b) => `${b.lang}::${stripComments(b.code)}`))
    expect(codesOf(en)).toEqual(codesOf(zh))
    expect(codesOf(zh).length).toBeGreaterThanOrEqual(8)
  })

  it('next 链成合法学习路径:quickstart → … → endpoints(终点 next=null)', () => {
    const ids = new Set<string>(DOC_SECTION_IDS)
    for (const s of zh) {
      if (s.next !== null) expect(ids.has(s.next)).toBe(true)
    }
    expect(zh.find((s) => s.id === 'quickstart')!.next).toBe('app-registration')
    expect(zh.find((s) => s.id === 'endpoints')!.next).toBeNull()
    expect(en.find((s) => s.id === 'endpoints')!.next).toBeNull()
  })

  it('无空文案:段落/列表项/表格单元格全非空', () => {
    for (const s of [...zh, ...en]) {
      for (const b of s.blocks) {
        if (b.type === 'p' || b.type === 'h' || b.type === 'callout') {
          expect(b.text.trim()).toBeTruthy()
        } else if (b.type === 'list') {
          for (const item of b.items) expect(item.trim()).toBeTruthy()
        } else if (b.type === 'table') {
          for (const h of b.head) expect(h.trim()).toBeTruthy()
          for (const row of b.rows) {
            expect(row).toHaveLength(b.head.length)
            for (const cell of row) expect(String(cell).trim()).toBeTruthy()
          }
        } else if (b.type === 'code') {
          expect(b.code.trim()).toBeTruthy()
        }
      }
    }
  })

  it('端点速查表覆盖关键路径(login/embed-token/ia-mcp/webhook/runs)', () => {
    const section = getDocSection('zh-CN', 'endpoints')!
    const table = section.blocks.find((b): b is Extract<DocBlock, { type: 'table' }> => b.type === 'table')!
    const paths = table.rows.map((r) => r[1]).join('\n')
    for (const p of ['/api/demo/login', '/api/ia/embed-token', '/ia-mcp', '/ia/webhook', '/ia/api/v1/runs']) {
      expect(paths).toContain(p)
    }
  })

  it('工具桥章节覆盖 @IaTool 注解属性表与配置键(灰度开关)', () => {
    const section = getDocSection('zh-CN', 'tool-bridge')!
    const tables = section.blocks.filter((b): b is Extract<DocBlock, { type: 'table' }> => b.type === 'table')
    const allText = JSON.stringify(tables)
    expect(allText).toContain('@IaTool.name')
    expect(allText).toContain('riskLevel')
    expect(allText).toContain('inneragent.bridge.enabled')
    expect(allText).toContain('act.audiences')
  })

  it('helper:getDocSection / getDocNeighbours / getDocStepIndex', () => {
    expect(getDocSection('zh-CN', 'nope')).toBeUndefined()
    expect(getDocSection('zh-CN', undefined)).toBeUndefined()
    expect(getDocSection('en-US', 'webhook')!.title).toBeTruthy()

    const { current, prev, next } = getDocNeighbours('zh-CN', 'embed-token')
    expect(current!.id).toBe('embed-token')
    expect(prev!.id).toBe('app-registration')
    expect(next!.id).toBe('frontend-embed')

    expect(getDocNeighbours('zh-CN', 'endpoints').next).toBeUndefined()
    expect(getDocStepIndex('zh-CN', 'quickstart')).toBe(1)
    expect(getDocStepIndex('zh-CN', 'nope')).toBe(0)
  })
})
