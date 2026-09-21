<script setup lang="ts">
/**
 * [new] 定义导入结果表(镜像 AgentDefinitionBundle.ImportResult):
 * 计数四件套(created/updated/skipped/errors,校验失败条目只进 errors[] 不占
 * skipped)+ 条目级错误表(agentType 尽力回显,解析失败可为 null);
 * dryRun=true 时标注「预演」(零副作用,计数为将要发生的预演值)。
 */
import { computed } from 'vue'
import type { DefinitionImportResult } from '@/api/types'

const props = defineProps<{ result: DefinitionImportResult }>()

const totalAffected = computed(() => props.result.created + props.result.updated + props.result.skipped)
</script>

<template>
  <div class="import-result">
    <div class="result-badge">
      <el-tag :type="result.dryRun ? 'warning' : 'success'" effect="dark" size="small">
        {{ result.dryRun ? '预演(dryRun,零副作用)' : '导入完成' }}
      </el-tag>
      <span class="dim">有效条目 {{ totalAffected }} 条</span>
    </div>
    <div class="result-counts">
      <div class="count count--created">
        <span class="count__num">{{ result.created }}</span>
        <span class="count__label">新建</span>
      </div>
      <div class="count count--updated">
        <span class="count__num">{{ result.updated }}</span>
        <span class="count__label">覆盖更新</span>
      </div>
      <div class="count count--skipped">
        <span class="count__num">{{ result.skipped }}</span>
        <span class="count__label">冲突跳过</span>
      </div>
      <div class="count" :class="result.errors.length ? 'count--errors' : 'count--skipped'">
        <span class="count__num">{{ result.errors.length }}</span>
        <span class="count__label">条目错误</span>
      </div>
    </div>

    <el-table
      v-if="result.errors.length"
      :data="result.errors"
      size="small"
      class="error-table"
      :empty-text="'无条目级错误'"
    >
      <el-table-column label="agentType" width="180">
        <template #default="{ row }">
          <span class="mono">{{ row.agentType ?? '(解析失败,无法回显)' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="错误原因" min-width="220">
        <template #default="{ row }">{{ row.reason }}</template>
      </el-table-column>
    </el-table>
    <p v-else class="no-errors">无条目级错误(校验失败条目只进错误表,不占冲突跳过计数)</p>
  </div>
</template>

<style scoped>
.import-result { display: flex; flex-direction: column; gap: 12px; }
.result-badge { display: flex; align-items: center; gap: 8px; }
.dim { color: #909399; font-size: 12px; }
.result-counts { display: flex; gap: 8px; }
.count {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  border-radius: 6px;
  background: #f4f4f5;
}
.count__num { font-size: 20px; font-weight: 600; }
.count__label { font-size: 12px; color: #606266; }
.count--created { background: #f0f9eb; }
.count--created .count__num { color: #529b2e; }
.count--updated { background: #ecf5ff; }
.count--updated .count__num { color: #337ecc; }
.count--skipped { background: #f4f4f5; }
.count--skipped .count__num { color: #909399; }
.count--errors { background: #fef0f0; }
.count--errors .count__num { color: #c45656; }
.error-table { width: 100%; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.no-errors { margin: 0; color: #909399; font-size: 12px; }
</style>
