<script setup lang="ts">
/**
 * [adapt] AssistantTimeline — 源: $SRC/src/components/assistant/AssistantTimeline.vue。
 * timeline 渲染 (reasoning/content/tool + 子 Agent 嵌套 + 行内确认) 1:1; 适配:
 * vue-i18n → 内置 i18n; FcButton → IaButton; el-icon Download → 内联 SVG;
 * getToolDisplayName → core 可注入展示名表 (默认原样展示 toolName)。
 */
defineOptions({ name: 'AssistantTimeline' })
/**
 * AssistantTimeline — 助手消息 timeline 渲染 (reasoning/content/tool + 子 Agent 嵌套).
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/notification-panel/timeline.tsx
 * (MessageTimeline/SubAgentCard/ToolCallCard 的功能性子集):
 * - reasoning: 折叠详情 (含耗时)
 * - content: 预格式化文本
 * - tool: 显示名 + 状态 + plan 摘要 + 结果; awaiting_approval 且属于当前确认批 →
 *   行内 允许/拒绝 (旧 ToolCallCard 单工具决定); 单工具批次时行内带倒计时
 *   (旧 showCountdown: toolCallIds.length === 1)
 * - 子 Agent children: reasoning/content/tool 缩进渲染, 确认批 parentToolCallId
 *   命中时子工具行内渲染决定按钮
 */
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import { getToolDisplayName, type NormalizedToolCallScope, type TimelineItem } from '@inneragent/sdk-core'
import IaButton from '../ui/IaButton.vue'
import AssistantMarkdown from './AssistantMarkdown.vue'
import AssistantReasoning from './AssistantReasoning.vue'
import AssistantScopeChip from './AssistantScopeChip.vue'
import { parseTaskMediaLinks, type TaskMediaLinkInfo } from './taskMedia'
import {
  useToolConfirmationCountdown,
} from './useAssistantCountdown'

export interface AssistantToolConfirmation {
  toolCallIds: string[]
  parentToolCallId?: string
  decisions: Readonly<Record<string, boolean>>
  submitting: boolean
  showActions: boolean
  expiresAt: string
  /**
   * [new] P2 #13:单工具批的约束范围摘要(经 normalizeToolCallScope 归一,
   * 旧事件缺字段 → degraded)。仅单工具批传递, 由行内确认卡渲染 scope chip。
   */
  scope?: NormalizedToolCallScope
}

const props = defineProps<{
  items: TimelineItem[]
  confirmation?: AssistantToolConfirmation
  streaming?: boolean
}>()

const emit = defineEmits<{ decision: [toolCallId: string, approved: boolean] }>()

const { t } = useI18n()

// ---- 子 Agent 折叠 + 进度 (对齐旧 SubAgentCard: 运行中自动展开/完成默认折叠/「已完成 x/y」) ----
type ToolTimelineItem = Extract<TimelineItem, { type: 'tool' }>
const SUB_AGENT_DONE_STATUSES: readonly string[] = ['done', 'error', 'cancelled', 'rejected', 'expired']
const SUB_AGENT_ACTIVE_STATUSES: readonly string[] = ['calling', 'awaiting_approval', 'approved']
const expandedSubAgents = ref(new Set<string>())

function subAgentExpanded(item: ToolTimelineItem): boolean {
  if (item.status === 'calling') return true
  return expandedSubAgents.value.has(item.id)
}

