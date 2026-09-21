<script setup lang="ts">
/**
 * [new] 审计查询视图(视图清单 #4;查询/字典端点已落地 AdminAuditController,W5)。
 * 列表页三件套试点(#18):筛选区(decision/decisionSource/时间范围/fqn)+
 * 工具条(导出 CSV、列设置)+ 表格,经 IaListPage 组件组装。
 * ia_audit_log 列形对齐真实列;时间筛选(#7)value-format 无时区后缀、即输即查、
 * 已应用范围 chip;decision_source 值域由字典端点驱动(#12)。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Refresh, Search } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaListPage, { type IaListColumnDef } from '@/components/IaListPage.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import { useAuditStore, DECISION_SOURCES, AUDIT_DECISIONS } from '@/stores/audit'
import type { IaAuditLog } from '@/api/types'

const store = useAuditStore()
const detail = ref<IaAuditLog | null>(null)
const detailVisible = ref(false)
const exporting = ref(false)

/** 行内 decision_source 元信息:已知码值取中文标签,未知档位兜底 code 原样 */
const sourceMeta = (v: string) =>
  DECISION_SOURCES.find(s => s.value === v)
  ?? store.sourceOptions.find(s => s.value === v)
  ?? { value: v, label: v, desc: '' }
const decisionMeta = (v: string) => AUDIT_DECISIONS.find(d => d.value === v)
const RISK_TAGS: Record<string, 'info' | 'warning' | 'danger'> = { low: 'info', medium: 'warning', high: 'danger' }
const RISK_LABELS: Record<string, string> = { low: '低危', medium: '中危', high: '高危' }

/** 列设置(#18):key 与下方列 v-if 对应 */
const COLUMNS: IaListColumnDef[] = [
  { key: 'createTime', label: '时间' },
  { key: 'toolFqn', label: '工具' },
  { key: 'riskLevel', label: '风险' },
  { key: 'decision', label: '裁决' },
  { key: 'decisionSource', label: 'decision_source' },
  { key: 'userId', label: '用户' },
  { key: 'appId', label: '应用' },
  { key: 'durationMs', label: '耗时' },
]
const visibleColumns = ref<string[]>([])

/** 已应用时间范围(#7):from/to 任一生效即回显 chip */
const appliedRange = computed(() =>
  [store.filters.from, store.filters.to].filter(Boolean).join(' ~ '))

onMounted(() => {
  void store.loadDictionary()
  void store.load()
})

function search() {
  void store.search()
}

/** 清除已应用时间范围并立即重查(#7 chip 出口) */
function clearRange() {
  store.filters.from = ''
  store.filters.to = ''
  search()
}

function openDetail(row: IaAuditLog) {
  detail.value = row
  detailVisible.value = true
}

function prettyParams(json: string | null): string {
  if (!json) return '—'
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

// ===== 导出 CSV(#18 工具条;按当前筛选条件拉取后落本地文件) =====
const EXPORT_COLUMNS: Array<{ label: string; pick: (r: IaAuditLog) => string | number | null }> = [
  { label: 'id', pick: r => r.id },
  { label: '时间', pick: r => r.createTime },
  { label: '工具FQN', pick: r => r.toolFqn },
  { label: '裁决', pick: r => r.decision },
  { label: 'decision_source', pick: r => r.decisionSource },
  { label: '风险', pick: r => r.riskLevel },
  { label: '用户', pick: r => r.userId },
  { label: '应用', pick: r => r.appId },
  { label: '耗时ms', pick: r => r.durationMs },
  { label: '错误', pick: r => r.errorText },
  { label: '入参(脱敏)', pick: r => r.paramsMaskedJson },
]

function csvCell(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.split('"').join('""')}"`
}

