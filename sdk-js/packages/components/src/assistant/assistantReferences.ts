/**
 * [adapt] 助手 @ 引用选择器纯逻辑 — 源: $SRC/src/components/assistant/assistantReferences.ts。
 * 触发解析/模糊打分/过滤截断/实体候选逻辑 1:1; 适配:
 * - import 重锚到 @inneragent/sdk-core
 * - 拆除业务依赖: 融光 projectApi (/api/project/list) → 注入式项目提供方
 *   (setAssistantReferenceProjectsProvider; 默认从页面上下文 project 引用派生),
 *   对齐 02-技术方案 §8.2「reference-picker 的项目/剧本引用改为通用上下文引用」
 */
import {
  getAssistantReferenceOptions,
  type AssistantMcpToolReferenceOption,
  type AssistantReferenceOptions,
  type AssistantSkillReferenceOption,
  type AssistantPageContextRef,
  type AssistantMessageProjectReference,
  getAssistantPageContext,
} from '@inneragent/sdk-core'

/** 项目引用 (旧 reference-types.ts AssistantProjectReference) */
export interface AssistantProjectReference {
  id: number
  name: string
  description?: string
}

export type AssistantReferencePickerMode = 'project' | 'capability'

/** 触发区间: 文本 [start, end) 为可替换的触发词 */
export interface AssistantReferenceTrigger {
  mode: AssistantReferencePickerMode
  query: string
  start: number
  end: number
}

export type AssistantCapabilityReference =
  | { kind: 'skill'; value: AssistantSkillReferenceOption }
  | { kind: 'mcp'; value: AssistantMcpToolReferenceOption }

/** 页面实体候选 (新前端扩展: 项目页上下文的剧本/分镜/资产) */
export interface AssistantEntityPickerItem {
  kind: 'entity'
  type: string
  id: number
  /** 实体名称 (页面注册回填; 无名时展示/匹配回退 type/id) */
  name?: string
  /** 所属项目 (页面上下文缺 project 引用时为 null) */
  projectId: number | null
}

export type AssistantReferencePickerItem =
  | AssistantCapabilityReference
  | AssistantEntityPickerItem
  | { kind: 'project'; value: AssistantProjectReference }

/** 触发词解析 (旧 detectReferenceTrigger 1:1): 光标前缀尾部 `(^|\s)([/@])([^\s/@]*)$` */
export function detectReferenceTrigger(value: string, cursor: number): AssistantReferenceTrigger | null {
  const prefix = value.slice(0, cursor)
  const match = prefix.match(/(^|\s)([/@])([^\s/@]*)$/u)
  if (!match || match.index === undefined) return null
  const leadingLength = match[1]?.length ?? 0
  return {
    mode: match[2] === '@' ? 'project' : 'capability',
    query: match[3] ?? '',
    start: match.index + leadingLength,
    end: cursor,
  }
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** 模糊打分 (旧 fuzzyScore 1:1): 子串直配返回下标, 子序列返回 100+距离, 不匹配 Infinity */
export function fuzzyScore(candidate: string, query: string): number {
  if (!query) return 0
  const normalizedCandidate = normalizeSearch(candidate)
  const normalizedQuery = normalizeSearch(query)
  const direct = normalizedCandidate.indexOf(normalizedQuery)
  if (direct >= 0) return direct
  let queryIndex = 0
  let distance = 0
  for (let index = 0; index < normalizedCandidate.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedCandidate[index] === normalizedQuery[queryIndex]) {
      distance += index
      queryIndex += 1
    }
  }
  return queryIndex === normalizedQuery.length ? 100 + distance : Number.POSITIVE_INFINITY
}

/** 通用候选过滤: 打分 → 过滤 Infinity → 升序 → 截断 (旧 pickerItems useMemo 语义) */
export function filterPickerItems<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string,
  limit = 12,
): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(textOf(item), query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((entry) => entry.item)
}

/** 能力候选搜索文本 (旧 capabilitySearchText 1:1) */
export function capabilitySearchText(item: AssistantCapabilityReference): string {
  if (item.kind === 'skill') {
    return `${item.value.displayName} ${item.value.name} ${item.value.id} ${item.value.source} ${item.value.description}`
  }
  return `${item.value.toolName} ${item.value.serverName} ${item.value.description}`
}

/** 选中态键 (旧 itemKey 语义; 实体新增) */
export function referenceItemKey(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') return `project:${item.value.id}`
  if (item.kind === 'skill') return `skill:${item.value.id}`
  if (item.kind === 'mcp') return `mcp:${item.value.serverName}:${item.value.toolName}`
  return `entity:${item.type}:${item.id}`
}

