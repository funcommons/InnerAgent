<script setup lang="ts">
defineOptions({ name: 'IaTag' })
/**
 * [new] IaTag — 轻量标签/chip ([adapt]: 源 FcTag 为纯自写组件, 仅去冗余子集,
 * 保留 color/size/closable + close 事件, 供引用 chip 使用)。
 */
import { computed } from 'vue'

type TagColor = 'primary' | 'brand' | 'gray' | 'success' | 'warning' | 'danger'

const props = withDefaults(defineProps<{
  color?: TagColor
  size?: 'sm' | 'md' | 'lg'
  closable?: boolean
  disabled?: boolean
}>(), {
  color: 'primary',
  size: 'sm',
  closable: false,
  disabled: false,
})

const emit = defineEmits<{ close: [] }>()

const classes = computed(() => [
  'ia-tag',
  `color-${props.color}`,
  `size-${props.size}`,
  { 'is-disabled': props.disabled },
])
</script>

<template>
  <span class="ia-tag" :class="classes">
    <span class="ia-tag__content"><slot /></span>
    <button
      v-if="closable"
      type="button"
      class="ia-tag__close"
      :aria-label="'close'"
      :disabled="disabled"
      @click.stop="!disabled && emit('close')"
    >
      <i class="ri-close-line" aria-hidden="true" />
    </button>
  </span>
</template>

<style scoped>
.ia-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  line-height: 1.6;
  border: 1px solid transparent;
}

.ia-tag.size-sm { font-size: 11px; }
.ia-tag.size-md { font-size: 12px; padding: 3px 10px; }
.ia-tag.size-lg { font-size: 13px; padding: 4px 12px; }

.ia-tag.color-primary,
.ia-tag.color-brand {
  background: color-mix(in srgb, var(--app-primary, var(--ia-primary, #409eff)) 10%, transparent);
  color: var(--app-primary, var(--ia-primary, #409eff));
  border-color: color-mix(in srgb, var(--app-primary, var(--ia-primary, #409eff)) 25%, transparent);
}
.ia-tag.color-gray {
  background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));
  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));
  border-color: var(--app-separator, var(--ia-separator, #dcdfe6));
}
.ia-tag.color-success {
  background: color-mix(in srgb, var(--app-color-success, var(--ia-success, #67c23a)) 12%, transparent);
  color: var(--app-color-success, var(--ia-success, #67c23a));
}
.ia-tag.color-warning {
  background: color-mix(in srgb, var(--app-color-warning, var(--ia-warning, #e6a23c)) 12%, transparent);
  color: var(--app-color-warning, var(--ia-warning, #e6a23c));
}
.ia-tag.color-danger {
  background: color-mix(in srgb, var(--app-color-danger, var(--ia-danger, #f56c6c)) 12%, transparent);
  color: var(--app-color-danger, var(--ia-danger, #f56c6c));
}

.ia-tag.is-disabled { opacity: 0.5; }

.ia-tag__content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ia-tag__close {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: inherit;
  opacity: 0.7;
}
.ia-tag__close:hover { opacity: 1; }
</style>
