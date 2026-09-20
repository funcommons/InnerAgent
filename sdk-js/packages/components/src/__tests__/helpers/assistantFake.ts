/**
 * [port] 助手组件测试 fake assistant store — 源: $SRC/components/assistant/__tests__/helpers/assistantFake.ts。
 */
/**
 * 助手组件测试 — fake assistant store (对齐 layout/__tests__/helpers/pipelineFake 范式).
 */
import { reactive } from 'vue'
import { vi } from 'vitest'
import type { AgentConversation } from '@inneragent/sdk-core'

export function makeConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 11,
    conversationId: 'conv-1',
    userId: 1,
    projectId: null,
    category: 'assistant',
    title: '测试会话',
    messageCount: 2,
    status: 'completed',
    lastMessageTime: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

export function createFakeAssistantStore() {
  const store = reactive({
    hydratedUserId: null as string | number | null,
    initialized: false,
    open: false,
    selectedConversationId: null as string | null,
    selectedModelId: null as number | null,
    conversations: [] as AgentConversation[],
    conversationStates: {} as Record<string, unknown>,
    newDraft: '',
    newToolExecutionMode: 'DEFAULT',
    drawerOpen: false,
    conversationsLoading: false,
    conversationsError: undefined as string | undefined,
    hasMoreConversations: false,
    conversationPage: 0,
    connection: null as unknown,
    connectionGeneration: 0,

    initializeForUser: vi.fn(),
    resetForUser: vi.fn(),
    loadMoreConversations: vi.fn(),
    selectConversation: vi.fn(),
    startNewConversation: vi.fn(),
    setDraft: vi.fn(),
    setSelectedModelId: vi.fn(),
    setToolExecutionMode: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    stopGeneration: vi.fn(async () => {}),
    respondToToolConfirmation: vi.fn(async () => {}),
    respondToAllToolConfirmations: vi.fn(async () => {}),
    expireToolConfirmation: vi.fn(async () => {}),
    markConversationRead: vi.fn(),
    deleteConversation: vi.fn(async () => {}),
    setOpen: vi.fn(),
    setDrawerOpen: vi.fn(),
    loadMessagesIfNeeded: vi.fn(async () => {}),
    ensureContentConnection: vi.fn(),
  })
  return store
}

export function currentFake(): ReturnType<typeof createFakeAssistantStore> {
  return (globalThis as Record<string, unknown>).__assistantFake as ReturnType<typeof createFakeAssistantStore>
}

export async function flushTwice(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
