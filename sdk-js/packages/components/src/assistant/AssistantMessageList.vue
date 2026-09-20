<script setup lang="ts">
/**
 * [adapt] AssistantMessageList — 源: $SRC/src/components/assistant/AssistantMessageList.vue。
 * 消息流 (分段渲染/live timeline/工具确认/滚动跟随) 1:1; 适配: import 重锚到
 * core + 内置 i18n; FcButton/FcEmpty → IaButton/IaEmpty (Shadow DOM 安全)。
 */
defineOptions({ name: 'AssistantMessageList' })
/**
 * AssistantMessageList — 助手消息流.
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/message-list.tsx:
 * - 分段渲染: 用户气泡 + 该轮助手投影 (历史 messagesToTimeline 回放)
 * - 运行中/未加载完成的会话渲染 live reducer timeline (活动 run 不重复渲染历史行)
 * - 工具确认: 单工具行内决定 (AssistantTimeline) + 批量审批条 (≥2 工具)
 * - 到期自动 expireToolConfirmation (定时器 + focus/visibilitychange)
 * - 错误展示 + 重试 (loadMessages + ensureContentConnection)
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import { useAssistantStore } from '@inneragent/sdk-core'
import {
  statusIsRunning,
  messagesToTimeline,
  normalizeToolCallScope,
  pendingScopeDigest,
  type TimelineItem,
} from '@inneragent/sdk-core'
import IaButton from '../ui/IaButton.vue'
import IaEmpty from '../ui/IaEmpty.vue'
import AssistantTimeline, { type AssistantToolConfirmation } from './AssistantTimeline.vue'
import AssistantToolConfirmBar from './AssistantToolConfirmBar.vue'
import { buildSegments, type RenderableMessageSegment } from './assistantDisplay'
import { useAssistantMessageScroll } from './useAssistantMessageScroll'

const props = defineProps<{ conversationId: string }>()

const { t } = useI18n()
const store = useAssistantStore()

const runtime = computed(() => store.conversationStates[props.conversationId])

const running = computed(() => !!runtime.value && statusIsRunning(runtime.value.status))
const contentReady = computed(() => !!runtime.value
  && (runtime.value.messagesLoaded
    || !!runtime.value.messagesError
    // 新一轮 run 启动会把 messagesLoaded 置 false (持久转录过期),
    // 但 live timeline 正在实时渲染时不允许加载遮罩盖住内容
    || (showPipelineTimeline.value && runtime.value.pipeline.timeline.length > 0)))
const showPipelineTimeline = computed(() =>
  !!runtime.value && (running.value || !runtime.value.messagesLoaded))
const activeRunId = computed(() => showPipelineTimeline.value
  ? runtime.value?.pipeline.runId ?? runtime.value?.knownRunId
  : undefined)

const segments = computed<RenderableMessageSegment[]>(() =>
  buildSegments(runtime.value?.messages ?? [], activeRunId.value).map((segment) => ({
    ...segment,
    timeline: messagesToTimeline(segment.assistant),
  })))

const liveTimeline = computed<TimelineItem[]>(() =>
  runtime.value && showPipelineTimeline.value ? runtime.value.pipeline.timeline : [])

const errorMessage = computed(() =>
  runtime.value?.messagesError || runtime.value?.pipeline.error || runtime.value?.connectionError)

// [P1 #5] 断流静默提示态(store 抑制 connectionError 时由 reconnecting 驱动);
// 渲染非阻断「连接中断,自动重连中…」横幅并抑制手动重试, 恢复即消失。
const reconnecting = computed(() => !!runtime.value?.reconnecting)

// ---- 滚动跟随 (旧 use-assistant-message-scroll: 贴底/流式跟随/上滚脱离/回到底部) ----
const contentVersion = computed(() => runtime.value
  ? `${runtime.value.messagesLoaded}:${runtime.value.messages.length}:${runtime.value.pipeline.lastSequence}`
  : 'pending')
const viewportRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const {
  viewportReady,
  showBackToBottom,
  onViewportScroll,
  onWheel,
  onKeyDown,
  onTouchStart,
  onTouchMove,
  onScrollbarPointerDown,
  scrollToBottom,
} = useAssistantMessageScroll({
  viewportRef,
  contentRef,
  contentReady: () => contentReady.value,
  contentVersion: () => contentVersion.value,
  running: () => running.value,
})

const pendingConfirmation = computed(() => runtime.value?.pipeline.pendingConfirmation)

const batchConfirmation = computed(() =>
  pendingConfirmation.value && (pendingConfirmation.value.toolCalls?.length ?? 0) > 1
    ? pendingConfirmation.value
    : undefined)

const showBatchApprovalBar = computed(() => !!batchConfirmation.value
  && runtime.value?.pipeline.status !== 'cancelling')

// [new] P2-scope 任务 #15:批量确认条约束范围摘要(任一 degraded → 整批降级弱提示)
const batchScopeDigest = computed(() =>
  batchConfirmation.value
    ? pendingScopeDigest(batchConfirmation.value.toolCalls)
    : undefined)

// [new] P2 #13:单工具批的约束范围摘要 → 行内确认卡 scope chip。
// 沿用 normalizeToolCallScope 归一,旧事件(缺 scope 字段)degraded 兜底;
// 批量(≥2)走 batchScopeDigest(批量条),单工具走此摘要(行内卡)。
const singleToolScopeDigest = computed(() => {
  const pending = pendingConfirmation.value
  if (!pending || (pending.toolCalls?.length ?? 0) !== 1) return undefined
  return normalizeToolCallScope(pending.toolCalls?.[0]?.scope)
})

const confirmationBinding = computed<AssistantToolConfirmation | undefined>(() => {
  const pending = pendingConfirmation.value
  if (!pending) return undefined
  return {
    toolCallIds: (pending.toolCalls ?? []).map((toolCall) => toolCall.toolCallId),
    parentToolCallId: pending.parentToolCallId,
    decisions: pending.decisions,
    submitting: pending.submitting,
    showActions: runtime.value?.pipeline.status !== 'cancelling',
    expiresAt: pending.expiresAt,
    ...(singleToolScopeDigest.value ? { scope: singleToolScopeDigest.value } : {}),
  }
})

// 到期自动提交过期 (旧 message-list useEffect 语义)
watch(pendingConfirmation, (pending) => {
  if (!pending) return
  const expiresAt = Date.parse(pending.expiresAt)
  if (!Number.isFinite(expiresAt)) {
    throw new Error('Tool confirmation expiry is invalid')
  }
  const expireIfNeeded = () => {
    if (Date.now() >= expiresAt) {
      void store.expireToolConfirmation()
    }
  }
  expireIfNeeded()
  const timer = setTimeout(expireIfNeeded, Math.max(0, expiresAt - Date.now()))
  window.addEventListener('focus', expireIfNeeded)
  document.addEventListener('visibilitychange', expireIfNeeded)
  watchCleanup(() => {
    clearTimeout(timer)
    window.removeEventListener('focus', expireIfNeeded)
    document.removeEventListener('visibilitychange', expireIfNeeded)
  })
}, { immediate: true })

function watchCleanup(fn: () => void): void {
  if (getCurrentScope()) onScopeDispose(fn)
}

function retry() {
  void store.loadMessagesIfNeeded(props.conversationId)
  store.ensureContentConnection()
}

function hasContent(): boolean {
  return segments.value.length > 0
    || liveTimeline.value.length > 0
    || !!pendingConfirmation.value
    || !!errorMessage.value
}
</script>

<template>
  <div v-if="runtime" class="assistant-messages" data-testid="assistant-message-list">
    <div
      ref="viewportRef"
      class="assistant-messages__scroll"
      tabindex="0"
      :data-ready="viewportReady ? 'true' : 'false'"
      data-testid="assistant-messages-viewport"
      @scroll.passive="onViewportScroll"
      @wheel.passive="onWheel"
      @keydown="onKeyDown"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @pointerdown="onScrollbarPointerDown"
    >
      <div ref="contentRef" class="assistant-messages__content">
        <p
          v-if="runtime.messagesLoading && runtime.messages.length === 0"
          class="assistant-messages__loading"
          data-testid="assistant-messages-loading"
        >
          <i class="ri-loader-4-line is-spinning" />
          {{ t('assistant.loading-messages') }}
        </p>

        <IaEmpty
          v-if="!runtime.messagesLoading && !hasContent()"
          type="empty"
          :title="t('assistant.empty-title')"
          :description="t('assistant.empty-desc')"
          data-testid="assistant-empty"
        />

        <template v-for="segment in segments" :key="segment.key">
          <div v-if="segment.user" class="assistant-messages__user" data-testid="assistant-user-bubble">
            <p>{{ segment.user.content }}</p>
          </div>
          <AssistantTimeline class="assistant-timeline-host" :items="segment.timeline" />
        </template>

        <AssistantTimeline
          class="assistant-timeline-host"
          :items="liveTimeline"
          :confirmation="confirmationBinding"
          :streaming="running"
          @decision="(toolCallId: string, approved: boolean) => void store.respondToToolConfirmation(toolCallId, approved)"
        />

        <p
          v-if="running && liveTimeline.length === 0 && !pendingConfirmation"
          class="assistant-messages__thinking"
          data-testid="assistant-thinking"
        >
          <i class="ri-loader-4-line is-spinning" />
          {{ t('assistant.thinking') }}
        </p>

        <!-- [P1 #5] 可自动恢复的传输错误: 非阻断静默提示(自动重连中), 恢复即消失 -->
        <p
          v-if="reconnecting"
          class="assistant-messages__reconnecting"
          data-testid="assistant-reconnecting"
        >
          <i class="ri-loader-4-line is-spinning" />
          {{ t('assistant.reconnecting') }}
        </p>

        <div v-if="errorMessage" class="assistant-messages__error" data-testid="assistant-message-error">
          <i class="ri-error-warning-line" aria-hidden="true" />
          <span class="assistant-messages__error-text">{{ errorMessage }}</span>
          <IaButton variant="danger" size="sm" text data-testid="assistant-retry" @click="retry">
            <i class="ri-refresh-line" />
            {{ t('assistant.retry') }}
          </IaButton>
        </div>
      </div>
    </div>

    <div v-if="contentReady === false" class="assistant-messages__veil" data-testid="assistant-messages-veil">
      <i class="ri-loader-4-line is-spinning" />
      {{ t('assistant.loading-messages') }}
    </div>

    <!-- 回到底部 (用户上滚脱离跟随后出现, 旧 data-assistant-back-to-bottom) -->
    <button
      v-if="showBackToBottom"
      type="button"
      class="assistant-messages__back fc-button-ghost"
      data-testid="assistant-back-to-bottom"
      @click="scrollToBottom"
    >
      <i class="ri-arrow-down-line" aria-hidden="true" />
      {{ t('assistant.back-to-bottom') }}
    </button>

    <div v-if="showBatchApprovalBar && batchConfirmation" class="assistant-messages__batch">
      <AssistantToolConfirmBar
        :tool-call-ids="(batchConfirmation.toolCalls ?? []).map((toolCall) => toolCall.toolCallId)"
        :decisions="batchConfirmation.decisions"
        :submitting="batchConfirmation.submitting"
        :show-actions="runtime.pipeline.status !== 'cancelling'"
        :expires-at="batchConfirmation.expiresAt"
        :scope-digest="batchScopeDigest"
        @decision="(approved: boolean) => void store.respondToAllToolConfirmations(approved)"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.assistant-messages {
  position: relative;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.assistant-messages__scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;

  /* 揭示前不可见 (贴底初始化两帧后揭示, 旧 viewportReady opacity 过渡) */
  &[data-ready='false'] {
    opacity: 0;
  }

  &[data-ready='true'] {
    opacity: 1;
  }

  transition: opacity 0.4s ease-out;
}

