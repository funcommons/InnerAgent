<script setup lang="ts">
defineOptions({ name: 'IaEmpty' })
/**
 * [adapt] IaEmpty — 源: $SRC/src/components/sdk/display/FcEmpty.vue。
 * 通用空态 (内联 SVG 图标, Shadow DOM 安全); vue-i18n → 内置 i18n;
 * 裁剪 grid-span/processing 预设等 SDK 未消费的子集。
 */
import { computed, useSlots } from 'vue'
import { useI18n } from '../i18n'

type EmptyType = 'empty' | 'error' | 'search' | 'no-result'

const props = withDefaults(defineProps<{
  type?: EmptyType
  title?: string
  description?: string
}>(), {
  type: 'empty',
  title: '',
  description: '',
})

const slots = useSlots()
const { t } = useI18n()

const resolvedTitle = computed(() => props.title || t('emptyState.empty'))
const hasCustomIcon = computed(() => !!slots.icon)
</script>

<template>
  <div class="ia-empty" :class="[`type-${type}`]" role="status">
    <div v-if="!hasCustomIcon" class="ia-empty__icon">
      <svg v-if="type === 'empty'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <svg v-else-if="type === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01" stroke-linecap="round"/>
      </svg>
      <svg v-else-if="type === 'search'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35" stroke-linecap="round"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35M8 8l6 6M14 8l-6 6" stroke-linecap="round"/>
      </svg>
    </div>
    <div v-else class="ia-empty__icon"><slot name="icon" /></div>

    <p v-if="!$slots.default" class="ia-empty__title">{{ resolvedTitle }}</p>
    <p v-else class="ia-empty__title"><slot /></p>

    <p v-if="description" class="ia-empty__desc">{{ description }}</p>
    <div v-if="$slots.action" class="ia-empty__action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.ia-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));
}

.ia-empty__icon {
  width: 64px;
  height: 64px;
  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));
  margin-bottom: 12px;
}
.ia-empty__icon svg { width: 100%; height: 100%; display: block; }

.ia-empty__title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));
}

.ia-empty__desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));
  max-width: 320px;
}

.ia-empty__action {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
