<script setup lang="ts">
/**
 * [new] 工具体检三态徽标(V17,ia_tool_registry.health_status):
 * ok=绿(健康)/ degraded=黄(漂移)/ unreachable=红(不可达);
 * NULL=未体检灰(尚无体检结论,引导执行「立即体检」)。
 */
import { computed } from 'vue'
import { HEALTH_META } from '@/stores/tools'

const props = defineProps<{ status: string | null | undefined }>()

const meta = computed(() => (props.status ? HEALTH_META[props.status] : undefined))
</script>

<template>
  <el-tooltip
    v-if="props.status"
    :content="`工具体检结论(V17):${meta?.label ?? props.status}`"
    placement="top"
  >
    <span class="health-badge" :class="`health-badge--${props.status}`">
      <span class="health-badge__dot" aria-hidden="true" />
      <span>{{ meta?.label ?? props.status }}</span>
    </span>
  </el-tooltip>
  <el-tooltip v-else content="尚未体检:在「详情」中执行立即体检生成结论" placement="top">
    <span class="health-badge health-badge--none">
      <span class="health-badge__dot" aria-hidden="true" />
      <span>未体检</span>
    </span>
  </el-tooltip>
</template>

<style scoped>
.health-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  white-space: nowrap;
}
.health-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
/* 绿=ok / 黄=degraded / 红=unreachable / 灰=未体检(NULL) */
.health-badge--ok { background: #f0f9eb; color: #529b2e; }
.health-badge--ok .health-badge__dot { background: #67c23a; }
.health-badge--degraded { background: #fdf6ec; color: #b88230; }
.health-badge--degraded .health-badge__dot { background: #e6a23c; }
.health-badge--unreachable { background: #fef0f0; color: #c45656; }
.health-badge--unreachable .health-badge__dot { background: #f56c6c; }
.health-badge--none { background: #f4f4f5; color: #909399; }
.health-badge--none .health-badge__dot { background: #c0c4cc; }
</style>
