<script setup lang="ts">
/**
 * [adapt] AssistantComposer — 源: $SRC/src/components/assistant/AssistantComposer.vue。
 * 输入区 (模型选择/引用选择器/附件/发送/停止) 1:1; 适配:
 * - vue-i18n → 内置 i18n; FcButton/FcSelect/FcTag → IaButton/IaSelect/IaTag;
 *   el-input → 原生 textarea (Shadow DOM 安全, element-plus 全部拆除)
 * - 拆除业务依赖: vue-router + useUserStore (模型设置入口)、Project 类型
 *   (→ 注入式 AssistantMessageProjectReference)
 */
defineOptions({ name: 'AssistantComposer' })
/**
 * AssistantComposer — 助手输入区.
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/composer.tsx
 * (队列 #34 补齐 @ 引用选择器 + 附件上传 + Skill/MCP 开关):
 * - 模型选择 (listByType(1) + 30s 单飞缓存; 默认模型优先) + reasoning 力度 (旧首档自动选中)
 * - 工具执行模式 (setToolExecutionMode)
 * - @ 引用项目/页面实体, / 引用 Skill/MCP (assistantReferences.ts 纯逻辑;
 *   实体来自 assistantPageContext 注册, 选择实体 = 确权所属项目上下文)
 * - 附件上传 (assistantMultimodal.ts → POST /api/storage/assistant-upload),
 *   提交走 sendMessage(references.multimodalInputs)
 * - 项目覆盖选择后跨项目发送 → setDraft(null) + startNewConversation (旧 submit 语义)
 * - Enter 换行 / Ctrl+Enter 发送 (IME composing 保护); 运行中 → 停止/取消中
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import {
  aiModelApi,
  useAssistantStore,
  getAssistantPageContext,
  statusIsRunning,
  type AiModel,
  type AssistantMcpToolReferenceOption,
  type AssistantReferenceOptions,
  type AssistantSkillReferenceOption,
  type AssistantMessageProjectReference,
  type ToolExecutionMode,
} from '@inneragent/sdk-core'
import IaButton from '../ui/IaButton.vue'
import IaSelect from '../ui/IaSelect.vue'
import IaTag from '../ui/IaTag.vue'
import AssistantAttachmentChip from './AssistantAttachmentChip.vue'
import type { SelectOption } from '../ui/IaSelect.vue'
import {
  detectReferenceTrigger,
  filterPickerItems,
  capabilitySearchText,
  entitySearchText,
  referenceItemKey,
  buildProjectReference,
  buildEntityItems,
  loadAssistantReferenceOptions,
  loadAssistantReferenceProjects,
  type AssistantCapabilityReference,
  type AssistantProjectReference,
  type AssistantReferencePickerItem,
  type AssistantReferenceTrigger,
} from './assistantReferences'
import {
  prepareAssistantAttachments,
  attachmentCompatibilityError,
  attachmentAccept,
  multimodalCapabilitySummary,
  AssistantAttachmentError,
  type AssistantAttachment,
  type AssistantLocalizedMessage,
} from './assistantMultimodal'

const props = defineProps<{ projectId?: number | null }>()

// [adapt] 拆除业务依赖: 模型设置入口 (vue-router → /admin/models + user store
// admin 门控) 属融光管理端, SDK 不携带; 管理面由 inneragent-web 承担。

const { t } = useI18n()
const store = useAssistantStore()

// ---- 模型 (旧 loadAssistantModels 30s 缓存语义) ----
const ASSISTANT_MODELS_CACHE_TTL_MS = 30_000
let cachedModels: AiModel[] | null = null
let cachedAt = 0
let modelsRequest: Promise<AiModel[]> | null = null

function loadAssistantModels(): Promise<AiModel[]> {
  if (cachedModels && Date.now() - cachedAt < ASSISTANT_MODELS_CACHE_TTL_MS) {
    return Promise.resolve(cachedModels)
  }
  if (!modelsRequest) {
    modelsRequest = aiModelApi.listByType(1)
      .then((result) => {
        cachedModels = result
        cachedAt = Date.now()
        modelsRequest = null
        return result
      })
      .catch((error: unknown) => {
        modelsRequest = null
        throw error
      })
  }
  return modelsRequest
}

// ---- 引用候选 (旧 loadReferenceOptions/loadProjects 30s 缓存 + 单飞; 实现在 assistantReferences.ts) ----

const models = ref<AiModel[]>([])
const modelsLoading = ref(true)
const modelsError = ref<string | null>(null)

async function beginLoadModels(): Promise<void> {
  modelsLoading.value = true
  modelsError.value = null
  try {
    const result = await loadAssistantModels()
    models.value = result
    const currentSelectedModelId = store.selectedModelId
    const preferred = currentSelectedModelId && result.some((model) => model.id === currentSelectedModelId)
      ? currentSelectedModelId
      : result.find((model) => model.defaultModel)?.id ?? result[0]?.id ?? null
    if (preferred !== currentSelectedModelId) store.setSelectedModelId(preferred)
  } catch (error: unknown) {
    modelsError.value = error instanceof Error ? error.message : t('assistant.model-load-failed')
  } finally {
    modelsLoading.value = false
  }
}

// ---- 输入 / 发送 ----
const selectedConversationId = computed(() => store.selectedConversationId)
const runtime = computed(() => selectedConversationId.value
  ? store.conversationStates[selectedConversationId.value]
  : undefined)
const text = computed({
  get: () => selectedConversationId.value
    ? runtime.value?.draft ?? ''
    : store.newDraft,
  set: (value: string) => store.setDraft(selectedConversationId.value, value),
})

const running = computed(() => !!runtime.value && statusIsRunning(runtime.value.status))
const cancelling = computed(() => runtime.value?.status === 'CANCEL_REQUESTED')
const currentConnection = computed(() =>
  store.connection?.conversationId === selectedConversationId.value)
const runtimeMessagesError = computed(() => runtime.value?.messagesError)

const selectedModel = computed(() =>
  models.value.find((model) => model.id === store.selectedModelId) ?? null)

const reasoningEffort = ref<string | null>(null)
const effortOptions = computed<SelectOption[]>(() =>
  (selectedModel.value?.supportReasoning
    ? selectedModel.value?.reasoningEffortLevels ?? []
    : []
  ).map((level) => ({ label: level, value: level })))

// 旧 composer: 模型变化时 reasoning 力度自动选首档 (或清空)
watch(() => [
  selectedModel.value?.id,
  selectedModel.value?.supportReasoning,
  selectedModel.value?.reasoningEffortLevels,
] as const, () => {
  const model = selectedModel.value
  reasoningEffort.value = model?.supportReasoning
    ? model.reasoningEffortLevels?.[0] ?? null
    : null
}, { immediate: true })

const toolModeOptions = computed<SelectOption<ToolExecutionMode>[]>(() =>
  (['DEFAULT', 'ALWAYS_ASK', 'ALWAYS_ALLOW', 'FULL_ACCESS'] as const).map((mode) => ({
    label: t(`assistant.tool-mode-${mode}`),
    value: mode,
  })))

// ---- 引用选择 (旧 use-assistant-references 会话内选中态) ----
const referenceOptions = ref<AssistantReferenceOptions>({ skills: [], mcpTools: [] })
const selectedSkills = ref<AssistantSkillReferenceOption[]>([])
const selectedMcpTools = ref<AssistantMcpToolReferenceOption[]>([])
const projects = ref<AssistantMessageProjectReference[]>([])
const capabilitiesLoading = ref(true)
const projectsLoading = ref(true)
const capabilitiesError = ref<string | null>(null)
const projectsError = ref<string | null>(null)
/** undefined = 继承页面/会话项目; null = 显式移除 */
const projectOverride = ref<AssistantProjectReference | null | undefined>(undefined)
const picker = ref<AssistantReferenceTrigger | null>(null)
const activeIndex = ref(0)

