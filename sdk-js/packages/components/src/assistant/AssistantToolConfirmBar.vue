<script setup lang="ts">
/**
 * [adapt] AssistantToolConfirmBar — 源: $SRC/src/components/assistant/AssistantToolConfirmBar.vue。
 * 批量审批条 1:1; vue-i18n → 内置 i18n, FcButton (el-button) → IaButton (原生)。
 */
defineOptions({ name: 'AssistantToolConfirmBar' })
/**
 * AssistantToolConfirmBar — 工具调用批量审批条.
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/tool-confirmation-batch-bar.tsx:
 * - ≥2 个工具等待确认时显示; 一键全部允许/拒绝 (单个工具的决定内嵌在 timeline 行内)
 * - 到期倒计时 (useToolConfirmationCountdown); 过期后只提示"按未同意处理"
 * - 提交中 spinner + 禁用; showActions=false (取消中) 且未过期时不渲染操作按钮
 */
import { computed } from 'vue'
import { useI18n } from '../i18n'
import type { NormalizedToolCallScope } from '@inneragent/sdk-core'
import IaButton from '../ui/IaButton.vue'
import {
  useToolConfirmationCountdown,
} from './useAssistantCountdown'
import { selectedBatchDecision } from './assistantDisplay'

const props = defineProps<{
  toolCallIds: string[]
  decisions: Readonly<Record<string, boolean>>
  submitting: boolean
  showActions: boolean
  expiresAt: string
  /**
   * [new] P2-scope 任务 #15:整批约束范围摘要(经 pendingScopeDigest 提取)。
   * degraded(含旧事件缺字段归一)→ 弱提示 chip;resolved → 摘要/已注入标记。
   */
  scopeDigest?: NormalizedToolCallScope | null
}>()

const emit = defineEmits<{ decision: [approved: boolean] }>()

const { t } = useI18n()
const countdown = useToolConfirmationCountdown(() => props.expiresAt)
const expired = computed(() => countdown.value?.expired ?? false)

const selectedCount = computed(() => props.toolCallIds.filter((toolCallId) =>
  Object.prototype.hasOwnProperty.call(props.decisions, toolCallId)).length)

const batchDecision = computed(() => selectedBatchDecision(props.toolCallIds, props.decisions))

const visible = computed(() => props.showActions || expired.value)

const hint = computed(() => {
  if (expired.value) return t('assistant.confirm-batch-expired')
  if (props.submitting) return t('assistant.confirm-batch-submitting', { n: props.toolCallIds.length })
  const selected = selectedCount.value > 0
    ? t('assistant.confirm-batch-selected', { n: selectedCount.value, total: props.toolCallIds.length })
    : ''
  return t('assistant.confirm-batch-waiting', {
    n: props.toolCallIds.length,
    selected,
    time: countdown.value?.label ?? '',
  })
})
</script>

<template>
  <section
    v-if="visible && toolCallIds.length >= 2"
    class="assistant-confirm-bar"
    aria-live="polite"
    data-testid="assistant-batch-approval"
  >
    <span class="assistant-confirm-bar__icon" :class="{ 'is-spinning': submitting && !expired }">
      <i :class="expired ? 'ri-time-line' : submitting ? 'ri-loader-4-line' : 'ri-shield-check-line'" />
    </span>
    <div class="assistant-confirm-bar__main">
      <p class="assistant-confirm-bar__title">{{ t('assistant.confirm-batch-title') }}</p>
      <p class="assistant-confirm-bar__hint">{{ hint }}</p>
      <!-- [new] P2-scope 任务 #15:约束范围摘要 / 降级标记(可检视,PRD §6.1.4) -->
      <p
        v-if="scopeDigest"
        class="assistant-confirm-bar__scope"
        :class="{ 'is-degraded': scopeDigest.degraded }"
        :title="scopeDigest.summary || undefined"
        data-testid="assistant-confirm-scope"
      >
        <i :class="scopeDigest.degraded ? 'ri-shield-keyhole-line' : 'ri-guide-line'" />
        <span>{{ scopeDigest.degraded
          ? t('assistant.confirm-scope-degraded')
          : scopeDigest.summary
            ? t('assistant.confirm-scope-resolved', { summary: scopeDigest.summary })
            : t('assistant.confirm-scope-resolved-default') }}</span>
      </p>
    </div>
    <div v-if="!expired" class="assistant-confirm-bar__actions">
      <IaButton
        variant="secondary"
        size="sm"
        :disabled="submitting"
        data-testid="assistant-reject-all"
        @click="emit('decision', false)"
      >
        <i v-if="submitting && batchDecision === false" class="ri-loader-4-line is-spinning" />
        {{ t('assistant.confirm-reject-all') }}
      </IaButton>
      <IaButton
        size="sm"
        :disabled="submitting"
        data-testid="assistant-approve-all"
        @click="emit('decision', true)"
      >
        <i v-if="submitting && batchDecision === true" class="ri-loader-4-line is-spinning" />
        <i v-else class="ri-check-double-line" />
        {{ t('assistant.confirm-approve-all') }}
      </IaButton>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.assistant-confirm-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  background: var(--app-sidebar-item-hover-bg, var(--el-fill-color-light));
}

.assistant-confirm-bar__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 15px;

  &.is-spinning { animation: assistant-confirm-spin 1s linear infinite; }
}

@keyframes assistant-confirm-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.assistant-confirm-bar__main {
  flex: 1;
  min-width: 0;

  p {
    margin: 0;
  }
}

.assistant-confirm-bar__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text);
}

.assistant-confirm-bar__hint {
  margin-top: 2px;
  font-size: 11px;
  color: var(--app-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-confirm-bar__scope {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  > i {
    flex-shrink: 0;
    font-size: 12px;
  }

  /* resolved:信息性标记 */
  color: var(--app-text-secondary);
  background: var(--app-bg-muted, #f5f5f7);

  /* degraded:弱警示(PRD §6.1.4 降级语义,不阻塞确认流) */
  &.is-degraded {
    color: var(--app-color-warning, var(--el-color-warning, #e6a23c));
    background: var(--el-color-warning-light-9, #fdf6ec);
  }
}

.assistant-confirm-bar__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.is-spinning {
  animation: assistant-confirm-spin 1s linear infinite;
}
</style>
