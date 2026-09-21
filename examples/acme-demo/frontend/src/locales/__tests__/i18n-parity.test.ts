import { describe, it, expect } from 'vitest'
import zhCN from '@/locales/zh-CN'
import enUS from '@/locales/en-US'

/**
 * i18n zh/en 结构对齐:键树同形、叶子均为非空字符串。
 * 保证双语齐备,组件层不会因缺键渲染出 key 本身(官网对外页面尤其如此)。
 */
type MsgTree = Record<string, unknown>

function leafPaths(tree: MsgTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      return leafPaths(value as MsgTree, path)
    }
    return [path]
  })
}

function leafValues(tree: MsgTree): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node !== null && typeof node === 'object') {
      Object.values(node as MsgTree).forEach(walk)
    } else {
      out.push(String(node))
    }
  }
  walk(tree)
  return out
}

describe('locales(zh/en 双语齐备)', () => {
  const zhKeys = leafPaths(zhCN as MsgTree)
  const enKeys = leafPaths(enUS as MsgTree)

  it('键树完全同形(zh 独有/en 独有键均为空)', () => {
    const zhOnly = zhKeys.filter((k) => !enKeys.includes(k))
    const enOnly = enKeys.filter((k) => !zhKeys.includes(k))
    expect(zhOnly).toEqual([])
    expect(enOnly).toEqual([])
  })

  it('所有叶子都是非空字符串文案', () => {
    for (const v of leafValues(zhCN as MsgTree)) {
      expect(typeof v).toBe('string')
      expect((v as string).trim().length).toBeGreaterThan(0)
    }
    for (const v of leafValues(enUS as MsgTree)) {
      expect(typeof v).toBe('string')
      expect((v as string).trim().length).toBeGreaterThan(0)
    }
  })

  it('官网公开区命名空间(site/home/docs/playground/seo)存在且规模可观', () => {
    for (const ns of ['site', 'home', 'docs', 'playground', 'seo']) {
      expect(zhKeys.some((k) => k.startsWith(`${ns}.`))).toBe(true)
      expect(enKeys.some((k) => k.startsWith(`${ns}.`))).toBe(true)
    }
    // 官网能力卡与文档章节在两个语言下均有对应文案
    expect(zhKeys.filter((k) => k.startsWith('home.features.items.')).length).toBeGreaterThanOrEqual(16)
    expect(zhKeys.filter((k) => k.startsWith('playground.')).length).toBeGreaterThanOrEqual(20)
  })

  it('控制台既有命名空间未被破坏(ia/router/auth 仍在)', () => {
    for (const ns of ['ia', 'router', 'auth', 'common', 'ux']) {
      expect(zhKeys.some((k) => k.startsWith(`${ns}.`))).toBe(true)
      expect(enKeys.some((k) => k.startsWith(`${ns}.`))).toBe(true)
    }
  })
})