.assistant-messages__back {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  background: var(--app-bg-card, #fff);
  color: var(--app-text);
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--app-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
  transition: background 0.15s ease;

  &:hover {
    background: var(--app-sidebar-item-hover-bg, #f5f5f7);
  }
}

.assistant-messages__content {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 16px 28px;
}

.assistant-messages__loading,
.assistant-messages__thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 0;
  font-size: 12px;
  color: var(--app-text-secondary);
}

/* [P1 #5] 断流静默提示条(非阻断状态条, 对齐 Figma/Linear 断网横幅范式) */
.assistant-messages__reconnecting {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--el-color-warning-light-7, #f3d19e);
  background: var(--el-color-warning-light-9, #fdf6ec);
  font-size: 12px;
  color: var(--app-color-warning, var(--el-color-warning, #e6a23c));
}

.is-spinning {
  animation: assistant-msg-spin 1s linear infinite;
}

@keyframes assistant-msg-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.assistant-messages__user,
.assistant-timeline-host {
  /* 长会话性能: 视口外行跳过布局/绘制, DOM 保持完整 (旧 timeline.tsx:44-49 同口径) */
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;
}

.assistant-messages__user {
  display: flex;
  justify-content: flex-end;

  p {
    margin: 0;
    max-width: 85%;
    padding: 9px 12px;
    border-radius: 14px;
    background: var(--el-color-primary-light-9, #ecf5ff);
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.assistant-messages__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--el-color-danger-light-7, #fde2e2);
  background: var(--el-color-danger-light-9, #fef0f0);
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);

  > i {
    margin-top: 1px;
  }
}

.assistant-messages__error-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.assistant-messages__veil {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--app-text-secondary);
  background: color-mix(in srgb, var(--app-bg, #fff) 60%, transparent);
}

.assistant-messages__batch {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  z-index: 6;
  padding: 0 14px;
  display: flex;
  justify-content: center;

  > * {
    max-width: 720px;
    width: 100%;
  }
}
</style>
