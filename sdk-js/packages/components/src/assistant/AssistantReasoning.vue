<script setup lang="ts">
/**
 * [adapt] AssistantReasoning — 源: $SRC/src/components/assistant/AssistantReasoning.vue。
 * 推理段渲染 1:1; vue-i18n → 内置轻量 i18n。
 */
defineOptions({ name: 'AssistantReasoning' })
/**
 * AssistantReasoning — 推理段 (折叠详情 + 计时).
 *
 * 对齐旧 ReasoningThink (notification-panel/timeline.tsx:82-117):
 * - 终态 (durationMs 已有) → 「思考 (X.Xs)」
 * - 流式 + startedAtMs → 100ms 实时走表「思考 (X.Xs)」
 * - 流式无 startedAtMs → 静态「思考中」
 */
import { computed, toRef } from 'vue'
import { useI18n } from '../i18n'
import AssistantMarkdown from './AssistantMarkdown.vue'
import { useReasoningElapsedMs } from './useReasoningElapsed'

const props = withDefaults(defineProps<{
  text: string
  startedAtMs?: number
  durationMs?: number
  streaming?: boolean
}>(), { streaming: false })

const { t } = useI18n()

const elapsed = useReasoningElapsedMs(
  toRef(props, 'startedAtMs'),
  toRef(props, 'durationMs'),
  toRef(props, 'streaming'),
)

const title = computed(() => {
  const ms = elapsed.value
  if (ms !== undefined) return t('notification.reasoning-duration', { s: (ms / 1000).toFixed(1) })
  return t('notification.reasoning')
})
</script>

<template>
  <details class="assistant-reasoning">
    <summary>{{ title }}</summary>
    <AssistantMarkdown compact :content="text" />
  </details>
</template>

<style lang="scss" scoped>
.assistant-reasoning {
  min-width: 0;

  summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--app-text-secondary, var(--app-text));
    user-select: none;
  }
}
</style>