const conversationProjectId = computed(() => runtime.value?.conversation.projectId ?? null)
const effectiveProjectId = computed<number | null>(() =>
  selectedConversationId.value ? conversationProjectId.value : props.projectId ?? null)

const inheritedProject = computed<AssistantProjectReference | null>(() =>
  buildProjectReference(
    effectiveProjectId.value,
    projects.value,
    t('assistant.reference-project-fallback', { id: effectiveProjectId.value ?? 0 }),
  ))
const selectedProject = computed<AssistantProjectReference | null>(() =>
  projectOverride.value === undefined ? inheritedProject.value : projectOverride.value)

const capabilityItems = computed<AssistantCapabilityReference[]>(() => [
  ...referenceOptions.value.skills.map((value) => ({ kind: 'skill' as const, value })),
  ...referenceOptions.value.mcpTools.map((value) => ({ kind: 'mcp' as const, value })),
])

const projectPickerCandidates = computed<AssistantReferencePickerItem[]>(() => [
  ...buildEntityItems(getAssistantPageContext()),
  ...projects.value.map((project) => ({
    kind: 'project' as const,
    value: { id: project.id, name: project.name, description: project.description ?? undefined },
  })),
])

function pickerSearchText(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') {
    return `${item.value.name} ${item.value.id} ${item.value.description || ''}`
  }
  if (item.kind === 'entity') return entitySearchText(item)
  return capabilitySearchText(item)
}

