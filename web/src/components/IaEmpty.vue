<script setup lang="ts">
/**
 * [new] 统一空态组件(优化建议 #9):图标 + 一句话 + 主 CTA。
 * 三类落点:
 *   - 表格 0 行:工具 0 行 →「注册第一个工具」;授权 0 行 →「代授工具授权」;
 *     审计/应用/模型/投递 0 行 → 说明性一句话(经 el-table #empty 插槽);
 *   - 能力未开通页面:「服务端能力未开通」+ 重新检测(衔接 #2);
 *   - 引导空态:新租户首登后给出明确下一步,不再像「页面坏了」。
 */
import { Box } from '@element-plus/icons-vue'

withDefaults(defineProps<{
  /** 一句话说明(必给,拒绝无字空态) */
  description: string
  /** 次要提示(可选) */
  hint?: string
}>(), { hint: '' })
</script>

<template>
  <div class="ia-empty" data-testid="ia-empty">
    <div class="ia-empty__icon">
      <el-icon :size="34"><Box /></el-icon>
    </div>
    <div class="ia-empty__desc">{{ description }}</div>
    <div v-if="hint" class="ia-empty__hint">{{ hint }}</div>
    <div v-if="$slots.action" class="ia-empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.ia-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 16px;
}
.ia-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #f0f2f5;
  color: #c0c4cc;
  margin-bottom: 4px;
}
.ia-empty__desc {
  color: #606266;
  font-size: 14px;
}
.ia-empty__hint {
  color: #909399;
  font-size: 12px;
}
.ia-empty__action {
  margin-top: 10px;
}
</style>
