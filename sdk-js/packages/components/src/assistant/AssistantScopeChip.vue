<script setup lang="ts">
defineOptions({ name: 'AssistantScopeChip' })
/**
 * [new] P2 优化建议 #13(#11):约束范围(CONSTRAINT SCOPE)chip —— 单工具行内
 * 确认卡与 ≥2 工具批量审批条共用的同一渲染组件。
 *
 * - resolved → 信息性标记(摘要或「已注入本次运行」);
 * - degraded(含旧事件缺字段经 normalizeToolCallScope 归一的形态)→ 弱警示,
 *   不阻塞确认流(PRD §6.1.4 降级语义);
 * - summary 仅作 title 弱提示, 不展开。
 */
import { useI18n } from '../i18n'
import type { NormalizedToolCallScope } from '@inneragent/sdk-core'

defineProps<{ scope: NormalizedToolCallScope }>()

const { t } = useI18n()
</script>

<template>
  <p
    class="assistant-scope-chip"
    :class="{ 'is-degraded': scope.degraded }"
    :title="scope.summary || undefined"
    data-testid="assistant-confirm-scope"
  >
    <i :class="scope.degraded ? 'ri-shield-keyhole-line' : 'ri-guide-line'" />
    <span>{{ scope.degraded
      ? t('assistant.confirm-scope-degraded')
      : scope.summary
        ? t('assistant.confirm-scope-resolved', { summary: scope.summary })
        : t('assistant.confirm-scope-resolved-default') }}</span>
  </p>
</template>

<style lang="scss" scoped>
.assistant-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 4px 0 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  > i {
    flex-shrink: 0;
    font-size: 12px;
  }

  /* resolved:信息性标记 */
  color: var(--app-text-secondary);
  background: var(--app-bg-muted, #f5f5f7);

  /* degraded:弱警示(PRD §6.1.4 降级语义,不阻塞确认流) */
  &.is-degraded {
    color: var(--app-color-warning, var(--el-color-warning, #e6a23c));
    background: var(--el-color-warning-light-9, #fdf6ec);
  }
}
</style>