const pickerItems = computed<AssistantReferencePickerItem[]>(() => {
  if (!picker.value) return []
  const candidates = picker.value.mode === 'project'
    ? projectPickerCandidates.value
    : capabilityItems.value
  return filterPickerItems(candidates, picker.value.query, pickerSearchText)
})

const selectedKeys = computed(() => new Set([
  ...(selectedProject.value ? [`project:${selectedProject.value.id}`] : []),
  ...selectedSkills.value.map((skill) => `skill:${skill.id}`),
  ...selectedMcpTools.value.map((tool) => `mcp:${tool.serverName}:${tool.toolName}`),
]))

const pickerTitle = computed(() => picker.value?.mode === 'project'
  ? t('assistant.reference-project-title')
  : t('assistant.reference-capability-title'))
const pickerHint = computed(() => picker.value?.query
  ? t('assistant.reference-searching', { query: picker.value.query })
  : picker.value?.mode === 'project'
    ? t('assistant.reference-project-hint')
    : t('assistant.reference-capability-hint'))
const pickerLoading = computed(() => picker.value?.mode === 'project'
  ? projectsLoading.value
  : capabilitiesLoading.value)
const pickerError = computed(() => picker.value?.mode === 'project'
  ? projectsError.value
  : capabilitiesError.value)
const pickerEmptyText = computed(() => picker.value?.mode === 'project'
  ? t('assistant.reference-empty-project')
  : t('assistant.reference-empty-capability'))

const ENTITY_TYPE_LABEL_KEYS: Record<string, string> = {
  project: 'assistant.entity-project',
  script: 'assistant.entity-script',
  storyboard: 'assistant.entity-storyboard',
  storyboardEpisode: 'assistant.entity-storyboardEpisode',
  storyboardItem: 'assistant.entity-storyboardItem',
  asset: 'assistant.entity-asset',
}

function entityTypeLabel(type: string): string {
  const key = ENTITY_TYPE_LABEL_KEYS[type]
  return key ? t(key) : type
}

function itemEyebrow(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') return t('assistant.reference-project-eyebrow', { id: item.value.id })
  if (item.kind === 'skill') return t('assistant.reference-skill-eyebrow', { name: item.value.name })
  if (item.kind === 'mcp') return t('assistant.reference-mcp-eyebrow', { server: item.value.serverName })
  return `${entityTypeLabel(item.type)} #${item.id}`
}

function itemLabel(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') return item.value.name
  if (item.kind === 'skill') return item.value.displayName
  if (item.kind === 'mcp') return item.value.toolName
  // 实体: 注册名称优先 (队列 #41, 对齐旧前端候选"名称 + 类型标签"); 无名回退类型文案
  return item.name || entityTypeLabel(item.type)
}

function itemDescription(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') return item.value.description || t('assistant.reference-entity-context')
  if (item.kind === 'skill') return item.value.description
  if (item.kind === 'mcp') return item.value.description || t('assistant.reference-mcp-default-desc')
  return t('assistant.reference-attach-project')
}

function itemIcon(item: AssistantReferencePickerItem): string {
  if (item.kind === 'project') return 'ri-folder-kanban-line'
  if (item.kind === 'skill') return 'ri-sparkling-2-line'
  if (item.kind === 'mcp') return 'ri-flashlight-line'
  if (item.type === 'script') return 'ri-file-text-line'
  if (item.type === 'asset') return 'ri-image-2-line'
  return 'ri-movie-2-line'
}

function itemKey(item: AssistantReferencePickerItem): string {
  return referenceItemKey(item)
}

function itemSelected(item: AssistantReferencePickerItem): boolean {
  if (item.kind === 'entity') {
    return item.projectId != null && selectedProject.value?.id === item.projectId
  }
  return selectedKeys.value.has(referenceItemKey(item))
}

function updateText(value: string): void {
  store.setDraft(selectedConversationId.value, value)
}

