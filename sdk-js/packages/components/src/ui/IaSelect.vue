<script setup lang="ts">
defineOptions({ name: 'IaSelect', inheritAttrs: false })
/**
 * [new] IaSelect — 轻量下拉选择 (Shadow DOM 安全)。
 *
 * 决策记录 ([adapt]): 源组件 FcSelect 是 el-select 薄封装; el-select 的浮层
 * (popper) 依赖 document body 挂载, 在 Shadow DOM 内定位/层级都有兼容问题。
 * 这里用原生 <select> 重写同 API 子集 (modelValue/options/placeholder/
 * disabled/loading/size + update:modelValue) —— 原生下拉由浏览器渲染,
 * 天然隔离。loading 态仅置灰。
 */
export interface SelectOption<V = string | number> {
  label: string
  value: V
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: string | number
  options?: SelectOption[]
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  loading?: boolean
  size?: 'small' | 'default' | 'large'
}>(), {
  modelValue: undefined,
  options: () => [],
  placeholder: '',
  clearable: false,
  disabled: false,
  loading: false,
  size: 'default',
})

const emit = defineEmits<{ 'update:modelValue': [value: string | number | undefined] }>()

function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (props.clearable && raw === '__ia_placeholder__') {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', raw)
}
</script>

<template>
  <select
    class="ia-select"
    :class="[`size-${size}`, { 'is-disabled': disabled || loading, 'is-placeholder': modelValue === undefined }]"
    :value="modelValue === undefined && clearable ? '__ia_placeholder__' : (modelValue ?? '__ia_placeholder__')"
    :disabled="disabled || loading"
    v-bind="$attrs"
    @change="onChange"
  >
    <option v-if="modelValue === undefined || clearable" value="__ia_placeholder__" :disabled="!clearable">
      {{ placeholder || ' ' }}
    </option>
    <option v-for="opt in options" :key="String(opt.value)" :value="opt.value" :disabled="opt.disabled">
      {{ opt.label }}
    </option>
  </select>
</template>

<style scoped>
.ia-select {
  width: 100%;
  padding: 6px 26px 6px 10px;
  border: 1px solid var(--app-separator, var(--ia-separator, #dcdfe6));
  border-radius: var(--app-radius-md, 8px);
  background: var(--app-bg-card, var(--ia-bg-card, #fff));
  color: var(--app-text, var(--ia-text, #303133));
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23909399' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.ia-select.size-small { font-size: 12px; padding: 4px 24px 4px 8px; }
.ia-select.size-large { font-size: 14px; }

.ia-select.is-placeholder { color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2)); }

.ia-select.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ia-select:focus {
  outline: none;
  border-color: var(--app-primary, var(--ia-primary, #409eff));
}
</style>
