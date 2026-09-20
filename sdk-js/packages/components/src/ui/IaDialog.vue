<script setup lang="ts">
defineOptions({ name: 'IaDialog', inheritAttrs: false })
/**
 * [new] IaDialog — 轻量模态确认框 (Shadow DOM 安全)。
 *
 * 决策记录 ([adapt]): 源 FcDialog 包装 el-dialog (浮层挂 document body,
 * 与 Shadow DOM 隔离冲突)。SDK 仅消费"删除会话二次确认"场景: v-model:open +
 * title + width + #footer slot + 遮罩层。实现为组件内 fixed 遮罩 + 居中卡片
 * (不 teleport —— Shadow DOM 内 fixed 相对 viewport 定位不受宿主 overflow 裁剪)。
 */
import { watch, onScopeDispose } from 'vue'

const props = withDefaults(defineProps<{
  open?: boolean
  title?: string
  width?: string | number
  closeOnClickModal?: boolean
}>(), {
  open: false,
  title: '',
  width: '420px',
  closeOnClickModal: false,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
}>()

function close(): void {
  emit('update:open', false)
  emit('close')
}

function onMaskClick(): void {
  if (props.closeOnClickModal) close()
}

// ESC 关闭 (挂在 document 上; Shadow DOM 内 keydown 冒泡可达 document)
let escHandler: ((event: KeyboardEvent) => void) | null = null

function detachEsc(): void {
  if (escHandler) {
    document.removeEventListener('keydown', escHandler)
    escHandler = null
  }
}

watch(() => props.open, (open) => {
  detachEsc()
  if (!open) return
  escHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }
  document.addEventListener('keydown', escHandler)
})

onScopeDispose(detachEsc)
</script>

<template>
  <div v-if="open" class="ia-dialog" role="dialog" aria-modal="true" v-bind="$attrs">
    <div class="ia-dialog__mask" @click="onMaskClick" />
    <div class="ia-dialog__card" :style="{ width: typeof width === 'number' ? `${width}px` : width }">
      <header class="ia-dialog__head">
        <h3 class="ia-dialog__title">{{ title }}</h3>
        <button type="button" class="ia-dialog__close" aria-label="close" @click="close">
          <i class="ri-close-line" aria-hidden="true" />
        </button>
      </header>
      <div class="ia-dialog__body"><slot /></div>
      <footer v-if="$slots.footer" class="ia-dialog__footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.ia-dialog {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
}

.ia-dialog__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}

.ia-dialog__card {
  position: relative;
  max-width: calc(100vw - 48px);
  border-radius: 12px;
  background: var(--app-bg-card, var(--ia-bg-card, #fff));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.ia-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px 10px;
}

.ia-dialog__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text, var(--ia-text, #303133));
}

.ia-dialog__close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));
}
.ia-dialog__close:hover { background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7)); }

.ia-dialog__body {
  padding: 0 16px 16px;
  font-size: 13px;
  color: var(--app-text, var(--ia-text, #303133));
  line-height: 1.6;
}

.ia-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 14px;
}
</style>