function updateTextWithTrigger(value: string, cursor: number): void {
  updateText(value)
  const nextPicker = detectReferenceTrigger(value, cursor)
  const keepIndex = picker.value?.mode === nextPicker?.mode
    && picker.value?.query === nextPicker?.query
  picker.value = nextPicker
  if (!keepIndex) activeIndex.value = 0
}

function closePicker(): void {
  if (picker.value) picker.value = null
}

function replaceTrigger(): void {
  const current = picker.value
  if (!current) return
  const next = text.value.slice(0, current.start) + text.value.slice(current.end)
  updateText(next)
  const cursor = current.start
  picker.value = null
  void nextTick(() => {
    const element = textareaElement()
    element?.focus({ preventScroll: true })
    element?.setSelectionRange(cursor, cursor)
  })
}

function selectProject(project: AssistantProjectReference | null): void {
  projectOverride.value = project
}

function selectPickerItem(item: AssistantReferencePickerItem): void {
  if (item.kind === 'project') {
    selectProject(item.value)
  } else if (item.kind === 'entity') {
    // 实体选择 = 确权其所属项目上下文; 实体本身经页面注册注入 autoReferences
    if (item.projectId == null) return
    selectProject(buildProjectReference(
      item.projectId,
      projects.value,
      t('assistant.reference-project-fallback', { id: item.projectId }),
    ))
  } else if (item.kind === 'skill') {
    if (!selectedSkills.value.some((skill) => skill.id === item.value.id)) {
      selectedSkills.value = [...selectedSkills.value, item.value]
    }
  } else if (!selectedMcpTools.value.some((tool) =>
    tool.serverName === item.value.serverName && tool.toolName === item.value.toolName)) {
    selectedMcpTools.value = [...selectedMcpTools.value, item.value]
  }
  replaceTrigger()
}

function setActiveIndex(index: number): void {
  activeIndex.value = index
}

function handlePickerKeyDown(event: KeyboardEvent): boolean {
  if (!picker.value) return false
  if (event.key === 'Escape') {
    event.preventDefault()
    closePicker()
    return true
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!pickerItems.value.length) return true
    const total = pickerItems.value.length
    activeIndex.value = event.key === 'ArrowDown'
      ? (activeIndex.value + 1) % total
      : (activeIndex.value - 1 + total) % total
    return true
  }
  const active = pickerItems.value[activeIndex.value]
  if ((event.key === 'Enter' || event.key === 'Tab') && active) {
    event.preventDefault()
    selectPickerItem(active)
    return true
  }
  return false
}

// ---- 附件 (旧 use-assistant-attachments: 会话切换清空 + 处理中互斥) ----
const attachments = ref<AssistantAttachment[]>([])
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
let preparingAttachments = false
let attachmentsScope = 0

watch(selectedConversationId, () => {
  attachmentsScope += 1
  attachments.value = []
  projectOverride.value = undefined
  selectedSkills.value = []
  selectedMcpTools.value = []
  picker.value = null
  activeIndex.value = 0
})

const canAddAttachments = computed(() => !!selectedModel.value?.multimodalInputTypes?.length)
const attachmentInputAccept = computed(() => attachmentAccept(selectedModel.value))
const capabilitySummary = computed(() => {
  const summary = multimodalCapabilitySummary(selectedModel.value)
  if (summary.textOnly) return t('assistant.attachment-text-only')
  const capabilities = summary.parts.map(({ type, transports }) => {
    const labels = transports.map((transport) => t(transport === 'url'
      ? 'assistant.attachment-capability-transport-url'
      : 'assistant.attachment-capability-transport-base64'))
    const suffix = labels.length ? `（${labels.join('/')}）` : ''
    return `${t(`assistant.attachment-type-${type}`)}${suffix}`
  })
  return t('assistant.attachment-capability-add', { capabilities: capabilities.join('、') })
})

const compatibilityError = computed<AssistantLocalizedMessage | null>(() =>
  attachmentCompatibilityError(selectedModel.value, attachments.value))

function localizedMessage(message: AssistantLocalizedMessage | null): string | null {
  if (!message) return null
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(message.params)) {
    params[key] = typeof value === 'string' && /^(image|video|audio|file)$/.test(value)
      ? t(`assistant.attachment-type-${value}`)
      : value
  }
  return t(message.key, params)
}

