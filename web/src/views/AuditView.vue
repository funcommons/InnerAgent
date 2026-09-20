<script setup lang="ts">
/**
 * [new] 审计查询视图(视图清单 #4)。
 * ia_audit_log 列表:按应用/用户/时间(起止)/decision_source/结果状态/工具 FQN 过滤;
 * 详情抽屉展示脱敏参数(decision_source 是「高危 100% 确认」的日志证明锚点,PRD §6.9)。
 */
import { onMounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { useAuditStore, DECISION_SOURCES, RESULT_STATUS } from '@/stores/audit'
import type { IaAuditLog } from '@/api/types'

const store = useAuditStore()
const detail = ref<IaAuditLog | null>(null)
const detailVisible = ref(false)

const sourceMeta = (v: string) => DECISION_SOURCES.find(s => s.value === v)
const statusMeta = (v: string) => RESULT_STATUS.find(s => s.value === v)
const RISK_TAGS: Record<string, 'info' | 'warning' | 'danger' | 'error'> = { low: 'info', medium: 'warning', high: 'danger', critical: 'error' }
const RISK_LABELS: Record<string, string> = { low: '低危', medium: '中危', high: '高危', critical: '严重' }

onMounted(() => {
  void store.load()
})

function search() {
  void store.search()
}

function openDetail(row: IaAuditLog) {
  detail.value = row
  detailVisible.value = true
}

function prettyParams(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
</script>

<template>
  <div class="view">
    <el-card shadow="never" class="toolbar-card">
      <div class="filters">
        <el-input v-model="store.filters.appKey" class="f-input" placeholder="appKey" clearable @keyup.enter="search" />
        <el-input v-model="store.filters.userId" class="f-input" placeholder="用户 ID" clearable @keyup.enter="search" />
        <el-input v-model="store.filters.toolFqn" class="f-input" placeholder="工具 FQN(模糊)" clearable @keyup.enter="search" />
        <el-select v-model="store.filters.decisionSource" class="f-select" placeholder="decision_source" clearable @change="search">
          <el-option v-for="s in DECISION_SOURCES" :key="s.value" :label="`${s.label}(${s.value})`" :value="s.value" />
        </el-select>
        <el-select v-model="store.filters.resultStatus" class="f-select-sm" placeholder="结果" clearable @change="search">
          <el-option v-for="s in RESULT_STATUS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-date-picker
          v-model="store.filters.from"
          type="datetime"
          class="f-date"
          placeholder="起始时间"
          value-format="YYYY-MM-DDTHH:mm:ss[Z]"
        />
        <el-date-picker
          v-model="store.filters.to"
          type="datetime"
          class="f-date"
          placeholder="结束时间"
          value-format="YYYY-MM-DDTHH:mm:ss[Z]"
        />
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="store.load()">刷新</el-button>
      </div>
      <div class="filter-hints">
        <span v-for="s in DECISION_SOURCES" :key="s.value" class="hint-chip">{{ s.label }} = {{ s.desc }}</span>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id" @row-click="openDetail">
        <el-table-column prop="occurredAt" label="时间" min-width="160" show-overflow-tooltip />
        <el-table-column prop="toolFqn" label="工具" min-width="220" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.toolFqn }}</span></template>
        </el-table-column>
        <el-table-column label="风险" width="80">
          <template #default="{ row }">
            <el-tag :type="RISK_TAGS[row.riskLevel as string]" size="small">{{ RISK_LABELS[row.riskLevel as string] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.resultStatus)?.tag" size="small">{{ statusMeta(row.resultStatus)?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="decision_source" min-width="110">
          <template #default="{ row }">
            <el-tooltip :content="`${row.decisionSource}:${sourceMeta(row.decisionSource)?.desc ?? ''}`" placement="top">
              <span>{{ sourceMeta(row.decisionSource)?.label ?? row.decisionSource }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="用户" width="120" show-overflow-tooltip />
        <el-table-column prop="appKey" label="应用" width="110" show-overflow-tooltip />
        <el-table-column prop="latencyMs" label="耗时(ms)" width="95" align="right" />
      </el-table>
      <el-pagination
        v-model:current-page="store.filters.pageNo"
        v-model:page-size="store.filters.pageSize"
        class="pager"
        layout="total, sizes, prev, pager, next"
        :total="store.total"
        :page-sizes="[10, 20, 50]"
        @current-change="store.load()"
        @size-change="search"
      />
    </el-card>

    <el-drawer v-model="detailVisible" :title="`审计详情 #${detail?.id ?? ''}`" size="480px">
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item label="时间">{{ detail.occurredAt }}</el-descriptions-item>
        <el-descriptions-item label="工具 FQN"><span class="mono">{{ detail.toolFqn }}</span></el-descriptions-item>
        <el-descriptions-item label="风险等级">{{ RISK_LABELS[detail.riskLevel] }}({{ detail.riskLevel }})</el-descriptions-item>
        <el-descriptions-item label="结果">{{ statusMeta(detail.resultStatus)?.label }}
          <span v-if="detail.errorMessage" class="err">{{ detail.errorMessage }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="decision_source">
          {{ sourceMeta(detail.decisionSource)?.label }}({{ detail.decisionSource }})
          <div class="dim">{{ sourceMeta(detail.decisionSource)?.desc }}</div>
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.confirmedBy" label="确认人">{{ detail.confirmedBy }}</el-descriptions-item>
        <el-descriptions-item label="应用 / 用户">{{ detail.appKey }} / {{ detail.userId }}
          <span v-if="detail.tenantId" class="dim">(tenant: {{ detail.tenantId }})</span>
        </el-descriptions-item>
        <el-descriptions-item label="会话 / 运行">
          <span class="mono">{{ detail.conversationId }}</span> / <span class="mono">{{ detail.runId }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="耗时">{{ detail.latencyMs }} ms</el-descriptions-item>
        <el-descriptions-item label="参数(脱敏)">
          <pre class="mono params">{{ prettyParams(detail.paramsMasked) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 12px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.f-input { width: 160px; }
.f-select { width: 190px; }
.f-select-sm { width: 100px; }
.f-date { width: 180px; }
.filter-hints { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.hint-chip { color: #909399; font-size: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.err { color: #c45656; }
.params { margin: 0; white-space: pre-wrap; word-break: break-all; }
:deep(.el-table__row) { cursor: pointer; }
</style>
