<script setup lang="ts">
/**
 * [new] 页容器(优化建议 #19,对齐 Ant Design Pro PageContainer 范式):
 * 面包屑(域名→页名,取自路由 meta.domain/page)+ 页头(标题/副标题,
 * 页级操作经 action 插槽右置,与行内操作分级)+ 内容。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const props = defineProps<{
  /** 页头标题;缺省取路由 meta.page(再退 meta.title) */
  title?: string
  /** 页头副标题(一句话说明) */
  subtitle?: string
}>()

const route = useRoute()

const crumbs = computed(() => {
  const domain = route.meta.domain as string | undefined
  const page = (route.meta.page as string | undefined) ?? (route.meta.title as string | undefined)
  return [domain, page].filter((v): v is string => Boolean(v))
})

const pageTitle = computed(() => props.title ?? crumbs.value[crumbs.value.length - 1] ?? '')
</script>

<template>
  <div class="ia-page">
    <el-breadcrumb class="ia-page__crumbs" separator="/">
      <el-breadcrumb-item :to="{ path: '/' }">管理站</el-breadcrumb-item>
      <el-breadcrumb-item v-for="(c, i) in crumbs" :key="i">{{ c }}</el-breadcrumb-item>
    </el-breadcrumb>
    <div class="ia-page__header">
      <div class="ia-page__heading">
        <div class="ia-page__title">{{ pageTitle }}</div>
        <div v-if="subtitle" class="ia-page__subtitle">{{ subtitle }}</div>
      </div>
      <div v-if="$slots.action" class="ia-page__action">
        <slot name="action" />
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.ia-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ia-page__crumbs {
  font-size: 12px;
}
.ia-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ia-page__title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  line-height: 24px;
}
.ia-page__subtitle {
  margin-top: 2px;
  color: #909399;
  font-size: 12px;
}
.ia-page__action {
  display: flex;
  gap: 8px;
  flex: none;
}
</style>
