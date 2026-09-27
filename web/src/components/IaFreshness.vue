<script setup lang="ts">
/**
 * [E4 · P3 2026-09-27] 数据新鲜度口径统一组件:「数据时间 HH:mm:ss」
 * + 手动刷新动作(B4 总览状态卡同款语义推广到用量/反馈)。
 * at 为本次数据完成拉取的时间(null = 尚未查询过)。
 */
import { computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'

const props = defineProps<{
  at: string | null
  loading?: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const clock = computed(() => {
  if (!props.at) return null
  const date = new Date(props.at)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('zh-CN', { hour12: false })
})
</script>

<template>
  <span class="ia-freshness" data-testid="ia-freshness">
    <template v-if="clock">数据时间 {{ clock }}</template>
    <template v-else>未查询</template>
    <el-button
      size="small"
      text
      :icon="Refresh"
      :loading="loading"
      data-testid="ia-freshness-refresh"
      @click="emit('refresh')"
    >
      刷新
    </el-button>
  </span>
</template>

<style scoped>
.ia-freshness {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
