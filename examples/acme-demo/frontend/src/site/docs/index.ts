/**
 * 文档中心数据入口:按 preference locale 提供 zh/en 章节内容与查找/邻居工具。
 */
import type { Locale } from '@/store/preference'
import type { DocSection, DocSectionId } from './types'
import { DOC_SECTION_IDS } from './types'
import zhCN from './zh-CN'
import enUS from './en-US'

export * from './types'
export { DOC_SECTION_IDS }

const CONTENT: Record<Locale, DocSection[]> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

/** 当前语言的全部章节(固定学习路径顺序) */
export function getDocSections(locale: Locale): DocSection[] {
  return CONTENT[locale] ?? zhCN
}

/** 按 id 查章节;未知 id 返回 undefined(路由层落到文档首页) */
export function getDocSection(locale: Locale, id: string | undefined | null): DocSection | undefined {
  if (!id) return undefined
  return getDocSections(locale).find((s) => s.id === id)
}

/** 章节邻居(上一篇/下一篇;终点章 prev 取倒数第二) */
export function getDocNeighbours(locale: Locale, id: string | undefined | null): {
  current: DocSection | undefined
  prev: DocSection | undefined
  next: DocSection | undefined
} {
  const sections = getDocSections(locale)
  const index = sections.findIndex((s) => s.id === id)
  if (index < 0) return { current: undefined, prev: undefined, next: undefined }
  return {
    current: sections[index],
    prev: index > 0 ? sections[index - 1] : undefined,
    next: index >= 0 && index < sections.length - 1 ? sections[index + 1] : undefined,
  }
}

/** 学习路径中的位置(1 起);未知 id 返回 0 */
export function getDocStepIndex(locale: Locale, id: string | undefined | null): number {
  return getDocSections(locale).findIndex((s) => s.id === id) + 1
}

/** 章节路由路径 */
export function docPath(id: DocSectionId | string): string {
  return `/docs/${id}`
}
