/**
 * [port] AssistantComposer 测试 — 源: $SRC/components/assistant/__tests__/AssistantComposer.test.ts。
 * @ 引用/Skill-MCP/附件/提交契约用例 1:1; 适配: mock 统一重锚到 core,
 * 项目候选走注入 provider, i18n 断言改文案, 上传假件 uploadAssistantInput → uploadAttachment。
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant:
 * - use-assistant-references.ts → @ 项目/页面实体 + / Skill/MCP 触发、键盘导航、
 *   选中 chips、触发词替换、会话切换重置
 * - use-assistant-attachments.ts + assistant-multimodal.ts → 文件选择/粘贴上传、
 *   兼容性告警、发送时 multimodalInputs 提交并清空
 * - composer.tsx submit → 跨项目发送 setDraft(null)+startNewConversation、
 *   sendMessage(text, modelId, effort, projectId, references) 契约
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createFakeAssistantStore, makeConversation } from './helpers/assistantFake'
import { resetAssistantReferenceCaches, setAssistantReferenceProjectsProvider } from '../assistant/assistantReferences'
import { setAssistantPageContext, clearAssistantPageContext } from '@inneragent/sdk-core'

const fake = createFakeAssistantStore()

// [adapt] 源分散 mock ('@/store/assistant'、vue-router、'@/store/user'、'@/api/ai-model'、
// '@/api/assistant'、'@/api/project'、'@/api/storage') → 统一 mock '@inneragent/sdk-core'
// (仅替换 store 与 API 假件, 其余透传); 融光 projectApi → 注入式项目提供方。
const uploads = vi.hoisted(() => ({
  uploadAttachment: vi.fn(async () => '/media/assistant/image/x.png'),
}))

vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return {
    ...actual,
    useAssistantStore: () => fake,
    uploadAttachment: uploads.uploadAttachment,
    aiModelApi: {
      listByType: vi.fn(async () => [
        {
          id: 5, name: '对话模型A', defaultModel: true, supportReasoning: true,
          reasoningEffortLevels: ['low', 'high'], status: 1,
          multimodalInputTypes: ['image', 'file'],
          multimodalInputTransports: { image: ['base64', 'url'], file: ['url'] },
        },
        {
          id: 6, name: '纯文本模型', defaultModel: false, supportReasoning: false,
          reasoningEffortLevels: [], status: 1,
          multimodalInputTypes: [], multimodalInputTransports: {},
        },
      ]),
    },
    getAssistantReferenceOptions: vi.fn(async () => ({
      skills: [
        { id: 's1', name: 'video_gen', displayName: '视频生成', description: '生成短视频', source: 'builtin' },
      ],
      mcpTools: [
        { serverName: 'media', toolName: 'render', description: '渲染工具', readOnly: true },
      ],
    })),
  }
})

import AssistantComposer from '../assistant/AssistantComposer.vue'

function runtimeFixture(over: { projectId?: number | null; draft?: string; status?: string } = {}) {
  const conversation = makeConversation({ projectId: over.projectId ?? null })
  return {
    conversation,
    status: over.status ?? 'completed',
    statusConfirmed: true,
    unread: false,
    draft: over.draft ?? '',
    toolExecutionMode: 'DEFAULT',
    messages: [],
    messagesLoaded: true,
    messagesLoading: false,
    pipeline: { status: 'idle', reasoningText: '', timeline: [], lastSequence: 0 },
  }
}

async function mountComposer(props: { projectId?: number | null } = {}) {
  const wrapper = mount(AssistantComposer, { props })
  await flushPromises()
  await nextTick()
  return wrapper
}

function textarea(wrapper: Awaited<ReturnType<typeof mountComposer>>) {
  return wrapper.find('textarea')
}

function picker(wrapper: Awaited<ReturnType<typeof mountComposer>>) {
  return wrapper.find('[data-testid="assistant-reference-picker"]')
}

async function typeText(wrapper: Awaited<ReturnType<typeof mountComposer>>, value: string) {
  await textarea(wrapper).setValue(value)
  await nextTick()
}

/** jsdom FileReader.onload 是宏任务, flushPromises (微任务) 等不到 → 轮询直至断言条件成立 */
async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForAttachments(wrapper: Awaited<ReturnType<typeof mountComposer>>) {
  await waitFor(() => wrapper.find('[data-testid="assistant-attachments"]').exists())
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAssistantReferenceCaches()
  clearAssistantPageContext()
  // [adapt] 源 projectApi.list → 注入式项目提供方 (SDK 无融光项目域)
  setAssistantReferenceProjectsProvider(async () => [
    { id: 3, name: '测试项目', description: '项目描述' },
    { id: 9, name: '另一个项目' },
  ])
  fake.conversations = []
  fake.conversationStates = {}
  fake.selectedConversationId = null
  fake.selectedModelId = 5
  fake.newDraft = ''
  // 让草稿写入真实生效 (默认 vi.fn 不落状态)
  fake.setDraft.mockImplementation((conversationId: string | null, draft: string) => {
    if (conversationId === null) fake.newDraft = draft
    else if (fake.conversationStates[conversationId]) {
      (fake.conversationStates[conversationId] as { draft: string }).draft = draft
    }
  })
})

