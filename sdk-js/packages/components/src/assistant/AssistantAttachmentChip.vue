<script setup lang="ts">
defineOptions({ name: 'AssistantAttachmentChip' })
/**
 * [new] P2 优化建议 #14(#12):附件 chip 单一渲染组件 —— composer 待发送列表与
 * 消息区用户气泡(发送后/历史回放)共用。
 *
 * - image 且有 previewUrl → 缩略图(SafeImage, 失败回退占位);
 * - 其余类型 → 类型图标 + 文件卡(名 + 大小 · 传输方式);
 * - removable(composer 待发送态)→ 右上角移除按钮;
 * - testId 默认沿用既有契约 `assistant-attachment-{id}`(e2e 依赖前缀,
 *   见 e2e/specs/10-attachments.spec.ts),消息区以 testId 覆写区分;
 * - hint(P2 #15)→ chip 小字提示(「大文件将以 URL 引用传输」)。
 */
import { useI18n } from '../i18n'
import SafeImage from '../ui/SafeImage.vue'
import { formatFileSize, type AssistantAttachment } from './assistantMultimodal'

const props = withDefaults(defineProps<{
  attachment: AssistantAttachment
  /** 显示移除按钮(composer 待发送态) */
  removable?: boolean
  /** 移除按钮禁用(提交/运行中) */
  removeDisabled?: boolean
  /** chip testid 覆写(消息区区分于 composer) */
  testId?: string
  /** [P2 #15] chip 小字提示(如「大文件将以 URL 引用传输」) */
  hint?: string
}>(), {
  removable: false,
  removeDisabled: false,
  testId: '',
  hint: '',
})

const emit = defineEmits<{ remove: [] }>()

const { t } = useI18n()

const chipTestId = props.testId || `assistant-attachment-${props.attachment.id}`

function iconFor(inputType: AssistantAttachment['inputType']): string {
  if (inputType === 'video') return 'ri-movie-2-line'
  if (inputType === 'audio') return 'ri-headphone-line'
  return 'ri-file-text-line'
}
</script>

<template>
  <div
    class="assistant-attachment-chip"
    :data-testid="chipTestId"
    :title="`${attachment.name} · ${attachment.transport.toUpperCase()}`"
  >
    <SafeImage
      v-if="attachment.inputType === 'image' && attachment.previewUrl"
      :src="attachment.previewUrl"
      :alt="attachment.name"
      class="assistant-attachment-chip__thumb"
    />
    <span v-else class="assistant-attachment-chip__icon">
      <i :class="iconFor(attachment.inputType)" />
    </span>
    <span class="assistant-attachment-chip__meta">
      <span class="assistant-attachment-chip__name">{{ attachment.name }}</span>
      <span class="assistant-attachment-chip__size">
        {{ formatFileSize(attachment.size) }} · {{ attachment.transport.toUpperCase() }}
      </span>
      <span v-if="hint" class="assistant-attachment-chip__hint" data-testid="assistant-attachment-url-hint">
        {{ hint }}
      </span>
    </span>
    <button
      v-if="removable"
      type="button"
      class="assistant-attachment-chip__remove fc-button-ghost"
      :data-testid="`assistant-attachment-remove-${attachment.id}`"
      :disabled="removeDisabled"
      :aria-label="t('assistant.attachment-remove')"
      @click="emit('remove')"
    >
      <i class="ri-close-line" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.assistant-attachment-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
  max-width: 190px;
  padding: 6px;
  border-radius: var(--app-radius-md);
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  background: var(--app-bg-card, transparent);
}

.assistant-attachment-chip__thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--app-radius-sm);
  object-fit: cover;
}

.assistant-attachment-chip__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--app-radius-sm);
  color: var(--app-text-secondary);
  font-size: 18px;
}

.assistant-attachment-chip__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.assistant-attachment-chip__name {
  font-size: 10px;
  font-weight: 600;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-attachment-chip__size {
  font-size: 9px;
  color: var(--app-text-secondary);
}

.assistant-attachment-chip__hint {
  font-size: 9px;
  color: var(--app-color-warning, var(--el-color-warning, #e6a23c));
}

.assistant-attachment-chip__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--app-radius-full, 9999px);
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--app-text-secondary);

  &:hover { color: var(--app-text); }
}
</style>