async function exportCsv() {
  exporting.value = true
  try {
    const rows = await store.exportRows()
    if (!rows.length) {
      ElMessage.warning('当前筛选条件下没有可导出的记录')
      return
    }
    const csv = '﻿'
      + EXPORT_COLUMNS.map(c => csvCell(c.label)).join(',')
      + '\n'
      + rows.map(r => EXPORT_COLUMNS.map(c => csvCell(c.pick(r))).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 19).split(':').join('')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${rows.length} 条(按当前筛选条件)`)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <IaPageContainer subtitle="工具调用与授权生命周期的安全审计检索(decision_source 证明锚点)">
    <IaListPage v-model:visible-columns="visibleColumns" :columns="COLUMNS" :loading="store.loading">
      <template #filters>
        <div class="filters">
          <el-input v-model="store.filters.appId" class="f-input" placeholder="应用 ID" clearable @keyup.enter="search" />
          <el-input v-model="store.filters.userId" class="f-input" placeholder="用户 ID(数字)" clearable @keyup.enter="search" />
          <el-input v-model="store.filters.toolFqn" class="f-input" placeholder="工具 FQN(模糊)" clearable @keyup.enter="search" />
          <!-- #12:下拉值域由字典端点驱动(含 V8 expired 档),常量仅兜底 -->
          <el-select v-model="store.filters.decisionSource" class="f-select" placeholder="decision_source" clearable @change="search">
            <el-option v-for="s in store.sourceOptions" :key="s.value" :label="`${s.label}(${s.value})`" :value="s.value" />
          </el-select>
          <el-select v-model="store.filters.decision" class="f-select-sm" placeholder="裁决" clearable @change="search">
            <el-option v-for="d in AUDIT_DECISIONS" :key="d.value" :label="d.label" :value="d.value" />
          </el-select>
          <!-- #7:value-format 去时区后缀 Z(对齐服务端 LocalDateTime ISO.DATE_TIME,
               字面 Z 曾致手输值解析失败即输即查不可用);@change 合法输入即查询 -->
          <el-date-picker
            v-model="store.filters.from"
            type="datetime"
            class="f-date"
            placeholder="起始时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            @change="search"
          />
          <el-date-picker
            v-model="store.filters.to"
            type="datetime"
            class="f-date"
            placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            @change="search"
          />
          <el-button type="primary" :icon="Search" @click="search">查询</el-button>
          <el-button :icon="Refresh" @click="store.load()">刷新</el-button>
        </div>
        <div class="filter-hints">
          <el-tag v-if="appliedRange" closable size="small" type="primary" class="range-chip" @close="clearRange">
            已应用时间范围:{{ appliedRange }}
          </el-tag>
          <span v-for="s in store.sourceOptions" :key="s.value" class="hint-chip">{{ s.label }} = {{ s.desc }}</span>
        </div>
      </template>

      <template #actions>
        <el-button :icon="Download" :loading="exporting" @click="exportCsv">导出 CSV</el-button>
      </template>

      <el-table :data="store.list" row-key="id" @row-click="openDetail">
        <!-- 空态(#9) -->
        <template #empty>
          <IaEmpty description="没有符合条件的审计记录" hint="调整筛选条件或扩大时间范围后重试" />
        </template>
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('createTime')" prop="createTime" label="时间" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('toolFqn')" prop="toolFqn" label="工具" min-width="220" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.toolFqn }}</span></template>
        </el-table-column>
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('riskLevel')" label="风险" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.riskLevel" :type="RISK_TAGS[row.riskLevel as string]" size="small">{{ RISK_LABELS[row.riskLevel as string] }}</el-tag>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('decision')" label="裁决" width="80">
          <template #default="{ row }">
            <el-tag :type="decisionMeta(row.decision)?.tag" size="small">{{ decisionMeta(row.decision)?.label ?? row.decision }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('decisionSource')" label="decision_source" min-width="110">
          <template #default="{ row }">
            <el-tooltip :content="`${row.decisionSource}:${sourceMeta(row.decisionSource)?.desc ?? ''}`" placement="top">
              <span>{{ sourceMeta(row.decisionSource)?.label ?? row.decisionSource }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('userId')" prop="userId" label="用户" width="100" show-overflow-tooltip />
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('appId')" prop="appId" label="应用" width="70" align="right" />
        <el-table-column v-if="!visibleColumns.length || visibleColumns.includes('durationMs')" prop="durationMs" label="耗时(ms)" width="95" align="right" />
      </el-table>
      <!-- 统一分页器(#20):总数/pageSize 切换/快速跳页 -->
      <IaPagination
        v-model:page="store.filters.pageNo"
        v-model:size="store.filters.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="search"
      />
    </IaListPage>

    <el-drawer v-model="detailVisible" :title="`审计详情 #${detail?.id ?? ''}`" size="480px">
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item label="时间">{{ detail.createTime }}</el-descriptions-item>
        <el-descriptions-item label="工具 FQN"><span class="mono">{{ detail.toolFqn ?? '—' }}</span></el-descriptions-item>
        <el-descriptions-item label="风险等级">{{ detail.riskLevel ? `${RISK_LABELS[detail.riskLevel]}(${detail.riskLevel})` : '—' }}</el-descriptions-item>
        <el-descriptions-item label="裁决">{{ decisionMeta(detail.decision)?.label ?? detail.decision }}({{ detail.decision }})</el-descriptions-item>
        <el-descriptions-item label="decision_source">
          {{ sourceMeta(detail.decisionSource)?.label }}({{ detail.decisionSource }})
          <div class="dim">{{ sourceMeta(detail.decisionSource)?.desc }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="应用 / 用户 / 租户">{{ detail.appId }} / {{ detail.userId ?? '—' }} / {{ detail.tenantId }}</el-descriptions-item>
        <el-descriptions-item label="会话 / 运行">
          <span class="mono">{{ detail.conversationId ?? '—' }}</span> / <span class="mono">{{ detail.runId ?? '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="耗时">{{ detail.durationMs ?? '—' }} ms</el-descriptions-item>
        <el-descriptions-item v-if="detail.resultSummary" label="结果摘要">{{ detail.resultSummary }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.errorText" label="错误">
          <span class="err">{{ detail.errorText }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="入参快照(脱敏)">
          <pre class="mono params">{{ prettyParams(detail.paramsMaskedJson) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </IaPageContainer>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 12px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.f-input { width: 150px; }
.f-select { width: 200px; }
.f-select-sm { width: 130px; }
.f-date { width: 180px; }
.filter-hints { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
.hint-chip { color: #909399; font-size: 12px; }
.range-chip { font-family: ui-monospace, Menlo, Consolas, monospace; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.err { color: #c45656; }
.params { margin: 0; white-space: pre-wrap; word-break: break-all; }
:deep(.el-table__row) { cursor: pointer; }
</style>
