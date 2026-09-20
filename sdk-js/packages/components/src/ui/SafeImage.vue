<script setup lang="ts">
defineOptions({ name: 'IaSafeImage' })
/**
 * [adapt] SafeImage — 源: $SRC/src/components/common/SafeImage.vue 的功能性子集。
 * 图片安全渲染: src 缺失或加载失败时渲染占位 (内联 SVG, 去 element-plus 图标)。
 * SDK 仅消费附件缩略图场景 (src/alt + error 回退)。
 */
import { ref, watch, computed } from 'vue'

const props = withDefaults(defineProps<{
  src?: string | null
  alt?: string
}>(), {
  src: null,
  alt: '',
})

const emit = defineEmits<{ (e: 'error'): void; (e: 'load'): void }>()

const failed = ref(false)

watch(() => props.src, () => { failed.value = false })

const loadableSrc = computed(() => (props.src && props.src.trim()) ? props.src : null)
</script>

<template>
  <img
    v-if="!failed && loadableSrc"
    :src="loadableSrc"
    :alt="alt"
    loading="lazy"
    @error="() => { failed = true; emit('error') }"
    @load="emit('load')"
  />
  <span v-else class="safe-image__fallback" :class="{ 'is-error': failed }" role="img" :aria-label="alt">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="9" cy="10" r="1.6"/>
      <path d="m5 17 4.5-4.5L13 16l3-3 3 3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>
</template>

<style scoped>
img {
  display: block;
  max-width: 100%;
}

.safe-image__fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 44px;
  border-radius: var(--app-radius-sm, 6px);
  background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));
  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));
}
.safe-image__fallback.is-error { color: var(--app-color-danger, var(--ia-danger, #f56c6c)); }
.safe-image__fallback svg { width: 55%; height: 55%; }
</style>
