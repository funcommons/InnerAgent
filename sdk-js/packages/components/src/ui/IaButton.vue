<script setup lang="ts">
defineOptions({ name: 'IaButton', inheritAttrs: false })
/**
 * [new] IaButton — 轻量按钮 (Shadow DOM 安全)。
 *
 * 决策记录 ([adapt]): 源组件 FcButton 是 el-button 薄封装 (element-plus)。
 * Shadow DOM 下 element-plus 样式注入有兼容问题 (样式挂 document head, 不进
 * shadow root; 拷贝进 shadow 又带全局选择器冲突), 故 SDK 内以原生元素重写
 * 同 API 子集: variant (primary/secondary/text/danger) + size + loading +
 * circle + disabled, 其余 attrs (data-testid/title/aria-*) 透传。
 */
import { computed } from 'vue'

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  circle?: boolean
  block?: boolean
  nativeType?: 'button' | 'submit' | 'reset'
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  circle: false,
  block: false,
  nativeType: 'button',
})

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const classes = computed(() => [
  'ia-button',
  `variant-${props.variant}`,
  `size-${props.size}`,
  {
    'is-loading': props.loading,
    'is-disabled': props.disabled || props.loading,
    'is-circle': props.circle,
    'is-block': props.block,
  },
])

function onClick(event: MouseEvent): void {
  if (!props.disabled && !props.loading) emit('click', event)
}
</script>

<template>
  <button
    :class="classes"
    :type="nativeType"
    :disabled="disabled || loading"
    v-bind="$attrs"
    @click="onClick"
  >
    <i v-if="loading" class="ri-loader-4-line is-spinning" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.ia-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 14px;
  border: 1px solid transparent;
  border-radius: var(--app-radius-md, 8px);
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
  user-select: none;
}

.ia-button:active:not(.is-disabled) { transform: scale(0.97); }

.ia-button.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ia-button.is-block { width: 100%; display: flex; }
.ia-button.is-circle { border-radius: 9999px; padding-left: 10px; padding-right: 10px; }

.ia-button.size-sm { font-size: 12px; padding: 5px 10px; }
.ia-button.size-md { font-size: 13px; }
.ia-button.size-lg { font-size: 14px; padding: 9px 18px; }

.ia-button.variant-primary:not(.is-disabled) {
  background: var(--app-primary, var(--ia-primary, #409eff));
  border-color: var(--app-primary, var(--ia-primary, #409eff));
  color: var(--app-on-primary, var(--ia-primary-contrast, #fff));
}
.ia-button.variant-primary:not(.is-disabled):hover {
  filter: brightness(0.95);
  box-shadow: var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.08));
}

.ia-button.variant-secondary {
  background: var(--app-bg-card, var(--ia-bg-card, #fff));
  border-color: var(--app-separator, var(--ia-separator, #dcdfe6));
  color: var(--app-text, var(--ia-text, #303133));
}
.ia-button.variant-secondary:not(.is-disabled):hover {
  border-color: var(--app-primary, var(--ia-primary, #409eff));
  color: var(--app-primary, var(--ia-primary, #409eff));
}

.ia-button.variant-text {
  background: none;
  border-color: transparent;
  color: var(--app-primary, var(--ia-primary, #409eff));
}
.ia-button.variant-text:not(.is-disabled):hover { background: rgba(64, 158, 255, 0.08); }

.ia-button.variant-danger:not(.is-disabled) {
  background: var(--app-color-danger, var(--ia-danger, #f56c6c));
  border-color: var(--app-color-danger, var(--ia-danger, #f56c6c));
  color: #fff;
}
.ia-button.variant-danger:not(.is-disabled):hover {
  filter: brightness(0.95);
  box-shadow: var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.08));
}

.is-spinning { animation: ia-button-spin 1s linear infinite; }
@keyframes ia-button-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