function attachmentError(error: unknown): string {
  if (error instanceof AssistantAttachmentError) {
    return localizedMessage({ key: error.key, params: error.params }) ?? error.message
  }
  return error instanceof Error ? error.message : t('assistant.send-failed')
}

async function addFiles(files: File[]): Promise<void> {
  if (!files.length) return
  if (!selectedModel.value) {
    throw new AssistantAttachmentError('assistant.attachment-model-required', {}, '请先选择对话模型')
  }
  if (preparingAttachments) {
    throw new AssistantAttachmentError('assistant.attachment-busy', {}, '附件正在处理中，请稍候')
  }
  const scope = attachmentsScope
  preparingAttachments = true
  uploading.value = true
  try {
    const next = await prepareAssistantAttachments({
      files,
      model: selectedModel.value,
      existing: attachments.value,
    })
    if (scope !== attachmentsScope) return
    attachments.value = [...attachments.value, ...next]
  } finally {
    preparingAttachments = false
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((item) => item.id !== id)
}

function clearAttachments(): void {
  attachments.value = []
}

function onFilesSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  sendError.value = null
  void addFiles(files).catch((error: unknown) => { sendError.value = attachmentError(error) })
}

function onPaste(event: ClipboardEvent): void {
  const items = Array.from(event.clipboardData?.items ?? [])
  const files = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
  if (!files.length) return
  event.preventDefault()
  sendError.value = null
  void addFiles(files).catch((error: unknown) => { sendError.value = attachmentError(error) })
}

// ---- 提交 / 停止 ----
const submitting = ref(false)
const sendError = ref<string | null>(null)

const sendDisabled = computed(() => (
  (!text.value.trim() && !attachments.value.length)
  || !store.selectedModelId
  || !models.value.length
  || submitting.value
  || uploading.value
  || !!compatibilityError.value
  || !!modelsError.value))

const hasReferences = computed(() => !!selectedProject.value
  || selectedSkills.value.length > 0
  || selectedMcpTools.value.length > 0)

const alertMessage = computed(() => sendError.value
  || modelsError.value
  || runtimeMessagesError.value
  || localizedMessage(compatibilityError.value))

async function submit(): Promise<void> {
  if ((!text.value.trim() && !attachments.value.length)
    || submitting.value
    || running.value
    || !store.selectedModelId
    || !models.value.length
    || uploading.value
    || compatibilityError.value) return
  submitting.value = true
  sendError.value = null
  try {
    const referencedProjectId = selectedProject.value?.id ?? null
    // 跨项目发送 (旧 submit 语义): 切换项目上下文时把草稿移交新对话
    if (selectedConversationId.value
      && referencedProjectId !== (conversationProjectId.value ?? null)) {
      store.setDraft(null, text.value)
      store.startNewConversation()
    }
    await store.sendMessage(
      text.value,
      store.selectedModelId,
      reasoningEffort.value,
      referencedProjectId,
      {
        project: selectedProject.value,
        skills: selectedSkills.value,
        mcpTools: selectedMcpTools.value,
        multimodalInputs: attachments.value.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          inputType: attachment.inputType,
          mimeType: attachment.mimeType,
          transport: attachment.transport,
          url: attachment.url,
          data: attachment.data,
          resourceUrl: attachment.resourceUrl,
          size: attachment.size,
        })),
      },
    )
    updateText('')
    clearAttachments()
    projectOverride.value = undefined
    selectedSkills.value = []
    selectedMcpTools.value = []
  } catch (error: unknown) {
    sendError.value = error instanceof Error ? error.message : t('assistant.send-failed')
  } finally {
    submitting.value = false
  }
}

let composing: boolean = false

function onCompositionStart(): void {
  composing = true
}

function onCompositionEnd(): void {
  composing = false
}

// ---- textarea 光标 / 焦点 ([adapt] el-input → 原生 textarea, Shadow DOM 安全) ----
const inputRef = ref<HTMLTextAreaElement | null>(null)

function textareaElement(): HTMLTextAreaElement | undefined {
  return inputRef.value ?? undefined
}

function onTextInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  const element = textareaElement()
  const cursor = element?.selectionStart ?? value.length
  updateTextWithTrigger(value, cursor)
}

function onKeydown(event: KeyboardEvent): void {
  if (handlePickerKeyDown(event)) return
  if (event.key !== 'Enter' || !event.ctrlKey || composing) return
  event.preventDefault()
  void submit()
}

