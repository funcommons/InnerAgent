/**
 * 文档中心数据模型(结构化 TS,内化自 docs/接入指南.md,不运行时读 markdown)。
 *
 * 每种语言一份 DocSection[](zh-CN.ts / en-US.ts),结构必须同形:
 * 章节顺序一致、块类型序列一致、表格维度一致——由 docs-content.test.ts 校验。
 */

/** 正文块:段落/小标题/代码/列表/表格/提示框 */
export type DocBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'callout'; tone: 'info' | 'warn'; text: string }

/** 文档章节(URL 段 /docs/<id>) */
export interface DocSection {
  id: string
  title: string
  /** 一句话摘要(章节卡/侧栏提示) */
  summary: string
  blocks: DocBlock[]
  /** 学习路径下一章 id;null = 终点(正文尾部改为体验台 CTA) */
  next: string | null
}

export type DocLocaleContent = DocSection[]

/** 全部章节 id(固定顺序 = 学习路径;内容文件必须与之对齐) */
export const DOC_SECTION_IDS = [
  'quickstart',
  'app-registration',
  'embed-token',
  'frontend-embed',
  'tool-bridge',
  'webhook',
  'security',
  'endpoints',
] as const

export type DocSectionId = (typeof DOC_SECTION_IDS)[number]
