<script setup lang="ts">
/**
 * [new] 统一分页器(优化建议 #20):总数(show-total,文案经 zh-cn locale)+
 * pageSize 切换 + 快速跳页 + 前后翻页,审计/工具/授权三表优先接入,六域统一。
 * 事件:page-change=翻页/跳页;size-change=每页条数变化(调用方通常需重置页码)。
 * v-model 接受可选值(兼容 PageQuery.pageNo?/pageSize? 形),内部兜底 1/10。
 */
import { computed } from 'vue'

const page = defineModel<number | undefined>('page', { required: true })
const size = defineModel<number | undefined>('size', { required: true })

withDefaults(defineProps<{
  total: number
  /** 每页条数可选项(AntD/Datadog 口径) */
  pageSizes?: number[]
}>(), { pageSizes: () => [10, 20, 50, 100] })

const emit = defineEmits<{
  'page-change': []
  'size-change': []
}>()

const pageModel = computed({
  get: () => page.value ?? 1,
  set: (v: number) => { page.value = v },
})
const sizeModel = computed({
  get: () => size.value ?? 10,
  set: (v: number) => { size.value = v },
})
</script>

<template>
  <el-pagination
    v-model:current-page="pageModel"
    v-model:page-size="sizeModel"
    class="ia-pager"
    background
    layout="total, sizes, prev, pager, next, jumper"
    :total="total"
    :page-sizes="pageSizes"
    @current-change="emit('page-change')"
    @size-change="emit('size-change')"
  />
</template>

<style scoped>
.ia-pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