const activeItemRef = ref<HTMLElement | null>(null)
const pickerListRef = ref<HTMLElement | null>(null)

watch(activeIndex, () => {
  void nextTick(() => {
    const list = pickerListRef.value
    if (!list) return
    const active = list.querySelector('[data-active="true"]')
    if (active instanceof HTMLElement && active !== activeItemRef.value) {
      activeItemRef.value = active
    }
    activeItemRef.value?.scrollIntoView?.({ block: 'nearest' })
  })
})

async function stop(): Promise<void> {
  sendError.value = null
  try {
    await store.stopGeneration()
  } catch (error: unknown) {
    sendError.value = error instanceof Error ? error.message : t('assistant.stop-failed')
  }
}

// ---- 引用候选加载 (旧 use-assistant-references active effect) ----
function beginLoadReferenceData(): void {
  void loadAssistantReferenceOptions()
    .then((result) => {
      referenceOptions.value = result
      capabilitiesError.value = null
    })
    .catch((error: unknown) => {
      capabilitiesError.value = error instanceof Error
        ? error.message
        : t('assistant.reference-load-failed')
    })
    .finally(() => { capabilitiesLoading.value = false })
  void loadAssistantReferenceProjects()
    .then((result) => {
      projects.value = result
      projectsError.value = null
    })
    .catch((error: unknown) => {
      projectsError.value = error instanceof Error
        ? error.message
        : t('assistant.reference-projects-load-failed')
    })
    .finally(() => { projectsLoading.value = false })
}

onMounted(() => {
  void beginLoadModels()
  beginLoadReferenceData()
})
</script>

