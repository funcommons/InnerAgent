<script setup lang="ts">
/**
 * [new] 相对时间组件(优化建议 #21,对齐 Linear/Vercel/GitHub 时间语义):
 * 默认展示相对时间(「3 分钟前」),tooltip/原生 title 携完整绝对时间(ISO),
 * 排障时仍可取精确值;<time datetime> 保留机器可读原值。
 * 支持 ISO 字符串与 epoch 毫秒(#18b 投递行两种时间源)。
 */
import { computed } from 'vue'
import type { IsoDateTime } from '@/api/common'

const props = defineProps<{
  /** ISO-8601 字符串或 epoch 毫秒;空/非法渲染 — */
  value: IsoDateTime | number | null
  /** 强制绝对时间(详情场景) */
  absolute?: boolean
}>()

const DAY_MS = 86_400_000

const date = computed<Date | null>(() => {
  if (props.value === null || props.value === undefined || props.value === '') return null
  const d = typeof props.value === 'number' ? new Date(props.value) : new Date(props.value)
  return Number.isNaN(d.getTime()) ? null : d
})

const absoluteText = computed(() => {
  if (!date.value) return ''
  return typeof props.value === 'number' ? date.value.toISOString() : String(props.value)
})

const relativeText = computed(() => {
  if (!date.value) return '—'
  const diff = date.value.getTime() - Date.now()
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? '后' : '前'
  if (abs < 45_000) return diff >= 0 ? '稍后' : '刚刚'
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${suffix}`
  if (abs < DAY_MS) return `${Math.round(abs / 3_600_000)} 小时${suffix}`
  if (abs < 30 * DAY_MS) return `${Math.round(abs / DAY_MS)} 天${suffix}`
  return date.value.toISOString().slice(0, 10)
})

const displayText = computed(() =>
  props.absolute ? (absoluteText.value || '—') : relativeText.value)
</script>

<template>
  <el-tooltip v-if="date && !absolute" :content="absoluteText" placement="top">
    <time class="ia-time" :datetime="absoluteText" :title="absoluteText">{{ relativeText }}</time>
  </el-tooltip>
  <time v-else-if="date" class="ia-time" :datetime="absoluteText">{{ displayText }}</time>
  <span v-else class="ia-time ia-time--empty">—</span>
</template>

<style scoped>
.ia-time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: default;
}
.ia-time--empty {
  color: #c0c4cc;
}
</style>
