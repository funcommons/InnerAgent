/**
 * [port] 助手 @ 引用选择器纯逻辑测试 — 源: $SRC/components/assistant/__tests__/assistantReferences.test.ts
 * (断言 1:1; 页面上下文类型改由 core 提供)。 (队列 #34-1/#34-5).
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/use-assistant-references.ts:
 * - detectReferenceTrigger: `@` → 项目/页面实体, `/` → Skill/MCP 能力
 * - fuzzyScore / filterPickerItems: 子串直配优先, 模糊子序列次之, 截断 12 条
 * - referenceItemKey / buildProjectReference / buildEntityItems
 */
import { describe, it, expect } from 'vitest'
import {
  detectReferenceTrigger,
  fuzzyScore,
  filterPickerItems,
  capabilitySearchText,
  entitySearchText,
  referenceItemKey,
  buildProjectReference,
  buildEntityItems,
  type AssistantCapabilityReference,
  type AssistantEntityPickerItem,
  type AssistantProjectReference,
} from '../assistant/assistantReferences'
import type { AssistantPageContextRef } from '@inneragent/sdk-core'

describe('detectReferenceTrigger (触发解析)', () => {
  it('@ 开头 → project 模式, 区间 [0, cursor)', () => {
    expect(detectReferenceTrigger('@', 1)).toEqual({ mode: 'project', query: '', start: 0, end: 1 })
    expect(detectReferenceTrigger('@pro', 4)).toEqual({ mode: 'project', query: 'pro', start: 0, end: 4 })
  })

  it('空格后 @ → project 模式; 空格后 / → capability 模式', () => {
    expect(detectReferenceTrigger('帮我 @星球', 6)).toEqual({ mode: 'project', query: '星球', start: 3, end: 6 })
    expect(detectReferenceTrigger('用 /mcp', 6)).toEqual({ mode: 'capability', query: 'mcp', start: 2, end: 6 })
  })

  it('非开头非空白的 @ (如邮箱) 不触发', () => {
    expect(detectReferenceTrigger('mail@example', 12)).toBeNull()
  })

  it('触发词后有空格 / 含空白字符的 query 不触发', () => {
    expect(detectReferenceTrigger('@done ', 6)).toBeNull()
    expect(detectReferenceTrigger('@a b', 4)).toBeNull()
  })

  it('query 内不允许第二个触发符 (/@)', () => {
    expect(detectReferenceTrigger('@a/b', 4)).toBeNull()
  })

  it('cursor 截断: 只看光标前缀', () => {
    expect(detectReferenceTrigger('@abc def', 2)).toEqual({ mode: 'project', query: 'a', start: 0, end: 2 })
  })
})

describe('fuzzyScore (模糊匹配打分)', () => {
  it('空 query 得 0 分 (全部候选保留)', () => {
    expect(fuzzyScore('任意', '')).toBe(0)
  })

  it('子串直配: 返回命中下标, 越靠前越优', () => {
    expect(fuzzyScore('星球大战', '星球')).toBe(0)
    expect(fuzzyScore('我的星球', '星球')).toBe(2)
  })

  it('非连续子序列: 100 + 累计距离', () => {
    expect(fuzzyScore('scta', 'sta')).toBe(100 + 5)
  })

  it('不匹配 → Infinity (过滤)', () => {
    expect(fuzzyScore('abc', 'xyz')).toBe(Number.POSITIVE_INFINITY)
  })

  it('大小写不敏感 (toLocaleLowerCase)', () => {
    expect(fuzzyScore('MySB', 'sb')).toBe(2)
  })
})

describe('filterPickerItems (候选过滤/排序/截断)', () => {
  const items = [
    { id: 1, text: 'z星球' },
    { id: 2, text: '星球' },
    { id: 3, text: 'abc' },
  ]

  it('空 query 保留全部 (得分 0, 原序)', () => {
    expect(filterPickerItems(items, '', (item) => item.text)).toEqual(items)
  })

  it('按得分升序, Infinity 过滤', () => {
    expect(filterPickerItems(items, '星球', (item) => item.text).map((item) => item.id)).toEqual([2, 1])
    expect(filterPickerItems(items, '星球', (item) => item.text)).toHaveLength(2)
  })

  it('limit 截断 (旧上限 12)', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: index, text: `项目${index}` }))
    expect(filterPickerItems(many, '', (item) => item.text)).toHaveLength(12)
    expect(filterPickerItems(many, '', (item) => item.text, 5)).toHaveLength(5)
  })
})