function toggleSubAgent(id: string) {
  const next = new Set(expandedSubAgents.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedSubAgents.value = next
}

function subAgentProgress(item: ToolTimelineItem): string {
  const children = item.children ?? []
  const total = children.filter(c => c.type === 'tool').length
  if (total === 0) return ''
  const done = children.filter(c => c.type === 'tool' && SUB_AGENT_DONE_STATUSES.includes(c.status)).length
  const active = children.filter(c => c.type === 'tool' && SUB_AGENT_ACTIVE_STATUSES.includes(c.status)).length
  if (item.status === 'calling') {
    return active > 0 ? t('assistant.subagent-progress-doing', { label: `${done}/${total}` }) : t('assistant.subagent-progress-ran', { label: total })
  }
  return t('assistant.subagent-progress-done', { label: total })
}

/** content 段媒体行预解析 (视频地址/下载地址 → 卡片, 正文剥离), 随 items 变化重算 */
const EMPTY_CONTENT_PARTS = { markdownContent: '', mediaLinks: [] as TaskMediaLinkInfo[] }
const contentPartsByIndex = computed(() =>
  props.items.map((item) =>
    item.type === 'content' ? parseTaskMediaLinks(item.text) : EMPTY_CONTENT_PARTS,
  ),
)

function contentParts(index: number) {
  return contentPartsByIndex.value[index] ?? EMPTY_CONTENT_PARTS
}

/** 单工具批次: 行内倒计时 (旧 showCountdown 语义) */
const singleToolBatch = computed(() => props.confirmation?.toolCallIds.length === 1
  ? props.confirmation
  : undefined)

function isConfirmedTool(
  id: string,
  parentToolCallId: string | undefined,
): boolean {
  const confirmation = props.confirmation
  if (!confirmation) return false
  if ((confirmation.parentToolCallId ?? undefined) !== (parentToolCallId ?? undefined)) return false
  return confirmation.toolCallIds.includes(id)
}

const countdown = useToolConfirmationCountdown(
  () => (singleToolBatch.value ? singleToolBatch.value.expiresAt : undefined),
)

function toolStatusKey(status: string): string {
  switch (status) {
    case 'preparing': return 'notification.tool-preparing'
    case 'calling': return 'notification.tool-calling'
    case 'awaiting_approval': return 'notification.tool-awaiting'
    case 'approved': return 'notification.tool-calling'
    case 'rejected': return 'notification.tool-rejected'
    case 'expired': return 'notification.tool-expired'
    case 'done': return 'notification.status-done'
    case 'error': return 'notification.status-error'
    default: return 'notification.status-cancelled'
  }
}
</script>

<template>
  <div class="assistant-timeline" data-testid="assistant-timeline">
    <template v-for="(item, index) in items" :key="`${item.type}-${index}`">
      <!-- 子 Agent 工具 (嵌套 children) -->
      <div v-if="item.type === 'tool'" class="assistant-timeline__tool-wrap">
        <div class="assistant-timeline__tool" :data-testid="`assistant-tool-${index}`">
          <i class="ri-tools-line" aria-hidden="true" />
          <span class="assistant-timeline__tool-name">{{ getToolDisplayName(item.name) }}</span>
          <span class="assistant-timeline__tool-status" :class="`is-${item.status}`">
            {{ t(toolStatusKey(item.status)) }}
          </span>
          <!-- 单工具批次的行内倒计时 -->
          <span
            v-if="isConfirmedTool(item.id, undefined) && item.status === 'awaiting_approval' && singleToolBatch && countdown && !countdown.expired"
            class="assistant-timeline__countdown"
          >
            {{ t('assistant.tool-awaiting', { time: countdown.label }) }}
          </span>
          <!-- [new] P2 #13:单工具批约束范围 chip(与批量条同组件, 可检视后批准) -->
          <AssistantScopeChip
            v-if="isConfirmedTool(item.id, undefined) && item.status === 'awaiting_approval' && singleToolBatch?.scope"
            :scope="singleToolBatch.scope"
          />
          <div v-if="item.plan" class="assistant-timeline__plan">
            <p class="assistant-timeline__plan-summary">{{ item.plan.summary }}</p>
            <p v-for="(change, ci) in item.plan.changes" :key="ci" class="assistant-timeline__plan-change">
              {{ change.field }}: {{ change.before }} → {{ change.after }}
            </p>
          </div>
          <!-- 确认操作 (根级工具) -->
          <div
            v-if="confirmation && isConfirmedTool(item.id, undefined) && item.status === 'awaiting_approval' && confirmation.showActions && !countdown?.expired"
            class="assistant-timeline__confirm"
            :data-testid="`assistant-confirm-${item.id}`"
          >
            <IaButton
              variant="secondary"
              size="sm"
              :disabled="confirmation.submitting"
              :data-testid="`assistant-reject-${item.id}`"
              @click="emit('decision', item.id, false)"
            >
              {{ t('assistant.confirm-reject') }}
            </IaButton>
            <IaButton
              size="sm"
              :disabled="confirmation.submitting"
              :data-testid="`assistant-approve-${item.id}`"
              @click="emit('decision', item.id, true)"
            >
              {{ t('assistant.confirm-approve') }}
            </IaButton>
          </div>
          <!-- 子 Agent children (折叠卡: 运行中自动展开/完成默认折叠, 对齐旧 SubAgentCard) -->
          <div v-if="item.children && item.children.length" class="assistant-timeline__children-wrap">
            <button
              type="button"
              class="assistant-timeline__children-toggle"
              :data-testid="`subagent-toggle-${index}`"
              @click="toggleSubAgent(item.id)"
            >
              <i :class="subAgentExpanded(item) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'" />
              <span v-if="subAgentProgress(item)">{{ subAgentProgress(item) }}</span>
              <span v-else>{{ item.agentName || t('assistant.subagent-default') }}</span>
            </button>
            <div v-if="subAgentExpanded(item)" class="assistant-timeline__children">
            <template v-for="(child, chi) in item.children" :key="`c-${chi}`">
              <AssistantReasoning
                v-if="child.type === 'reasoning'"
                :text="child.text"
                :started-at-ms="child.startedAtMs"
                :duration-ms="child.durationMs"
                class="assistant-timeline__child-reasoning"
              />
              <AssistantMarkdown
                v-else-if="child.type === 'content'"
                class="assistant-timeline__sub-content"
                compact
                :content="child.text"
              />
              <div v-else class="assistant-timeline__child-tool">
                <span class="assistant-timeline__tool-name">{{ getToolDisplayName(child.name) }}</span>
                <span class="assistant-timeline__tool-status" :class="`is-${child.status}`">
                  {{ t(toolStatusKey(child.status)) }}
                </span>
                <span
                  v-if="confirmation && isConfirmedTool(child.id, item.id) && child.status === 'awaiting_approval' && singleToolBatch && countdown && !countdown.expired"
                  class="assistant-timeline__countdown"
                >
                  {{ t('assistant.tool-awaiting', { time: countdown.label }) }}
                </span>
                <!-- [new] P2 #13:子 Agent 单工具批同口径 scope chip -->
                <AssistantScopeChip
                  v-if="confirmation && isConfirmedTool(child.id, item.id) && child.status === 'awaiting_approval' && singleToolBatch?.scope"
                  :scope="singleToolBatch.scope"
                />
                <div
                  v-if="confirmation && isConfirmedTool(child.id, item.id) && child.status === 'awaiting_approval' && confirmation.showActions && !countdown?.expired"
                  class="assistant-timeline__confirm"
                  :data-testid="`assistant-confirm-${child.id}`"
                >
                  <IaButton
                    variant="secondary"
                    size="sm"
                    :disabled="confirmation.submitting"
                    :data-testid="`assistant-reject-${child.id}`"
                    @click="emit('decision', child.id, false)"
                  >
                    {{ t('assistant.confirm-reject') }}
                  </IaButton>
                  <IaButton
                    size="sm"
                    :disabled="confirmation.submitting"
                    :data-testid="`assistant-approve-${child.id}`"
                    @click="emit('decision', child.id, true)"
                  >
                    {{ t('assistant.confirm-approve') }}
                  </IaButton>
                </div>
                <div v-if="child.plan" class="assistant-timeline__plan">
                  <p class="assistant-timeline__plan-summary">{{ child.plan.summary }}</p>
                  <p v-for="(change, ci) in child.plan.changes" :key="ci" class="assistant-timeline__plan-change">
                    {{ change.field }}: {{ change.before }} → {{ change.after }}
                  </p>
                </div>
              </div>
            </template>
            </div>
          </div>
          <!-- 工具结果 (非运行态, markdown 渲染对齐旧 ToolCallCard StreamMarkdown compact) -->
          <AssistantMarkdown
            v-if="item.status !== 'calling' && item.status !== 'preparing' && item.status !== 'awaiting_approval' && item.result"
            class="assistant-timeline__result"
            compact
            :content="item.result"
          />
        </div>
      </div>

      <!-- reasoning (折叠详情 + 流式计时, 对齐旧 ReasoningThink) -->
      <AssistantReasoning
        v-else-if="item.type === 'reasoning'"
        class="assistant-timeline__reasoning"
        :text="item.text"
        :started-at-ms="item.startedAtMs"
        :duration-ms="item.durationMs"
        :streaming="streaming"
      />

      <!-- content (助手消息 markdown 渲染, 对齐旧 StreamMarkdown; 媒体行抽卡对齐旧 TaskMediaLinks) -->
      <template v-else>
        <AssistantMarkdown
          class="assistant-timeline__content"
          :data-testid="`assistant-content-${index}`"
          :content="contentParts(index).markdownContent"
        />
        <div
          v-if="contentParts(index).mediaLinks.length"
          class="assistant-timeline__media-list"
        >
          <div
            v-for="(link, linkIndex) in contentParts(index).mediaLinks"
            :key="`${link.resolvedUrl}-${linkIndex}`"
            class="assistant-media-card"
          >
            <div class="assistant-media-card__info">
              <p class="assistant-media-card__label">{{ link.label }}</p>
              <a
                class="assistant-media-card__url"
                :href="link.resolvedUrl"
                target="_blank"
                rel="noreferrer"
                :title="link.resolvedUrl"
              >{{ link.resolvedUrl }}</a>
            </div>
            <a
              class="assistant-media-card__download"
              :href="link.resolvedUrl"
              target="_blank"
              rel="noreferrer"
              download
            >
              <svg class="assistant-media-card__dl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round"/>
              </svg>
              {{ t('assistant.media-download') }}
            </a>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.assistant-timeline {
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.assistant-timeline__content {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--app-text);
  word-break: break-word;
}

/* 媒体链接卡片 (对齐旧 TaskMediaLinks: 标签+链接+下载视频) */
.assistant-timeline__media-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.assistant-media-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--app-border, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  background: var(--app-surface-muted, rgba(0, 0, 0, 0.03));

  &__info {
    min-width: 0;
    flex: 1;
  }

  &__label {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--app-text-secondary, var(--app-text));
  }

  &__url {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    color: var(--app-text-secondary, var(--app-text));
    text-decoration: underline dotted;
    text-underline-offset: 2px;

    &:hover {
      color: var(--app-text);
    }
  }

  &__dl-icon {
    width: 14px;
    height: 14px;
  }

  &__download {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 8px 12px;
    border: 1px solid var(--app-primary, #409eff);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--app-primary, #409eff);
    text-decoration: none;

    &:hover {
      background: color-mix(in srgb, var(--app-primary, #409eff) 12%, transparent);
    }
  }
}

.assistant-timeline__reasoning {
  font-size: 12px;
  color: var(--app-text-secondary);

  summary {
    cursor: pointer;
    color: var(--app-text-tertiary, var(--app-text-secondary));
  }

  .assistant-timeline__reasoning-text {
    margin: 6px 0 0;
  }
}

.assistant-timeline__tool-wrap {
  /* 长会话性能: 视口外工具行跳过布局/绘制 (旧 timeline.tsx:44-49) */
  content-visibility: auto;
  contain-intrinsic-size: auto 48px;
}

.assistant-timeline__tool,
.assistant-timeline__child-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  font-size: 12px;

  > i {
    color: var(--app-text-tertiary, var(--app-text-secondary));
  }
}

.assistant-timeline__child-tool {
  padding: 6px 8px;
}

.assistant-timeline__tool-name {
  font-weight: 500;
  color: var(--app-text);
}

.assistant-timeline__tool-status {
  margin-left: auto;
  font-size: 11px;

  &.is-awaiting_approval { color: var(--el-color-warning, #e6a23c); }
  &.is-done { color: var(--el-color-success, #67c23a); }
  &.is-error { color: var(--el-color-danger, #f56c6c); }
  &.is-cancelled, &.is-rejected, &.is-expired { color: var(--app-text-tertiary, #a8abb2); }
  &.is-calling, &.is-approved, &.is-preparing { color: var(--el-color-primary, #409eff); }
}

.assistant-timeline__countdown {
  font-size: 11px;
  color: var(--el-color-warning, #e6a23c);
  font-variant-numeric: tabular-nums;
}

.assistant-timeline__confirm {
  width: 100%;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));
}

.assistant-timeline__plan {
  width: 100%;
  padding-top: 6px;
  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));
}

.assistant-timeline__plan-summary {
  margin: 0 0 4px;
  color: var(--app-text);
}

.assistant-timeline__plan-change {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--app-text-secondary);
  font-variant-numeric: tabular-nums;
}

.assistant-timeline__children-wrap {
  width: 100%;
}

.assistant-timeline__children-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  margin: 4px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: var(--app-text-secondary, var(--app-text));
  cursor: pointer;

  &:hover {
    background: var(--app-fill-color, rgba(0, 0, 0, 0.04));
  }
}

.assistant-timeline__children {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));
}

.assistant-timeline__sub-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-secondary);
  word-break: break-word;
}

.assistant-timeline__result {
  width: 100%;
  margin: 0;
  font-size: 11px;
  color: var(--app-text-secondary);
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}
</style>
