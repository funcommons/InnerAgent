/**
 * [port] 助手组件测试 — 源: $SRC/components/assistant/__tests__/assistantComponents.test.ts。
 * 用例 1:1; 适配: mock 重锚到 @inneragent/sdk-core (仅 useAssistantStore 替换);
 * i18n key 断言 → 内置 zh-CN 文案断言; FcDialog teleport → IaDialog 就地渲染;
 * fc-tag__close → ia-tag__close.
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant:
 * - tool-confirmation-batch-bar.tsx → 批量审批条 (倒计时/提交中/过期)
 * - notification-panel/timeline.tsx → 单工具行内 允许/拒绝 (showCountdown 单工具)
 * - conversation-navigation.tsx → 会话列表 (新建/删除确认/加载更多)
 * - message-list.tsx → 用户气泡 + live timeline + 批量审批条挂载
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createFakeAssistantStore, flushTwice, makeConversation } from './helpers/assistantFake'

const fake = createFakeAssistantStore()
vi.mock('@inneragent/sdk-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inneragent/sdk-core')>()
  return { ...actual, useAssistantStore: () => fake }
})

import AssistantToolConfirmBar from '../assistant/AssistantToolConfirmBar.vue'
import AssistantTimeline from '../assistant/AssistantTimeline.vue'
import AssistantConversationNav from '../assistant/AssistantConversationNav.vue'
import AssistantMessageList from '../assistant/AssistantMessageList.vue'

// [adapt] IaDialog 不 teleport (Shadow DOM 内就地渲染) → 断言直接用 wrapper.find

describe('AssistantToolConfirmBar (批量审批条)', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const baseProps = {
    toolCallIds: ['tc-1', 'tc-2'],
    decisions: {} as Record<string, boolean>,
    submitting: false,
    showActions: true,
    expiresAt,
  }

  it('渲染批量审批: 工具数/标题/操作按钮', () => {
    const wrapper = mount(AssistantToolConfirmBar, { props: baseProps })
    expect(wrapper.find('[data-testid="assistant-batch-approval"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('批量审批')
    expect(wrapper.text()).toContain('个工具等待确认')
    expect(wrapper.find('[data-testid="assistant-approve-all"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-reject-all"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('一键允许/拒绝 → emit decision(true/false)', async () => {
    const wrapper = mount(AssistantToolConfirmBar, { props: baseProps })
    await wrapper.find('[data-testid="assistant-approve-all"]').trigger('click')
    expect(wrapper.emitted('decision')?.[0]).toEqual([true])
    await wrapper.find('[data-testid="assistant-reject-all"]').trigger('click')
    expect(wrapper.emitted('decision')?.[1]).toEqual([false])
    wrapper.unmount()
  })

  it('少于 2 个工具不渲染 (单个走 timeline 行内决定)', () => {
    const wrapper = mount(AssistantToolConfirmBar, {
      props: { ...baseProps, toolCallIds: ['tc-1'] },
    })
    expect(wrapper.find('[data-testid="assistant-batch-approval"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('已过期: 提示按未同意处理且隐藏操作按钮', () => {
    const wrapper = mount(AssistantToolConfirmBar, {
      props: { ...baseProps, expiresAt: new Date(Date.now() - 1000).toISOString() },
    })
    expect(wrapper.text()).toContain('审批时间已结束')
    expect(wrapper.find('[data-testid="assistant-approve-all"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('showActions=false (取消中) 且未过期 → 整条不渲染', () => {
    const wrapper = mount(AssistantToolConfirmBar, {
      props: { ...baseProps, showActions: false },
    })
    expect(wrapper.find('[data-testid="assistant-batch-approval"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('AssistantTimeline (timeline + 单工具行内确认)', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  it('content/reasoning/tool 渲染 + plan 摘要', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          { type: 'reasoning', text: '先想一下' },
          { type: 'content', text: '回答正文' },
          {
            type: 'tool', id: 'tc-9', name: 'save_script_episode', arguments: '{}', status: 'calling',
            plan: { summary: '保存分集', changes: [{ field: 'title', before: 'a', after: 'b' }] },
          },
        ],
      },
    })
    expect(wrapper.text()).toContain('回答正文')
    expect(wrapper.text()).toContain('先想一下')
    expect(wrapper.text()).toContain('保存分集')
    expect(wrapper.text()).toContain('title: a → b')
    expect(wrapper.find('[data-testid="assistant-tool-2"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('content/工具结果 markdown 渲染: 标题/粗体/表格出结构, html 注入被转义 (#21)', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          { type: 'content', text: '## 方案\n\n**加粗** 正文\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' },
          { type: 'tool', id: 'tc-md', name: 'search_web', arguments: '{}', status: 'done', result: '- 结果甲\n- 结果乙' },
          { type: 'content', text: '<script>alert(1)</script>' },
        ],
      },
    })
    const contentMd = wrapper.find('[data-testid="assistant-content-0"]')
    expect(contentMd.exists()).toBe(true)
    expect(contentMd.find('h2.md-heading').text()).toBe('方案')
    expect(contentMd.find('strong').text()).toBe('加粗')
    expect(contentMd.find('table.md-table').exists()).toBe(true)
    // 工具结果 (compact 档) 列表渲染
    expect(wrapper.find('.assistant-timeline__result ul.md-list li').exists()).toBe(true)
    // XSS: 脚本标签按文本呈现
    expect(wrapper.find('[data-testid="assistant-content-2"]').find('script').exists()).toBe(false)
    wrapper.unmount()
  })

  it('媒体行抽卡: 视频地址行剥离出 markdown 并渲染卡片+下载, 无媒体行不渲染卡片 (对齐旧 TaskMediaLinks)', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          {
            type: 'content',
            text: '生成完成\n视频地址: https://oss.example.com/a.mp4\n· 下载地址: /media/videos/b.mp4',
          },
          { type: 'content', text: '无媒体行回复' },
        ],
      },
    })
    const md = wrapper.find('[data-testid="assistant-content-0"]')
    expect(md.exists()).toBe(true)
    // URL 已从 markdown 正文剥离
    expect(md.text()).not.toContain('https://oss.example.com/a.mp4')
    // 卡片: 标签 + 链接 + 下载
    const cards = wrapper.findAll('.assistant-media-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.text()).toContain('视频地址')
    expect(cards[0]?.find('a.assistant-media-card__url').attributes('href')).toBe(
      'https://oss.example.com/a.mp4',
    )
    const download = cards[0]?.find('a.assistant-media-card__download')
    expect(download?.attributes('href')).toBe('https://oss.example.com/a.mp4')
    expect(download?.attributes('download')).toBeDefined()
    // /media/ 相对路径 → resolveMediaUrl 绝对化
    expect(cards[1]?.find('a.assistant-media-card__url').attributes('href')).toContain(
      '/media/videos/b.mp4',
    )
    // 第二条 content 无媒体行 → 不产生卡片
    expect(wrapper.find('[data-testid="assistant-content-1"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('awaiting_approval 工具 (单工具批) 渲染行内 允许/拒绝 + 倒计时, 决定 emit', async () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          { type: 'tool', id: 'tc-1', name: 'generate_image', arguments: '{}', status: 'awaiting_approval' },
        ],
        confirmation: {
          toolCallIds: ['tc-1'],
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
        },
      },
    })
    expect(wrapper.find('[data-testid="assistant-confirm-tc-1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('等待确认 · 剩余')
    await wrapper.find('[data-testid="assistant-approve-tc-1"]').trigger('click')
    expect(wrapper.emitted('decision')?.[0]).toEqual(['tc-1', true])
    await wrapper.find('[data-testid="assistant-reject-tc-1"]').trigger('click')
    expect(wrapper.emitted('decision')?.[1]).toEqual(['tc-1', false])
    wrapper.unmount()
  })

  it('非确认批内的工具不渲染行内操作', () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          { type: 'tool', id: 'tc-x', name: 'generate_image', arguments: '{}', status: 'awaiting_approval' },
        ],
        confirmation: {
          toolCallIds: ['tc-1'],
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
        },
      },
    })
    expect(wrapper.find('[data-testid="assistant-confirm-tc-x"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('子 Agent children 缩进渲染, 确认批命中子工具 (parentToolCallId 匹配) 时行内可决定', async () => {
    const wrapper = mount(AssistantTimeline, {
      props: {
        items: [
          {
            type: 'tool', id: 'tc-parent', name: 'generate_storyboard_frame', arguments: '{}', status: 'calling',
            children: [
              { type: 'tool', id: 'tc-child', name: 'generate_image', arguments: '{}', status: 'awaiting_approval' },
            ],
          },
        ],
        confirmation: {
          toolCallIds: ['tc-child'],
          parentToolCallId: 'tc-parent',
          decisions: {},
          submitting: false,
          showActions: true,
          expiresAt,
        },
      },
    })
    expect(wrapper.find('[data-testid="assistant-confirm-tc-child"]').exists()).toBe(true)
    await wrapper.find('[data-testid="assistant-approve-tc-child"]').trigger('click')
    expect(wrapper.emitted('decision')?.[0]).toEqual(['tc-child', true])
    wrapper.unmount()
  })
})

describe('AssistantConversationNav (会话列表)', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    fake.conversations = [makeConversation(), makeConversation({ id: 12, conversationId: 'conv-2', title: '第二会话' })]
    fake.conversationStates = {}
    fake.hasMoreConversations = false
    fake.conversationsLoading = false
    fake.selectedConversationId = 'conv-1'
    vi.clearAllMocks()
  })

  it('渲染会话行 + 选中态; 点击行 → selectConversation', async () => {
    wrapper = mount(AssistantConversationNav)
    expect(wrapper.find('[data-testid="assistant-conversation-conv-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-conversation-conv-2"]').exists()).toBe(true)
    await wrapper.find('[data-testid="assistant-conversation-conv-2"]').trigger('click')
    expect(fake.selectConversation).toHaveBeenCalledWith('conv-2')
    wrapper.unmount()
    wrapper = null
  })

  it('新建对话按钮 → startNewConversation', async () => {
    wrapper = mount(AssistantConversationNav)
    await wrapper.find('[data-testid="assistant-new-conversation"]').trigger('click')
    expect(fake.startNewConversation).toHaveBeenCalled()
    wrapper.unmount()
    wrapper = null
  })

  it('加载更多: hasMoreConversations 时渲染入口 → loadMoreConversations', async () => {
    fake.hasMoreConversations = true
    wrapper = mount(AssistantConversationNav)
    const more = wrapper.find('[data-testid="assistant-load-more"]')
    expect(more.exists()).toBe(true)
    await more.trigger('click')
    expect(fake.loadMoreConversations).toHaveBeenCalled()
    wrapper.unmount()
    wrapper = null
  })

  it('删除: 运行中会话按钮禁用; 停止后经确认对话框 → deleteConversation', async () => {
    fake.conversationStates = {
      'conv-1': { status: 'running', unread: false, pipeline: {}, draft: '', toolExecutionMode: 'DEFAULT', messages: [], messagesLoaded: false, messagesLoading: false, statusConfirmed: false, conversation: makeConversation() },
      'conv-2': { status: 'completed', unread: false, pipeline: {}, draft: '', toolExecutionMode: 'DEFAULT', messages: [], messagesLoaded: false, messagesLoading: false, statusConfirmed: true, conversation: makeConversation() },
    }
    wrapper = mount(AssistantConversationNav)
    const runningDelete = wrapper.find('[data-testid="assistant-delete-conv-1"]')
    expect((runningDelete.element as HTMLButtonElement).disabled).toBe(true)
    const idleDelete = wrapper.find('[data-testid="assistant-delete-conv-2"]')
    expect((idleDelete.element as HTMLButtonElement).disabled).toBe(false)

    await idleDelete.trigger('click')
    await flushTwice()
    const confirm = wrapper!.find('[data-testid="assistant-delete-confirm"]')
    expect(confirm.exists()).toBe(true)
    await confirm.trigger('click')
    await flushTwice()
    await flushTwice()
    expect(fake.deleteConversation).toHaveBeenCalledWith('conv-2', 12)
    wrapper.unmount()
    wrapper = null
  })
})

describe('AssistantMessageList (消息流 + 确认接线)', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  function mountList() {
    return mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
  }

  it('用户气泡 + live timeline + 正在思考', () => {
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation({ status: 'running' }),
        status: 'running',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: true,
        messagesLoading: false,
        pipeline: {
          status: 'running', reasoningText: '思考中', timeline: [], lastSequence: 1, runId: 'run-1',
        },
      },
    }
    const wrapper = mountList()
    expect(wrapper.find('[data-testid="assistant-message-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assistant-thinking"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('pendingConfirmation 单工具 → timeline 行内决定; 双工具 → 批量审批条', async () => {
    const pending = {
      runId: 'run-1', replyId: 'reply-1',
      toolCalls: [
        { toolCallId: 'tc-1', toolName: 'save_script_episode', argumentsPreview: '{}' },
        { toolCallId: 'tc-2', toolName: 'save_script_episode', argumentsPreview: '{}' },
      ],
      expiresAt,
      decisions: {} as Record<string, boolean>,
      submitting: false,
    }
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation({ status: 'WAITING_CONFIRMATION' }),
        status: 'WAITING_CONFIRMATION',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: true,
        messagesLoading: false,
        pipeline: {
          status: 'running', reasoningText: '', timeline: [
            { type: 'tool', id: 'tc-1', name: 'save_script_episode', arguments: '{}', status: 'awaiting_approval' },
            { type: 'tool', id: 'tc-2', name: 'save_script_episode', arguments: '{}', status: 'awaiting_approval' },
          ], lastSequence: 2, runId: 'run-1', pendingConfirmation: pending,
        },
      },
    }
    const wrapper = mountList()
    const bar = wrapper.find('[data-testid="assistant-batch-approval"]')
    expect(bar.exists()).toBe(true)
    await wrapper.find('[data-testid="assistant-approve-all"]').trigger('click')
    expect(fake.respondToAllToolConfirmations).toHaveBeenCalledWith(true)
    wrapper.unmount()
  })

  it('新一轮 run 运行中 (messagesLoaded=false 但 live timeline 在流式) → 不显示加载遮罩', () => {
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation({ status: 'running' }),
        status: 'running',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: false,
        messagesLoading: false,
        pipeline: {
          status: 'running', reasoningText: '', timeline: [
            { type: 'content', text: '已完成的中间陈述' },
          ], lastSequence: 3, runId: 'run-2',
        },
      },
    }
    const wrapper = mountList()
    // 运行中且有 live timeline: 内容已在实时渲染, 加载遮罩不得盖住它
    expect(wrapper.find('[data-testid="assistant-messages-veil"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('错误信息展示 + 重试 → loadMessagesIfNeeded + ensureContentConnection', async () => {
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation(),
        status: 'completed',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: false,
        messagesLoading: false,
        messagesError: '加载消息失败',
        pipeline: { status: 'idle', reasoningText: '', timeline: [], lastSequence: 0 },
      },
    }
    const wrapper = mountList()
    expect(wrapper.find('[data-testid="assistant-message-error"]').exists()).toBe(true)
    await wrapper.find('[data-testid="assistant-retry"]').trigger('click')
    expect(fake.loadMessagesIfNeeded).toHaveBeenCalledWith('conv-1')
    expect(fake.ensureContentConnection).toHaveBeenCalled()
    wrapper.unmount()
  })
})

// ============ SubAgent 折叠 + 进度 (对齐旧 SubAgentCard) ============

describe('AssistantTimeline — SubAgent 折叠 + 进度', () => {
  const subItem = {
    type: 'tool' as const,
    id: 'tc-sub',
    name: 'generate_image',
    arguments: '{}',
    status: 'done' as const,
    children: [
      { type: 'tool' as const, id: 'c1', name: 'generate_image', arguments: '{}', status: 'done' as const },
      { type: 'tool' as const, id: 'c2', name: 'generate_image', arguments: '{}', status: 'calling' as const },
    ],
  }

  it('运行中自动展开 (children 可见), 完成默认折叠', async () => {
    const wrapper = mount(AssistantTimeline, {
      props: { items: [
        { type: 'tool', id: 'tc-run', name: 'run_agent', arguments: '{}', status: 'calling', children: subItem.children },
      ] },
    })
    // running → 自动展开
    expect(wrapper.find('[data-testid="assistant-tool-0"] .assistant-timeline__children').exists()).toBe(true)
    wrapper.unmount()

    const done = mount(AssistantTimeline, {
      props: { items: [
        { type: 'tool', id: 'tc-sub', name: 'run_agent', arguments: '{}', status: 'done', children: subItem.children },
      ] },
    })
    // done → 默认折叠
    expect(done.find('[data-testid="assistant-tool-0"] .assistant-timeline__children').exists()).toBe(false)
    // 折叠头存在且带进度标签 (t 回退 key 含插值槽原始串)
    expect(done.find('[data-testid="subagent-toggle-0"]').exists()).toBe(true)

    // 点击 → 展开
    await done.find('[data-testid="subagent-toggle-0"]').trigger('click')
    expect(done.find('[data-testid="assistant-tool-0"] .assistant-timeline__children').exists()).toBe(true)
    // 再点 → 折叠
    await done.find('[data-testid="subagent-toggle-0"]').trigger('click')
    expect(done.find('[data-testid="assistant-tool-0"] .assistant-timeline__children').exists()).toBe(false)
    done.unmount()
  })
})

// ============ 窄屏抽屉 (消费 drawerOpen 死状态, 对齐旧 conversation-navigation) ============

describe('AssistantConversationNav — 窄屏抽屉', () => {
  it('drawerOpen → is-drawer + 遮罩; 点遮罩/关闭钮 → setDrawerOpen(false)', async () => {
    ;(fake as unknown as { drawerOpen: boolean; setDrawerOpen: ReturnType<typeof vi.fn> }).drawerOpen = true
    ;(fake as unknown as { setDrawerOpen: ReturnType<typeof vi.fn> }).setDrawerOpen = vi.fn()
    const wrapper = mount(AssistantConversationNav)
    await flushTwice()
    expect(wrapper.find('.assistant-nav.is-drawer').exists()).toBe(true)
    expect(wrapper.find('.assistant-nav__mask').exists()).toBe(true)

    await wrapper.find('.assistant-nav__mask').trigger('click')
    expect((fake as unknown as { setDrawerOpen: ReturnType<typeof vi.fn> }).setDrawerOpen).toHaveBeenCalledWith(false)
    ;(fake as unknown as { drawerOpen: boolean }).drawerOpen = false
    wrapper.unmount()
  })
})

// ============ 时间线 content-visibility 性能优化 (#21) ============

describe('AssistantMessageList — content-visibility 优化标记 (#21)', () => {
  it('长会话(40 段) DOM 完整渲染 (content-visibility 不裁 DOM), cv host 类在位', async () => {
    fake.conversationStates = {
      'conv-1': {
        conversation: makeConversation({ status: 'completed' }),
        status: 'completed',
        statusConfirmed: true,
        unread: false,
        draft: '',
        toolExecutionMode: 'DEFAULT',
        messages: [],
        messagesLoaded: true,
        messagesLoading: false,
        pipeline: {
          status: 'completed', reasoningText: '', timeline: [], lastSequence: 1, runId: 'run-1',
        },
      },
    }
    // 40 段用户消息注入 messages (segments 由 store 计算)
    const state = fake.conversationStates['conv-1'] as Record<string, unknown> & { messages: unknown[] }
    state.messages = Array.from({ length: 40 }, (_, i) => ({
      id: `m-${i}`, role: 'user', content: `消息 ${i}`, createdAt: '',
    }))
    const wrapper = mount(AssistantMessageList, { props: { conversationId: 'conv-1' } })
    await flushTwice()
    // DOM 完整 (cv 只跳过绘制不删节点)
    expect(wrapper.findAll('[data-testid="assistant-user-bubble"]').length).toBe(40)
    expect(wrapper.findAll('.assistant-timeline-host, .assistant-messages__user').length).toBeGreaterThanOrEqual(40)
    wrapper.unmount()
  })
})
