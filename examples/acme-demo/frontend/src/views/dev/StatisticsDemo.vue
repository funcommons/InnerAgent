<template>
  <div class="app-page statistics-page">
    <FcSectionHeader title="报表统计 (DEMO)" subtitle="Mock 数据演示" :back="true" @back="router.back()">
      <template #actions>
        <div class="header-actions">
          <FcRadioGroup v-model="range" variant="button" size="small">
            <FcRadioButton value="7d">7天</FcRadioButton>
            <FcRadioButton value="30d">30天</FcRadioButton>
            <FcRadioButton value="90d">90天</FcRadioButton>
          </FcRadioGroup>
          <FcButton size="small" @click="exportCsv"><i class="ri-download-line" /> CSV</FcButton>
        </div>
      </template>
    </FcSectionHeader>

    <!-- KPI 卡 -->
    <FcSection>
      <template #header><span class="section-title">数据概览</span></template>
      <div class="kpi-row">
        <div v-for="kpi in kpiCards" :key="kpi.label" class="kpi-card">
          <div class="kpi-label">{{ kpi.label }}</div>
          <div class="kpi-value">{{ kpi.value.toLocaleString() }}</div>
          <div v-if="kpi.wow !== undefined" class="kpi-wow" :class="{ positive: kpi.wow > 0, negative: kpi.wow < 0 }">
            <i :class="kpi.wow > 0 ? 'ri-arrow-up-line' : kpi.wow < 0 ? 'ri-arrow-down-line' : 'ri-subtract-line'" />
            {{ Math.abs(kpi.wow) }}% vs 上周期
          </div>
        </div>
      </div>
    </FcSection>

    <!-- 创作趋势 + 模型排行 -->
    <div class="chart-row">
      <FcSection>
        <template #header><span class="section-title">创作趋势</span></template>
        <v-chart :option="creationChartOption" autoresize style="height: 280px" />
      </FcSection>
      <FcSection>
        <template #header><span class="section-title">模型排行</span></template>
        <v-chart :option="modelChartOption" autoresize style="height: 280px" />
      </FcSection>
    </div>

    <!-- 时段热力图 + 素材复用 -->
    <div class="chart-row">
      <FcSection>
        <template #header><span class="section-title">时段热力图</span></template>
        <v-chart :option="heatmapChartOption" autoresize style="height: 280px" />
      </FcSection>
      <FcSection>
        <template #header><span class="section-title">素材复用排行</span></template>
        <div class="asset-ranking">
          <div v-for="(item, idx) in assetStats" :key="idx" class="asset-row">
            <span class="rank">{{ idx + 1 }}</span>
            <img :src="item.thumbnailUrl" class="asset-thumb" />
            <div class="asset-info">
              <div class="asset-name">{{ item.name }}</div>
              <div class="asset-count">使用 {{ item.usageCount }} 次</div>
            </div>
          </div>
        </div>
      </FcSection>
    </div>

    <!-- 日明细 -->
    <FcSection>
      <template #header>
        <div class="daily-header">
          <span class="daily-title">每日明细</span>
          <span class="daily-summary">总作品: {{ dailyTotalWorks }} · 消耗算力: {{ dailyTotalCredits }}</span>
        </div>
      </template>
      <el-scrollbar>
        <el-table class="fc-table daily-table" :data="dailyData" row-key="date" stripe highlight-current-row :max-height="500">
          <el-table-column prop="date" label="日期" min-width="120">
            <template #default="{ row }"><span class="date-cell">{{ row.date }}</span></template>
          </el-table-column>
          <el-table-column prop="workCount" label="作品数" min-width="90">
            <template #default="{ row }"><span class="num-cell">{{ row.workCount }}</span></template>
          </el-table-column>
          <el-table-column prop="successCount" label="成功" min-width="80">
            <template #default="{ row }">
              <FcTag v-if="row.successCount > 0" color="success" size="sm">{{ row.successCount }}</FcTag>
              <span v-else class="num-zero">0</span>
            </template>
          </el-table-column>
          <el-table-column prop="failedCount" label="失败" min-width="80">
            <template #default="{ row }">
              <FcTag v-if="row.failedCount > 0" color="danger" size="sm">{{ row.failedCount }}</FcTag>
              <span v-else class="num-zero">0</span>
            </template>
          </el-table-column>
          <el-table-column prop="creditsUsed" label="算力" min-width="100">
            <template #default="{ row }"><span class="credits-cell">{{ row.creditsUsed }}</span></template>
          </el-table-column>
          <el-table-column prop="dau" label="DAU" min-width="70">
            <template #default="{ row }"><span class="dau-cell">{{ row.dau }}</span></template>
          </el-table-column>
          <template #empty><FcEmpty /></template>
        </el-table>
      </el-scrollbar>
    </FcSection>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevStatisticsPage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent } from 'echarts/components'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcTag, FcEmpty, FcButton, FcRadioGroup, FcRadioButton } from '@/components/sdk'

use([CanvasRenderer, BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent])

const router = useRouter()
const range = ref('7d')

// Mock KPI
const kpiCards = computed(() => [
  { label: '总用户', value: 12847, wow: undefined },
  { label: 'DAU', value: 3256, wow: 12.5 },
  { label: '总作品', value: 89432, wow: 23.1 },
  { label: '消耗算力', value: 1567890, wow: -5.2 },
])

