<script setup lang="ts">
/**
 * [new] 用量统计视图(W15,视图清单 #11;AdminUsageController)。
 * 汇总卡片(tokens 总量/调用次数/模型分布)+ 维度过滤(app/用户/日|月/时间区间)
 * + 聚合表格分页。聚合口径:COMPLETED/FAILED/CANCELLED 终态调用,token 合计仅
 * COMPLETED(FAILED 行 token 列为空);汇总卡单页拉 100 行聚合,超出如实标注截断。
 */
import { computed, onMounted, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaListPage from '@/components/IaListPage.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import { useUsageStore } from '@/stores/usage'
import { useAppContextStore } from '@/stores/appContext'

const store = useUsageStore()
const appContext = useAppContextStore()

onMounted(() => {
  void store.load()
  void store.loadOverview()
})

/** 顶栏应用上下文切换 → 重置分页并按新应用重查(页内显式 appId 过滤优先) */
watch(() => appContext.currentAppId, () => {
  store.filters.pageNo = 1
  void store.load()
  void store.loadOverview()
})

const totalTokens = computed(() =>
  (store.overview?.totalInputTokens ?? 0) + (store.overview?.totalOutputTokens ?? 0))

/** 模型分布占比(最大者为基准 100%) */
function shareOf(calls: number): number {
  const max = store.overview?.modelDistribution[0]?.calls ?? 0
  return max === 0 ? 0 : Math.round((calls / max) * 100)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function refreshAll() {
  void store.search()
  void store.loadOverview()
}
</script>

<template>
  <IaPageContainer subtitle="模型调用用量:聚合口径=终态调用(COMPLETED/FAILED/CANCELLED),token 合计仅 COMPLETED">
    <template #action>
      <el-button :icon="Refresh" @click="refreshAll">查询</el-button>
    </template>

    <!-- 汇总卡片 -->
    <div class="cards">
      <el-card shadow="never" class="card">
        <div class="card__label">调用次数(终态)</div>
        <div class="card__num">{{ store.overview?.totalCalls ?? '—' }}</div>
        <div class="card__foot dim">聚合行 {{ store.overview ? (store.overview.truncated ? '前 100(截断)' : '全量') : '…' }}</div>
      </el-card>
      <el-card shadow="never" class="card">
        <div class="card__label">输入 tokens</div>
        <div class="card__num">{{ store.overview === null ? '—' : formatTokens(store.overview.totalInputTokens) }}</div>
        <div class="card__foot dim">仅 COMPLETED 调用</div>
      </el-card>
      <el-card shadow="never" class="card">
        <div class="card__label">输出 tokens</div>
        <div class="card__num">{{ store.overview === null ? '—' : formatTokens(store.overview.totalOutputTokens) }}</div>
        <div class="card__foot dim">输入+输出合计 {{ formatTokens(totalTokens) }}</div>
      </el-card>
      <el-card shadow="never" class="card card--wide">
        <div class="card__label">模型分布(按调用次数)</div>
        <template v-if="store.overview?.modelDistribution.length">
          <div v-for="m in store.overview.modelDistribution.slice(0, 4)" :key="m.model" class="dist-row">
            <span class="mono dist-model">{{ m.model }}</span>
            <el-progress :percentage="shareOf(m.calls)" :show-text="false" :stroke-width="8" class="dist-bar" />
            <span class="dist-calls">{{ m.calls }}</span>
          </div>
        </template>
        <div v-else class="card__foot dim">窗口内无调用</div>
      </el-card>
    </div>

    <!-- 维度过滤 + 聚合表格 -->
    <IaListPage :loading="store.loading">
      <template #filters>
        <div class="toolbar">
          <el-input v-model="store.filters.userId" class="toolbar__uid" placeholder="用户 ID(数字)" clearable @keyup.enter="refreshAll" />
          <el-radio-group v-model="store.filters.granularity" @change="refreshAll">
            <el-radio-button value="DAY">按日</el-radio-button>
            <el-radio-button value="MONTH">按月</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="store.filters.from"
            type="datetime"
            placeholder="起始时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="toolbar__date"
            @change="refreshAll"
          />
          <el-date-picker
            v-model="store.filters.to"
            type="datetime"
            placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="toolbar__date"
            @change="refreshAll"
          />
          <span class="dim">数据范围随顶栏应用上下文(跨用户聚合视图);页内显式过滤优先生效</span>
        </div>
      </template>

      <el-table :data="store.list" row-key="id">
        <template #empty>
          <IaEmpty description="窗口内没有用量数据" hint="调整时间区间/用户过滤,或等待产生模型调用后查看">
            <template #action>
              <el-button :icon="Refresh" @click="refreshAll">重新查询</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column prop="statDate" label="统计周期" width="120">
          <template #default="{ row }"><span class="mono">{{ row.statDate }}</span></template>
        </el-table-column>
        <el-table-column prop="userId" label="用户" width="90">
          <template #default="{ row }">{{ row.userId ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="provider" label="服务商" width="120">
          <template #default="{ row }"><span class="mono">{{ row.provider }}</span></template>
        </el-table-column>
        <el-table-column prop="modelCode" label="模型" min-width="150">
          <template #default="{ row }"><span class="mono">{{ row.modelCode }}</span></template>
        </el-table-column>
        <el-table-column prop="calls" label="调用次数" width="100" sortable />
        <el-table-column label="输入 tokens" min-width="110">
          <template #default="{ row }">{{ row.inputTokens?.toLocaleString() ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="输出 tokens" min-width="110">
          <template #default="{ row }">{{ row.outputTokens?.toLocaleString() ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="推理 tokens" min-width="110">
          <template #default="{ row }">{{ row.reasoningTokens?.toLocaleString() ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="缓存 tokens" min-width="110">
          <template #default="{ row }">{{ row.cacheTokens?.toLocaleString() ?? '—' }}</template>
        </el-table-column>
      </el-table>
      <IaPagination
        v-model:page="store.filters.pageNo"
        v-model:size="store.filters.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="store.load()"
      />
    </IaListPage>
  </IaPageContainer>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(3, 1fr) 1.6fr; gap: 12px; }
.card__label { color: #909399; font-size: 12px; }
.card__num { font-size: 26px; font-weight: 600; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
.card__foot { font-size: 12px; }
.card--wide { grid-column: span 1; }
.dim { color: #909399; font-size: 12px; }
.dist-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.dist-model { width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dist-bar { flex: 1; }
.dist-calls { width: 48px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #606266; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar__uid { width: 140px; }
.toolbar__date { width: 180px; }
</style>
