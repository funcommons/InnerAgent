<script setup lang="ts">
/**
 * [new] 审计查询视图(视图清单 #4;查询/字典端点已落地 AdminAuditController,W5)。
 * ia_audit_log 列表:列形对齐真实列(decision/decision_source/tool_fqn/run_id/
 * params_masked_json/error_text/duration_ms/create_time)。
 * 时间筛选(#7):value-format 无时区后缀(对齐服务端 ISO.DATE_TIME LocalDateTime),
 * 输入合法即触发查询(@change),已应用范围回显为可清除 chip。
 * decision_source 是「高危 100% 确认」的日志证明锚点(PRD §6.9);确认等待超时
 * (run 终态 CANCELLED,decision_source=expired)服务端落 denied+expired 审计。
 */
import { computed, onMounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import { useAuditStore, DECISION_SOURCES, AUDIT_DECISIONS } from '@/stores/audit'
import type { IaAuditLog } from '@/api/types'

const store = useAuditStore()
const detail = ref<IaAuditLog | null>(null)
const detailVisible = ref(false)

/** 行内 decision_source 元信息:已知码值取中文标签,未知档位兜底 code 原样 */
const sourceMeta = (v: string) =>
  DECISION_SOURCES.find(s => s.value === v)
  ?? store.sourceOptions.find(s => s.value === v)
  ?? { value: v, label: v, desc: '' }
const decisionMeta = (v: string) => AUDIT_DECISIONS.find(d => d.value === v)
const RISK_TAGS: Record<string, 'info' | 'warning' | 'danger'> = { low: 'info', medium: 'warning', high: 'danger' }
const RISK_LABELS: Record<string, string> = { low: '低危', medium: '中危', high: '高危' }

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
</script>

<template>
  <div class="view">
    <el-card shadow="never" class="toolbar-card">
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
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id" @row-click="openDetail">
        <!-- 空态(#9) -->
        <template #empty>
          <IaEmpty description="没有符合条件的审计记录" hint="调整筛选条件或扩大时间范围后重试" />
        </template>
        <el-table-column prop="createTime" label="时间" min-width="160" show-overflow-tooltip />
        <el-table-column prop="toolFqn" label="工具" min-width="220" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.toolFqn }}</span></template>
        </el-table-column>
        <el-table-column label="风险" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.riskLevel" :type="RISK_TAGS[row.riskLevel as string]" size="small">{{ RISK_LABELS[row.riskLevel as string] }}</el-tag>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="裁决" width="80">
          <template #default="{ row }">
            <el-tag :type="decisionMeta(row.decision)?.tag" size="small">{{ decisionMeta(row.decision)?.label ?? row.decision }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="decision_source" min-width="110">
          <template #default="{ row }">
            <el-tooltip :content="`${row.decisionSource}:${sourceMeta(row.decisionSource)?.desc ?? ''}`" placement="top">
              <span>{{ sourceMeta(row.decisionSource)?.label ?? row.decisionSource }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="用户" width="100" show-overflow-tooltip />
        <el-table-column prop="appId" label="应用" width="70" align="right" />
        <el-table-column prop="durationMs" label="耗时(ms)" width="95" align="right" />
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
  </div>
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
.pager { margin-top: 12px; justify-content: flex-end; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.err { color: #c45656; }
.params { margin: 0; white-space: pre-wrap; word-break: break-all; }
:deep(.el-table__row) { cursor: pointer; }
</style>
