<script setup lang="ts">
defineOptions({ name: 'InnerAgentChat' })
/**
 * [new] <inneragent-chat> 根组件 (defineCustomElement + Shadow DOM)。
 *
 * 编排: AssistantChatWindow (会话导航 + 消息流 + 输入区)。
 * - view 属性: 'chat' (默认, 当前唯一实现); 'history' / 'config' 为占位
 *   (P2/W13 配置视图), 渲染提示文案。
 * - project-id 属性: 页面上下文 project 引用 (源 assistantPage ?projectId= 语义)。
 * - Shadow DOM 隔离: 主题令牌 --ia-* 经 :host 默认值 + --app-* 映射注入,
 *   宿主样式不会污染组件, 组件样式不会泄漏到宿主。
 * - remixicon 图标样式经 <style src="./styles/remixicon-ce.css"> 注入
 *   (woff2-only 生成子集, 见该文件头), 使 <i class="ri-*"> 在 Shadow DOM 内可用。
 * - [new] P2-scope 任务 #15:确认等待(USER_CONFIRMATION_REQUIRED)到达 store 时
 *   向宿主 dispatch CustomEvent('SCOPE_RESOLVED')(bubbles+composed, 穿透
 *   Shadow 边界, 宿主元素 addEventListener 可收), detail 携带该批待确认工具的
 *   约束范围标记(PRD §6.1.4「InnerAgent 传递与呈现 scope」; scope 语义与兼容
 *   矩阵见 @inneragent/sdk-core 的 ToolCallScope/normalizeToolCallScope)。
 */
import { computed, ref, watch } from 'vue'
import { useAssistantStore, normalizeToolCallScope } from '@inneragent/sdk-core'
import AssistantChatWindow from './assistant/AssistantChatWindow.vue'
import { useI18n } from './i18n'

const props = withDefaults(defineProps<{
  view?: 'chat' | 'history' | 'config'
  projectId?: number | string | null
}>(), {
  view: 'chat',
  projectId: null,
})

const { t } = useI18n()
const store = useAssistantStore()

const rootRef = ref<HTMLElement | null>(null)

const projectIdNumber = computed<number | null>(() => {
  const parsed = Number(props.projectId)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})

const isPlaceholderView = computed(() => props.view !== 'chat')

// ---- SCOPE_RESOLVED 派发(确认等待事件的约束范围可检视时机) ----

const pendingConfirmation = computed(() => {
  const conversationId = store.selectedConversationId
  const runtime = conversationId
    ? store.conversationStates[conversationId]
    : undefined
  return runtime?.pipeline.pendingConfirmation ?? null
})

/** 同一确认批(runId:replyId)只派发一次;断线重连重放不重复打扰宿主。 */
let lastDispatchedConfirmationKey = ''

watch(pendingConfirmation, (pending) => {
  if (!pending) return
  const conversationId = store.selectedConversationId
  const root = rootRef.value
  if (!conversationId || !root) return
  const confirmationKey = `${pending.runId}:${pending.replyId}`
  if (confirmationKey === lastDispatchedConfirmationKey) return
  lastDispatchedConfirmationKey = confirmationKey
  root.dispatchEvent(new CustomEvent('SCOPE_RESOLVED', {
    bubbles: true,
    composed: true,
    detail: {
      conversationId,
      runId: pending.runId,
      replyId: pending.replyId,
      tools: (pending.toolCalls ?? []).map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        scope: normalizeToolCallScope(toolCall.scope),
      })),
    },
  }))
})
</script>

<template>
  <div ref="rootRef" class="ia-chat-root">
    <div v-if="isPlaceholderView" class="ia-chat-root__placeholder" data-testid="ia-view-placeholder">
      <p>{{ t('assistant.title') }} · view="{{ view }}"</p>
      <p class="ia-chat-root__placeholder-desc">
        history / config 视图为占位 (P2/W13); 当前实现: view="chat"。
      </p>
    </div>
    <AssistantChatWindow v-else :project-id="projectIdNumber" />
  </div>
</template>

<style src="./styles/remixicon-ce.css"></style>

<style>
/* ---- :host 主题令牌 (02-技术方案 §8.1: --ia-* 12 令牌) 与 --app-* 映射 ----
 * 宿主可在元素或 document root 上覆写 --ia-*; init({ theme }) 亦可全局注入。 */
:host {
  /* 默认令牌 */
  --ia-primary: #409eff;
  --ia-primary-contrast: #ffffff;
  --ia-bg: #ffffff;
  --ia-bg-card: #ffffff;
  --ia-bg-muted: #f5f5f7;
  --ia-text: #303133;
  --ia-text-secondary: #606266;
  --ia-text-tertiary: #a8abb2;
  --ia-separator: #e4e7ed;
  --ia-danger: #f56c6c;
  --ia-warning: #e6a23c;
  --ia-success: #67c23a;

  /* 组件消费的 --app-* 映射 (源组件沿用宿主 --app-* 变量名) */
  --app-primary: var(--ia-primary);
  --app-on-primary: var(--ia-primary-contrast);
  --app-bg: var(--ia-bg);
  --app-bg-card: var(--ia-bg-card);
  --app-bg-muted: var(--ia-bg-muted);
  --app-text: var(--ia-text);
  --app-text-secondary: var(--ia-text-secondary);
  --app-text-tertiary: var(--ia-text-tertiary);
  --app-separator: var(--ia-separator);
  --app-color-danger: var(--ia-danger);
  --app-color-warning: var(--ia-warning);
  --app-color-success: var(--ia-success);

  display: block;
  height: 100%;
  min-height: 320px;
  background: var(--ia-bg);
  color: var(--ia-text);
  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.ia-chat-root {
  height: 100%;
  min-height: 0;
}

.ia-chat-root__placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
  color: var(--ia-text-secondary);
  font-size: 13px;
}

.ia-chat-root__placeholder-desc {
  margin: 0;
  font-size: 11px;
  color: var(--ia-text-tertiary);
}
</style>
