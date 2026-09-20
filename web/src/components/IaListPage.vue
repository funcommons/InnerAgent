<script setup lang="ts">
/**
 * [new] 列表页三件套容器(优化建议 #18,对齐 Ant Design Pro 列表页标准件):
 *   ① 筛选区(filters 插槽)+ ② 工具条(actions 插槽 + 内建「列设置」)+
 *   ③ 表格区(default 插槽,表格/分页由调用方组装)。
 * 列设置:传入 columns(label 字典)后,工具条右侧出现「列设置」;受控值
 * visibleColumns 为空数组时展示全部列。审计页为试点,后续推广到六域。
 */
import { computed } from 'vue'
import { Setting } from '@element-plus/icons-vue'

export interface IaListColumnDef {
  /** 与 el-table-column 的标识对应(调用方自行 v-if) */
  key: string
  label: string
}

const props = defineProps<{
  loading?: boolean
  /** 提供后工具条出现「列设置」 */
  columns?: IaListColumnDef[]
}>()

/** 可见列 key 集合;空数组=全部可见 */
const visibleColumns = defineModel<string[]>('visibleColumns', { default: () => [] })

const allHidden = computed(() => visibleColumns.value.length === 0)

function isColumnVisible(key: string): boolean {
  return allHidden.value || visibleColumns.value.includes(key)
}

function onColumnCheck(checked: string[]) {
  // 空集合语义为「全显」:全部取消时回退全显,保证表格至少有列可看
  visibleColumns.value = checked.length === 0 ? [] : checked
}

defineExpose({ isColumnVisible })
</script>

<template>
  <div class="ia-list-page" v-loading="props.loading">
    <!-- ① 筛选区 -->
    <el-card v-if="$slots.filters" shadow="never" class="ia-list-page__filters">
      <slot name="filters" />
    </el-card>

    <!-- ② 工具条:左侧页级/批量操作,右侧列设置 -->
    <div v-if="$slots.actions || (props.columns && props.columns.length)" class="ia-list-page__toolbar">
      <div class="ia-list-page__toolbar-left">
        <slot name="actions" />
      </div>
      <div v-if="props.columns && props.columns.length" class="ia-list-page__toolbar-right">
        <el-popover placement="bottom-end" width="200" trigger="click">
          <template #reference>
            <el-button text :icon="Setting">列设置</el-button>
          </template>
          <el-checkbox-group :model-value="allHidden ? props.columns!.map(c => c.key) : visibleColumns" @update:model-value="onColumnCheck">
            <div class="ia-list-page__column-item">
              <el-checkbox v-for="c in props.columns" :key="c.key" :value="c.key">{{ c.label }}</el-checkbox>
            </div>
          </el-checkbox-group>
        </el-popover>
      </div>
    </div>

    <!-- ③ 表格区 -->
    <el-card shadow="never">
      <slot />
    </el-card>
  </div>
</template>

<style scoped>
.ia-list-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ia-list-page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ia-list-page__toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ia-list-page__column-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