describe('capabilitySearchText (能力搜索文本)', () => {
  const skill = {
    kind: 'skill' as const,
    value: { id: 's1', name: 'video_gen', displayName: '视频生成', description: '生成短视频', source: 'builtin' },
  }
  const mcp = {
    kind: 'mcp' as const,
    value: { serverName: 'media', toolName: 'render', description: '渲染工具', readOnly: true },
  }

  it('skill: 展示名/名称/ID/来源/描述拼接', () => {
    expect(capabilitySearchText(skill)).toBe('视频生成 video_gen s1 builtin 生成短视频')
  })

  it('mcp: 工具名/服务名/描述拼接', () => {
    expect(capabilitySearchText(mcp)).toBe('render media 渲染工具')
  })

  it('mcp 与 skill 同属能力候选类型', () => {
    const items: AssistantCapabilityReference[] = [skill, mcp]
    expect(items.every((item) => item.kind === 'skill' || item.kind === 'mcp')).toBe(true)
  })
})

describe('referenceItemKey (选中态键)', () => {
  it('project/skill/mcp/entity 四类键', () => {
    const project: AssistantProjectReference = { id: 3, name: 'P' }
    expect(referenceItemKey({ kind: 'project', value: project })).toBe('project:3')
    expect(referenceItemKey({
      kind: 'skill',
      value: { id: 's1', name: 'n', displayName: 'd', description: '', source: '' },
    })).toBe('skill:s1')
    expect(referenceItemKey({
      kind: 'mcp',
      value: { serverName: 'media', toolName: 'render', description: '', readOnly: false },
    })).toBe('mcp:media:render')
    const entity: AssistantEntityPickerItem = { kind: 'entity', type: 'script', id: 9, projectId: 3 }
    expect(referenceItemKey(entity)).toBe('entity:script:9')
  })
})

describe('buildProjectReference (项目引用; 旧 inheritedProject 语义)', () => {
  const projects = [{ id: 3, name: '测试项目', description: '描述' }]

  it('列表命中: 取 name/description', () => {
    expect(buildProjectReference(3, projects, '项目 #3')).toEqual({ id: 3, name: '测试项目', description: '描述' })
  })

  it('列表未命中: 用兜底名 (旧 `项目 #id`)', () => {
    expect(buildProjectReference(9, projects, '项目 #9')).toEqual({ id: 9, name: '项目 #9' })
    expect(buildProjectReference(9, [], '项目 #9')).toEqual({ id: 9, name: '项目 #9' })
  })

  it('id 为空 → null', () => {
    expect(buildProjectReference(null, projects, 'x')).toBeNull()
  })
})

describe('buildEntityItems (页面上下文 → @ 实体候选)', () => {
  it('project 引用不进实体候选; 其余 type 带 projectId', () => {
    const refs: AssistantPageContextRef[] = [
      { type: 'project', id: 7 },
      { type: 'script', id: 3 },
      { type: 'storyboardEpisode', id: 12 },
    ]
    expect(buildEntityItems(refs)).toEqual([
      { kind: 'entity', type: 'script', id: 3, projectId: 7 },
      { kind: 'entity', type: 'storyboardEpisode', id: 12, projectId: 7 },
    ])
  })

  it('无 project 引用时实体仍列出, projectId 为 null (不可确权项目上下文)', () => {
    expect(buildEntityItems([{ type: 'asset', id: 5 }])).toEqual([
      { kind: 'entity', type: 'asset', id: 5, projectId: null },
    ])
    expect(buildEntityItems([])).toEqual([])
  })

  it('实体携带注册名称 (队列 #41: 名称优先展示/匹配); 未命名实体缺省 name', () => {
    const refs: AssistantPageContextRef[] = [
      { type: 'project', id: 7 },
      { type: 'script', id: 3, name: '测试剧本' },
      { type: 'storyboardEpisode', id: 12 },
    ]
    expect(buildEntityItems(refs)).toEqual([
      { kind: 'entity', type: 'script', id: 3, name: '测试剧本', projectId: 7 },
      { kind: 'entity', type: 'storyboardEpisode', id: 12, projectId: 7 },
    ])
  })
})

describe('entitySearchText (实体搜索文本: 名称优先, type/id 回退)', () => {
  it('命名实体: 名称置前 (名称包含关键字 → 直配下标最优)', () => {
    expect(entitySearchText({ kind: 'entity', type: 'script', id: 3, name: '第一集', projectId: 7 }))
      .toBe('第一集 script 3 7')
  })

  it('未命名实体: 回退 type/id/projectId 拼接', () => {
    expect(entitySearchText({ kind: 'entity', type: 'asset', id: 5, projectId: null })).toBe('asset 5')
    expect(entitySearchText({ kind: 'entity', type: 'asset', id: 5, projectId: 7 })).toBe('asset 5 7')
  })

  it('名称包含关键字命中候选; 未命名实体仍可按 type 关键字回退命中', () => {
    const items: AssistantEntityPickerItem[] = [
      { kind: 'entity', type: 'script', id: 3, name: '第一集', projectId: 7 },
      { kind: 'entity', type: 'asset', id: 5, projectId: 7 },
    ]
    expect(filterPickerItems(items, '第一', entitySearchText)).toEqual([items[0]])
    expect(filterPickerItems(items, 'asset', entitySearchText)).toEqual([items[1]])
  })
})