<template>
  <div class="assistant-composer" data-testid="assistant-composer">
    <p v-if="alertMessage" class="assistant-composer__alert" data-testid="assistant-composer-alert">
      <span class="assistant-composer__alert-text">{{ alertMessage }}</span>
      <button
        v-if="modelsError"
        type="button"
        class="assistant-composer__alert-retry fc-button-ghost"
        @click="beginLoadModels()"
      >
        {{ t('assistant.retry') }}
      </button>
    </p>

    <div v-if="hasReferences" class="assistant-composer__references" data-testid="assistant-references">
      <span class="assistant-composer__references-label">{{ t('assistant.reference-label') }}</span>
      <IaTag
        v-if="selectedProject"
        color="brand"
        :closable="true"
        :data-testid="`assistant-reference-chip-project:${selectedProject.id}`"
        @close="selectProject(null)"
      >
        {{ selectedProject.name }}
      </IaTag>
      <IaTag
        v-for="skill in selectedSkills"
        :key="skill.id"
        color="primary"
        :closable="true"
        :data-testid="`assistant-reference-chip-skill:${skill.id}`"
        :title="t('assistant.reference-skill-eyebrow', { name: skill.name })"
        @close="selectedSkills = selectedSkills.filter((item) => item.id !== skill.id)"
      >
        {{ skill.displayName }}
      </IaTag>
      <IaTag
        v-for="tool in selectedMcpTools"
        :key="`${tool.serverName}:${tool.toolName}`"
        color="primary"
        :closable="true"
        :data-testid="`assistant-reference-chip-mcp:${tool.serverName}:${tool.toolName}`"
        :title="t('assistant.reference-mcp-eyebrow', { server: tool.serverName })"
        @close="selectedMcpTools = selectedMcpTools.filter((item) => item.serverName !== tool.serverName || item.toolName !== tool.toolName)"
      >
        {{ tool.toolName }}
      </IaTag>
    </div>

    <div v-if="attachments.length" class="assistant-composer__attachments" data-testid="assistant-attachments">
      <!-- [P2 #14] chip 组件化: 与消息区用户气泡附件渲染同组件(AssistantAttachmentChip) -->
      <AssistantAttachmentChip
        v-for="attachment in attachments"
        :key="attachment.id"
        :attachment="attachment"
        :removable="true"
        :remove-disabled="submitting || running"
        @remove="removeAttachment(attachment.id)"
      />
    </div>

    <textarea
      ref="inputRef"
      :value="text"
      rows="3"
      resize="none"
      :placeholder="t('assistant.input-placeholder-hint')"
      class="assistant-composer__input"
      :disabled="!models.length || modelsLoading || submitting || running"
      :aria-expanded="!!picker"
      data-testid="assistant-input"
      @input="onTextInput"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @paste="onPaste"
      @blur="closePicker"
      @keydown="onKeydown"
    />

    <div
      v-if="picker"
      class="assistant-composer__picker"
      data-testid="assistant-reference-picker"
      role="listbox"
      :aria-label="pickerTitle"
    >
      <div class="assistant-composer__picker-head">
        <span class="assistant-composer__picker-badge">
          {{ picker.mode === 'project' ? '@' : '/' }}
        </span>
        <span class="assistant-composer__picker-titles">
          <span class="assistant-composer__picker-title">{{ pickerTitle }}</span>
          <span class="assistant-composer__picker-hint">{{ pickerHint }}</span>
        </span>
      </div>
      <div ref="pickerListRef" class="assistant-composer__picker-list">
        <p v-if="pickerLoading" class="assistant-composer__picker-state" data-testid="assistant-reference-loading">
          <i class="ri-loader-4-line is-spinning" />
          {{ t('assistant.reference-loading') }}
        </p>
        <p v-else-if="pickerError" class="assistant-composer__picker-state is-error" data-testid="assistant-reference-error">
          {{ pickerError }}
        </p>
        <template v-else-if="pickerItems.length">
          <button
            v-for="(item, index) in pickerItems"
            :key="itemKey(item)"
            type="button"
            role="option"
            class="assistant-composer__picker-item fc-button-ghost"
            :class="{ 'is-active': index === activeIndex }"
            :data-active="index === activeIndex"
            :aria-selected="itemSelected(item)"
            :data-testid="`assistant-reference-item-${itemKey(item)}`"
            @mousedown.prevent
            @mouseenter="setActiveIndex(index)"
            @click="selectPickerItem(item)"
          >
            <span class="assistant-composer__picker-item-icon"><i :class="itemIcon(item)" /></span>
            <span class="assistant-composer__picker-item-main">
              <span class="assistant-composer__picker-item-eyebrow">{{ itemEyebrow(item) }}</span>
              <span class="assistant-composer__picker-item-label">{{ itemLabel(item) }}</span>
              <span class="assistant-composer__picker-item-desc">{{ itemDescription(item) }}</span>
            </span>
            <i v-if="itemSelected(item)" class="ri-check-line assistant-composer__picker-item-check" />
          </button>
        </template>
        <p v-else class="assistant-composer__picker-state" data-testid="assistant-reference-empty">
          {{ picker.query ? t('assistant.reference-no-match') : pickerEmptyText }}
        </p>
      </div>
    </div>

    <div class="assistant-composer__controls">
      <IaSelect
        :model-value="store.selectedModelId ?? undefined"
        :options="models.map((model) => ({ label: model.name, value: model.id }))"
        :loading="modelsLoading"
        :placeholder="t('assistant.model')"
        size="small"
        class="assistant-composer__model"
        data-testid="assistant-model-select"
        @update:model-value="(value: unknown) => store.setSelectedModelId(value === undefined ? null : Number(value))"
      />
      <IaSelect
        v-if="effortOptions.length"
        :model-value="reasoningEffort ?? undefined"
        :options="effortOptions"
        :placeholder="t('assistant.reasoning-effort')"
        size="small"
        class="assistant-composer__effort"
        data-testid="assistant-effort-select"
        @update:model-value="(value: unknown) => { reasoningEffort = value === undefined ? null : String(value) }"
      />
      <IaSelect
        :model-value="selectedConversationId ? runtime?.toolExecutionMode : store.newToolExecutionMode"
        :options="toolModeOptions"
        :disabled="submitting || running"
        :placeholder="t('assistant.tool-mode')"
        size="small"
        class="assistant-composer__tool-mode"
        data-testid="assistant-tool-mode"
        @update:model-value="(value: unknown) => store.setToolExecutionMode(value as ToolExecutionMode)"
      />

      <div class="assistant-composer__spacer" />

      <input
        ref="fileInput"
        type="file"
        class="assistant-composer__file-input"
        :accept="attachmentInputAccept"
        multiple
        data-testid="assistant-attachment-input"
        @change="onFilesSelected"
      >
      <IaButton
        v-if="canAddAttachments"
        variant="text"
        size="sm"
        :disabled="submitting || running"
        :title="capabilitySummary"
        :aria-label="t('assistant.attachment-add')"
        data-testid="assistant-attachment-add"
        @click="fileInput?.click()"
      >
        <i class="ri-attachment-2" />
      </IaButton>

      <IaButton
        v-if="cancelling"
        variant="danger"
        size="sm"
        disabled
        data-testid="assistant-cancelling"
      >
        <i class="ri-loader-4-line is-spinning" />
        {{ t('assistant.stopping') }}
      </IaButton>
      <IaButton
        v-else-if="running || currentConnection"
        variant="danger"
        size="sm"
        data-testid="assistant-stop"
        @click="stop"
      >
        <i class="ri-stop-line" />
        {{ t('assistant.stop') }}
      </IaButton>
      <IaButton
        v-else
        variant="secondary"
        size="sm"
        :disabled="sendDisabled"
        :loading="submitting"
        data-testid="assistant-send"
        @click="submit"
      >
        <i class="ri-send-plane-2-line" />
        {{ t('assistant.send') }}
      </IaButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.assistant-composer {
  position: relative;
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--app-separator, var(--el-border-color-lighter));
}