describe('AssistantComposer — @ 引用选择器 (project 模式)', () => {
  it('@ 唤起候选面板: 页面上下文实体在前 + 项目列表; 无 query 显示提示', async () => {
    setAssistantPageContext([{ type: 'project', id: 7 }, { type: 'script', id: 3 }])
    const wrapper = await mountComposer()
    expect(picker(wrapper).exists()).toBe(false)
    await typeText(wrapper, '@')
    expect(picker(wrapper).exists()).toBe(true)
    expect(wrapper.text()).toContain('引用对象')
    // 实体候选 (剧本 #3) + 项目候选
    expect(wrapper.find('[data-testid="assistant-reference-item-entity:script:3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-reference-item-project:3"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('选择页面实体 → 确权所属项目 (chip 展示) + 触发词从草稿中移除', async () => {
    setAssistantPageContext([{ type: 'project', id: 7 }, { type: 'script', id: 3 }])
    const wrapper = await mountComposer()
    await typeText(wrapper, '@')
    await wrapper.find('[data-testid="assistant-reference-item-entity:script:3"]').trigger('click')
    expect(picker(wrapper).exists()).toBe(false)
    expect(fake.newDraft).toBe('')
    expect(wrapper.find('[data-testid="assistant-reference-chip-project:7"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('实体候选渲染名称 (队列 #41); 按名称包含关键字匹配, 未名实体回退类型标签', async () => {
    setAssistantPageContext([
      { type: 'project', id: 7 },
      { type: 'script', id: 3, name: '第一集剧本' },
      { type: 'asset', id: 5 },
    ])
    const wrapper = await mountComposer()
    await typeText(wrapper, '@')
    // 命名实体: label 渲染注册名称
    const named = wrapper.find('[data-testid="assistant-reference-item-entity:script:3"]')
    expect(named.exists()).toBe(true)
    expect(named.text()).toContain('第一集剧本')
    expect(named.text()).toContain('剧本')
    // 未名实体: label 回退类型文案 (测试 i18n 为空 → key), eyebrow 仍带类型 #id
    const unnamed = wrapper.find('[data-testid="assistant-reference-item-entity:asset:5"]')
    expect(unnamed.exists()).toBe(true)
    expect(unnamed.text()).toContain('资产')
    expect(unnamed.text()).toContain('#5')
    // 名称包含关键字: query=第一 只命中命名实体 (type/id 回退不误命中项目)
    await typeText(wrapper, '@第一')
    expect(wrapper.find('[data-testid="assistant-reference-item-entity:script:3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-reference-item-project:3"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('选择项目候选 → references.project 芯片; 移除芯片回到继承态 (无页面上下文时隐藏)', async () => {
    const wrapper = await mountComposer()
    await typeText(wrapper, '@测')
    await wrapper.find('[data-testid="assistant-reference-item-project:3"]').trigger('click')
    const chip = wrapper.find('[data-testid="assistant-reference-chip-project:3"]')
    expect(chip.exists()).toBe(true)
    await chip.find('.ia-tag__close').trigger('click')
    expect(wrapper.find('[data-testid="assistant-reference-chip-project:3"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assistant-references"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('query 过滤: 模糊无匹配显示空态; Escape 关闭面板', async () => {
    const wrapper = await mountComposer()
    await typeText(wrapper, '@不存在的项目')
    expect(wrapper.find('[data-testid="assistant-reference-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有匹配的引用项')
    await textarea(wrapper).trigger('keydown', { key: 'Escape' })
    expect(picker(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('键盘导航: ArrowDown 移动激活项, Enter 选中激活候选', async () => {
    setAssistantPageContext([{ type: 'project', id: 7 }, { type: 'script', id: 3 }])
    const wrapper = await mountComposer()
    await typeText(wrapper, '@')
    await textarea(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })
    // 索引 0 → 1 (实体 script:3 → 项目 project:3)
    expect(wrapper.find('[data-testid="assistant-reference-chip-project:3"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('AssistantComposer — / Skill 与 MCP 引用 (capability 模式)', () => {
  it('/ 唤起能力候选: 选择 skill 与 mcp → 芯片; 已选项目带勾选态', async () => {
    const wrapper = await mountComposer()
    await typeText(wrapper, '/')
    expect(wrapper.text()).toContain('引用 Skill 或 MCP')
    expect(wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-reference-item-mcp:media:render"]').exists()).toBe(true)
    await wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').trigger('click')
    await typeText(wrapper, '/')
    await wrapper.find('[data-testid="assistant-reference-item-mcp:media:render"]').trigger('click')
    expect(wrapper.find('[data-testid="assistant-reference-chip-skill:s1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-reference-chip-mcp:media:render"]').exists()).toBe(true)
    // 再次唤起时已选项标记 aria-selected
    await typeText(wrapper, '/')
    expect(wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('同一 skill 重复选择去重; 移除 skill 芯片', async () => {
    const wrapper = await mountComposer()
    await typeText(wrapper, '/')
    await wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').trigger('click')
    await typeText(wrapper, '/')
    await wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').trigger('click')
    expect(wrapper.findAll('[data-testid="assistant-reference-chip-skill:s1"]')).toHaveLength(1)
    await wrapper.find('[data-testid="assistant-reference-chip-skill:s1"]').find('.ia-tag__close').trigger('click')
    expect(wrapper.find('[data-testid="assistant-reference-chip-skill:s1"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('AssistantComposer — 提交契约 (sendMessage references)', () => {
  it('发送: 文本 + 选中项目/skill/mcp/附件 → sendMessage 五参契约; 发送后清空引用与附件', async () => {
    uploads.uploadAttachment.mockClear()
    const wrapper = await mountComposer()
    // 附件: 文件选择上传
    const input = wrapper.find('[data-testid="assistant-attachment-input"]')
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await waitForAttachments(wrapper)
    expect(uploads.uploadAttachment).toHaveBeenCalledWith(file, 5, 'base64')
    expect(wrapper.find('[data-testid="assistant-attachments"]').exists()).toBe(true)

    // 引用: 项目 + skill
    await typeText(wrapper, '@')
    await wrapper.find('[data-testid="assistant-reference-item-project:3"]').trigger('click')
    await typeText(wrapper, '/')
    await wrapper.find('[data-testid="assistant-reference-item-skill:s1"]').trigger('click')

    await typeText(wrapper, '帮我分析')
    await wrapper.find('[data-testid="assistant-send"]').trigger('click')
    await flushPromises()

    expect(fake.sendMessage).toHaveBeenCalledTimes(1)
    const [message, modelId, effort, projectId, references] =
      fake.sendMessage.mock.calls[0] as unknown as [
        string, number, string | null, number | null,
        { project: { id: number; name: string }; skills: Array<{ id: string }>; mcpTools: unknown[]; multimodalInputs: Array<{ name: string; transport: string }> },
      ]
    expect(message).toBe('帮我分析')
    expect(modelId).toBe(5)
    expect(effort).toBe('low')
    expect(projectId).toBe(3)
    expect(references).toMatchObject({
      project: { id: 3, name: '测试项目' },
      skills: [expect.objectContaining({ id: 's1' })],
      mcpTools: [],
    })
    expect(references.multimodalInputs).toHaveLength(1)
    expect(references.multimodalInputs[0]).toMatchObject({ name: 'a.png', transport: 'base64' })
    // 发送后清空
    expect(wrapper.find('[data-testid="assistant-attachments"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assistant-references"]').exists()).toBe(false)
    expect(fake.newDraft).toBe('')
    wrapper.unmount()
  })

  it('跨项目发送: 会话项目 #7 与选中项目 #3 不同 → setDraft(null)+startNewConversation', async () => {
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation({ projectId: 7 })]
    fake.conversationStates = { 'conv-1': runtimeFixture({ projectId: 7, draft: '换项目' }) as never }
    const wrapper = await mountComposer()
    await typeText(wrapper, '换项目 @')
    await wrapper.find('[data-testid="assistant-reference-item-project:3"]').trigger('click')
    await wrapper.find('[data-testid="assistant-send"]').trigger('click')
    await flushPromises()
    // 旧 replaceTrigger 语义: 只移除触发词, 触发词前的空格保留 → '换项目 '
    expect(fake.setDraft).toHaveBeenCalledWith(null, '换项目 ')
    expect(fake.startNewConversation).toHaveBeenCalled()
    expect(fake.sendMessage).toHaveBeenCalledWith(
      '换项目 ', 5, 'low', 3,
      expect.objectContaining({ project: { id: 3, name: '测试项目', description: '项目描述' } }),
    )
    wrapper.unmount()
  })

  it('仅附件无文本也可发送; 上传中禁用发送', async () => {
    const uploadGate: { resolve?: (url: string) => void } = {}
    uploads.uploadAttachment.mockImplementation(() => new Promise((resolve) => {
      uploadGate.resolve = resolve
    }))
    const wrapper = await mountComposer()
    const input = wrapper.find('[data-testid="assistant-attachment-input"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'a.png', { type: 'image/png' })],
    })
    await input.trigger('change')
    await nextTick()
    expect((wrapper.find('[data-testid="assistant-send"]').element as HTMLButtonElement).disabled).toBe(true)
    uploadGate.resolve?.('/media/assistant/image/x.png')
    await waitForAttachments(wrapper)
    await wrapper.find('[data-testid="assistant-send"]').trigger('click')
    await flushPromises()
    expect(fake.sendMessage).toHaveBeenCalledWith(
      '', 5, 'low', null,
      expect.objectContaining({ multimodalInputs: [expect.objectContaining({ name: 'a.png' })] }),
    )
    wrapper.unmount()
  })

  it('纯文本模型 (无多模态能力) 不显示附件按钮; 粘贴文件失败进告警条', async () => {
    fake.selectedModelId = 6
    const wrapper = await mountComposer()
    expect(wrapper.find('[data-testid="assistant-attachment-add"]').exists()).toBe(false)
    const pasteEvent = {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }) }],
      },
    }
    await textarea(wrapper).trigger('paste', pasteEvent)
    await waitFor(() => wrapper.find('[data-testid="assistant-composer-alert"]').exists())
    expect(wrapper.find('[data-testid="assistant-composer-alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('不支持图片输入')
    wrapper.unmount()
  })
})

describe('AssistantComposer — 会话切换重置', () => {
  it('切换会话清空附件/引用选中态 (旧 emptySelection + attachments scope)', async () => {
    const wrapper = await mountComposer()
    await typeText(wrapper, '@')
    await wrapper.find('[data-testid="assistant-reference-item-project:3"]').trigger('click')
    expect(wrapper.find('[data-testid="assistant-references"]').exists()).toBe(true)

    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation()]
    fake.conversationStates = { 'conv-1': runtimeFixture() as never }
    await nextTick()
    await nextTick()
    expect(wrapper.find('[data-testid="assistant-references"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('会话项目继承: 选中新会话后 @ 项目候选仍来自项目列表 (含会话项目勾选态)', async () => {
    fake.selectedConversationId = 'conv-1'
    fake.conversations = [makeConversation({ projectId: 3 })]
    fake.conversationStates = { 'conv-1': runtimeFixture({ projectId: 3 }) as never }
    const wrapper = await mountComposer()
    await typeText(wrapper, '@')
    const item = wrapper.find('[data-testid="assistant-reference-item-project:3"]')
    expect(item.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })
})

// [adapt] 模型设置入口用例移除: vue-router + user store admin 门控属融光业务,
// SDK 不携带 (管理面由 inneragent-web 承担)。