/** 项目引用构造 (旧 inheritedProject: 列表命中取名/描述, 未命中用兜底名 `项目 #id`) */
export function buildProjectReference(
  id: number | null | undefined,
  projects: Array<Pick<AssistantProjectReference, 'id' | 'name'> & { description?: string | null }>,
  fallbackName: string,
): AssistantProjectReference | null {
  if (!id) return null
  const project = projects.find((item) => item.id === id)
  return {
    id,
    name: project?.name || fallbackName,
    description: project?.description ?? undefined,
  }
}

/** 页面上下文引用 → @ 实体候选 (project 引用除外; projectId 取上下文中的 project id; 名称随注册回填) */
export function buildEntityItems(refs: AssistantPageContextRef[]): AssistantEntityPickerItem[] {
  const projectId = refs.find((ref) => ref.type === 'project')?.id ?? null
  return refs
    .filter((ref) => ref.type !== 'project')
    .map((ref) => ({
      kind: 'entity' as const,
      type: ref.type,
      id: ref.id,
      name: ref.name,
      projectId,
    }))
}

/** 实体候选搜索文本 (名称优先 + 类型/ID/所属项目回退; 对齐旧前端"输入名称或 ID 模糊查找") */
export function entitySearchText(item: AssistantEntityPickerItem): string {
  return [
    item.name,
    item.type,
    String(item.id),
    item.projectId != null ? String(item.projectId) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// ============ 引用候选加载 (旧 use-assistant-references 30s 缓存 + 单飞) ============

const REFERENCES_CACHE_TTL_MS = 30_000
let cachedReferenceOptions: AssistantReferenceOptions | null = null
let cachedReferenceOptionsAt = 0
let referenceOptionsRequest: Promise<AssistantReferenceOptions> | null = null
let cachedProjects: AssistantMessageProjectReference[] | null = null
let cachedProjectsAt = 0
let projectsRequest: Promise<AssistantMessageProjectReference[]> | null = null

/**
 * [adapt] 项目候选提供方 (替代融光 projectApi.list 业务依赖):
 * SDK 无融光项目域; 宿主可注入自己的项目列表提供方 (返回 id/name/description),
 * 默认从页面上下文注册的 type==='project' 引用派生 (无名时回退 `项目 #id`)。
 */
let projectsProvider: (() => Promise<AssistantMessageProjectReference[]>) | null = null

export function setAssistantReferenceProjectsProvider(
  provider?: (() => Promise<AssistantMessageProjectReference[]>) | null,
): void {
  projectsProvider = provider ?? null
}

async function defaultLoadReferenceProjects(): Promise<AssistantMessageProjectReference[]> {
  return getAssistantPageContext()
    .filter((ref) => ref.type === 'project')
    .map((ref) => ({ id: ref.id, name: ref.name ?? `项目 #${ref.id}` }))
}

/** 测试隔离用: 清空模块级引用候选缓存 */
export function resetAssistantReferenceCaches(): void {
  cachedReferenceOptions = null
  cachedReferenceOptionsAt = 0
  referenceOptionsRequest = null
}

/** 助手可引用 Skill/MCP (GET /api/ai/assistant/reference-options; 30s 缓存 + 单飞) */
export function loadAssistantReferenceOptions(): Promise<AssistantReferenceOptions> {
  if (cachedReferenceOptions && Date.now() - cachedReferenceOptionsAt < REFERENCES_CACHE_TTL_MS) {
    return Promise.resolve(cachedReferenceOptions)
  }
  if (!referenceOptionsRequest) {
    referenceOptionsRequest = getAssistantReferenceOptions()
      .then((result) => {
        cachedReferenceOptions = result
        cachedReferenceOptionsAt = Date.now()
        referenceOptionsRequest = null
        return result
      })
      .catch((error: unknown) => {
        referenceOptionsRequest = null
        throw error
      })
  }
  return referenceOptionsRequest
}

/** 项目候选 (30s 缓存 + 单飞; 融光 projectApi.list → 注入式 provider, 见文件头 [adapt]) */
export function loadAssistantReferenceProjects(): Promise<AssistantMessageProjectReference[]> {
  const provider = projectsProvider ?? defaultLoadReferenceProjects
  if (cachedProjects && Date.now() - cachedProjectsAt < REFERENCES_CACHE_TTL_MS) {
    return Promise.resolve(cachedProjects)
  }
  if (!projectsRequest) {
    projectsRequest = provider()
      .then((result) => {
        cachedProjects = result
        cachedProjectsAt = Date.now()
        projectsRequest = null
        return result
      })
      .catch((error: unknown) => {
        projectsRequest = null
        throw error
      })
  }
  return projectsRequest
}