.assistant-composer__alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  padding: 6px 10px;
  border-radius: var(--app-radius-md);
  border: 1px solid var(--el-color-danger-light-7, #fde2e2);
  background: var(--el-color-danger-light-9, #fef0f0);
  font-size: 11px;
  color: var(--el-color-danger, #f56c6c);
}

.assistant-composer__alert-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-composer__alert-retry {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--el-color-danger, #f56c6c);
  text-decoration: underline;
}

.assistant-composer__references {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 2px 8px;
}

.assistant-composer__references-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.assistant-composer__attachments {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 2px 8px;
}

.assistant-composer__input {
  display: block;
  width: 100%;
  min-height: 60px;
  padding: 8px 10px;
  border: 1px solid var(--app-separator, var(--ia-separator, #dcdfe6));
  border-radius: var(--app-radius-md, 8px);
  background: var(--app-bg-card, var(--ia-bg-card, #fff));
  color: var(--app-text, var(--ia-text, #303133));
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  box-sizing: border-box;
}

.assistant-composer__input:focus {
  outline: none;
  border-color: var(--app-primary, var(--ia-primary, #409eff));
}

.assistant-composer__input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.assistant-composer__input::placeholder {
  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));
  white-space: pre-line;
}

.assistant-composer__picker {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: calc(100% - 6px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  max-height: 280px;
  padding: 8px;
  border-radius: var(--app-radius-lg, 12px);
  border: 1px solid var(--app-separator, var(--el-border-color-light));
  background: var(--app-bg-card, var(--el-bg-color));
  box-shadow: var(--app-shadow-lg, var(--el-box-shadow-light));
}

.assistant-composer__picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 8px;
  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));
}

.assistant-composer__picker-badge {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--app-radius-sm);
  font-size: 13px;
  font-weight: 700;
  color: var(--app-text-secondary);
  background: color-mix(in srgb, var(--app-primary) 10%, transparent);
}

.assistant-composer__picker-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.assistant-composer__picker-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
}

.assistant-composer__picker-hint {
  font-size: 10px;
  color: var(--app-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-composer__picker-list {
  min-height: 0;
  overflow-y: auto;
  padding-top: 4px;
}

.assistant-composer__picker-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  padding: 20px 12px;
  font-size: 12px;
  color: var(--app-text-secondary);

  &.is-error { color: var(--el-color-danger, #f56c6c); }
}

.assistant-composer__picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 8px;
  border: none;
  border-radius: var(--app-radius-md);
  background: none;
  cursor: pointer;
  text-align: left;

  &:hover,
  &.is-active {
    background: color-mix(in srgb, var(--app-primary) 8%, transparent);
  }
}

.assistant-composer__picker-item-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--app-radius-sm);
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  color: var(--app-text-secondary);
}

.assistant-composer__picker-item-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  line-height: 1.25;
}

.assistant-composer__picker-item-eyebrow,
.assistant-composer__picker-item-desc {
  font-size: 10px;
  color: var(--app-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-composer__picker-item-label {
  margin-top: 1px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-composer__picker-item-check {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--app-primary);
}

.assistant-composer__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.assistant-composer__model {
  min-width: 150px;
  max-width: 220px;
}

.assistant-composer__effort {
  width: 110px;
}

.assistant-composer__tool-mode {
  width: 150px;
}

.assistant-composer__spacer {
  flex: 1;
}

.assistant-composer__file-input {
  display: none;
}

.is-spinning {
  display: inline-block;
  animation: assistant-composer-spin 1s linear infinite;
}

@keyframes assistant-composer-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