// Mock creation trend
const creationChartOption = computed(() => {
  const days = range.value === '7d' ? 7 : range.value === '30d' ? 30 : 90
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
  const imageCounts = dates.map(() => Math.floor(Math.random() * 200) + 50)
  const videoCounts = dates.map(() => Math.floor(Math.random() * 80) + 10)
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['图片', '视频'], bottom: 0 },
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [
      { name: '图片', type: 'line', data: imageCounts, smooth: true, areaStyle: { opacity: 0.1 } },
      { name: '视频', type: 'line', data: videoCounts, smooth: true, areaStyle: { opacity: 0.1 } },
    ],
  }
})

// Mock model ranking
const modelChartOption = computed(() => {
  const models = ['Kling v1.6', 'Wan2.1', 'FLUX Pro', 'SDXL', 'MidJourney', 'CogVideoX', 'Playground', 'DALL-E 3', 'Stable 3', 'PixVerse']
  const counts = models.map(() => Math.floor(Math.random() * 5000) + 500).sort((a, b) => a - b)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 100, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    yAxis: { type: 'category', data: models, axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar', data: counts,
      itemStyle: { color: '#007aff', borderRadius: [0, 4, 4, 0] },
    }],
  }
})

// Mock heatmap
const heatmapChartOption = computed(() => {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const hours = Array.from({ length: 24 }, (_, i) => `${i}时`)
  const data: [number, number, number][] = []
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) {
      data.push([h, d, Math.floor(Math.random() * 100)])
    }
  }
  return {
    tooltip: { formatter: (p: { data: number[] }) => `${days[p.data[1] ?? 0]} ${hours[p.data[0] ?? 0]}<br/>${p.data[2] ?? 0} 次` },
    grid: { left: 50, right: 20, top: 20, bottom: 60 },
    xAxis: { type: 'category', data: hours, axisLabel: { fontSize: 9 } },
    yAxis: { type: 'category', data: days, axisLabel: { fontSize: 10 } },
    visualMap: { min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, textStyle: { fontSize: 10 } },
    series: [{ type: 'heatmap', data, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 10 } } }],
  }
})

// Mock asset stats
const assetStats = Array.from({ length: 8 }, (_, i) => ({
  name: `素材模板 ${String.fromCharCode(65 + i)}`,
  thumbnailUrl: `https://picsum.photos/seed/asset${i + 1}/72/72`,
  usageCount: Math.floor(Math.random() * 500) + 50,
})).sort((a, b) => b.usageCount - a.usageCount)

// Mock daily data
const dailyData = Array.from({ length: 14 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (13 - i))
  const workCount = Math.floor(Math.random() * 200) + 50
  return {
    date: d.toISOString().slice(0, 10),
    workCount,
    successCount: Math.floor(workCount * 0.9),
    failedCount: Math.floor(workCount * 0.1),
    creditsUsed: workCount * Math.floor(Math.random() * 20 + 5),
    dau: Math.floor(Math.random() * 3000) + 500,
  }
})

const dailyTotalWorks = computed(() => dailyData.reduce((s, d) => s + d.workCount, 0))
const dailyTotalCredits = computed(() => dailyData.reduce((s, d) => s + d.creditsUsed, 0))

function exportCsv() {
  const header = 'date,workCount,successCount,failedCount,creditsUsed,dau\n'
  const rows = dailyData.map(d => `${d.date},${d.workCount},${d.successCount},${d.failedCount},${d.creditsUsed},${d.dau}`).join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `demo_statistics_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('CSV 已导出')
}
</script>

<style scoped lang="scss">
.statistics-page { display: flex; flex-direction: column; gap: 16px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); } }
.kpi-card { background: var(--el-bg-color, #fff); border-radius: var(--app-radius-md, 10px); padding: 16px 20px; border: 1px solid var(--el-border-color-extra-light, #e5e5e5); }
.kpi-label { font-size: 12px; color: var(--app-text-secondary); margin-bottom: 8px; }
.kpi-value { font-size: 28px; font-weight: 700; color: var(--app-text); }
.kpi-wow { margin-top: 4px; font-size: 11px; display: flex; align-items: center; gap: 2px; &.positive { color: var(--el-color-success); } &.negative { color: var(--el-color-danger); } }
.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; @media (max-width: 1024px) { grid-template-columns: 1fr; } }
.section-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
.daily-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.daily-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
.daily-summary { font-size: 12px; color: var(--app-text-tertiary); }
.asset-ranking { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; }
.asset-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.rank { font-size: 14px; font-weight: 700; color: var(--app-text-tertiary); width: 24px; text-align: center; }
.asset-thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.asset-info { flex: 1; min-width: 0; }
.asset-name { font-size: 12px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-count { font-size: 10px; color: var(--app-text-tertiary); margin-top: 2px; }
.daily-table {
  width: 100%;
  .date-cell { font-weight: 500; color: var(--app-text); }
  .num-cell { font-weight: 600; color: var(--app-text); }
  .num-zero { color: var(--app-text-quaternary, #ccc); font-size: 13px; }
  .credits-cell { font-weight: 600; color: var(--el-color-primary); }
  .dau-cell { color: var(--app-text-secondary); font-size: 13px; }
}
</style>
