<template>
  <div class="app-page search-page">
    <FcSectionHeader title="搜索结果 (DEMO)" subtitle="搜索栏 + 左侧筛选 + 右侧列表" :back="true" @back="router.back()">
      <template #actions>
        <div class="search-wrapper-lg">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input v-model="query" type="text" class="search-input-lg" placeholder="搜索作品、模板、提示词..." @keyup.enter="doSearch" />
          <FcButton type="primary" @click="doSearch">搜索</FcButton>
        </div>
      </template>
    </FcSectionHeader>

    <div class="search-layout">
      <!-- 左侧筛选 -->
      <aside class="filter-panel">
        <FcSection v-for="group in filterGroups" :key="group.key">
          <template #header><span class="filter-title">{{ group.label }}</span></template>
          <div class="filter-options">
            <label v-for="opt in group.options" :key="opt.value" class="filter-check" :class="{ active: filters[group.key]?.includes(opt.value) }" @click="toggleFilter(group.key, opt.value)">
              <span class="check-box">{{ filters[group.key]?.includes(opt.value) ? '✓' : '' }}</span>
              <span>{{ opt.label }}</span>
              <span class="filter-count">{{ opt.count }}</span>
            </label>
          </div>
        </FcSection>
        <FcButton size="small" @click="clearFilters">清除筛选</FcButton>
      </aside>

      <!-- 右侧结果 -->
      <main class="results-main">
        <div class="results-header">
          <span class="results-count">找到 {{ filteredResults.length }} 个结果</span>
          <FcSelect v-model="sortBy" size="small" style="width: 130px">
            <option value="relevant">相关性</option>
            <option value="newest">最新</option>
            <option value="popular">最热</option>
          </FcSelect>
        </div>

        <div v-if="filteredResults.length === 0" class="no-results">
          <i class="ri-search-line" />
          <p>未找到匹配结果，尝试调整搜索词或筛选</p>
        </div>

        <div v-else class="results-list">
          <div v-for="item in filteredResults" :key="item.id" class="result-item" @click="previewItem = item">
            <img :src="item.thumbnail" class="result-thumb" />
            <div class="result-body">
              <h4 class="result-title">{{ item.title }}</h4>
              <p class="result-desc">{{ item.description }}</p>
              <div class="result-meta">
                <FcTag :color="item.type === 'video' ? 'warning' : 'primary'" size="sm">{{ item.type === 'video' ? '视频' : '图片' }}</FcTag>
                <span class="result-author">{{ item.author }}</span>
                <span class="result-date">{{ item.date }}</span>
                <span class="result-likes"><i class="ri-heart-line" /> {{ item.likes }}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 预览弹窗 -->
    <FcDialog v-model:open="showPreview" :title="previewItem?.title ?? ''" width="600px" append-to-body>
      <template v-if="previewItem">
        <img :src="previewItem.thumbnail" style="width:100%;border-radius:12px;margin-bottom:16px" />
        <p style="color:var(--app-text-secondary);line-height:1.6">{{ previewItem.description }}</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <FcTag :color="previewItem.type === 'video' ? 'warning' : 'primary'" size="sm">{{ previewItem.type === 'video' ? '视频' : '图片' }}</FcTag>
          <span style="font-size:13px;color:var(--app-text-tertiary)">{{ previewItem.author }} · {{ previewItem.date }}</span>
        </div>
      </template>
      <template #footer>
        <FcButton @click="showPreview = false">关闭</FcButton>
        <FcButton type="primary"><i class="ri-sparkling-line" /> 使用</FcButton>
      </template>
    </FcDialog>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevSearchPage' })
import { ref, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import FcDialog from '@/components/sdk/overlay/FcDialog.vue'
import { FcButton, FcTag, FcSelect } from '@/components/sdk'

const router = useRouter()
const query = ref('赛博朋克')
const sortBy = ref('relevant')
const showPreview = ref(false)
const previewItem = ref<any>(null)
const filters = reactive<Record<string, string[]>>({})

const filterGroups = [
  { key: 'type', label: '类型', options: [
    { label: '图片', value: 'image', count: 156 },
    { label: '视频', value: 'video', count: 42 },
  ]},
  { key: 'style', label: '风格', options: [
    { label: '写实', value: 'realistic', count: 89 },
    { label: '二次元', value: 'anime', count: 67 },
    { label: '3D渲染', value: '3d', count: 34 },
    { label: '油画', value: 'oil', count: 21 },
  ]},
  { key: 'model', label: '模型', options: [
    { label: 'FLUX Pro', value: 'flux', count: 78 },
    { label: 'SDXL', value: 'sdxl', count: 56 },
    { label: 'Kling', value: 'kling', count: 23 },
  ]},
]

const allResults = Array.from({ length: 18 }, (_, i) => ({
  id: `r${i + 1}`,
  title: ['赛博朋克城市夜景', '未来都市霓虹', 'AI 生成赛博人像', '赛博朋克街道', '霓虹雨巷', '机器人特写', '未来交通', '全息投影', '数字雨', '赛博少女', '机械手臂', '城市废墟', '电子宠物', '黑客空间', '虚拟现实', '数据流', '量子计算', '深空站'][i] ?? '',
  type: i % 4 === 2 ? 'video' : 'image',
  description: '这是一段关于该作品的详细描述，展示了 AI 生成的赛博朋克风格创作，包含丰富的细节和独特的视觉效果。',
  thumbnail: `https://picsum.photos/seed/search${i + 1}/400/300`,
  author: ['创意达人', 'AI画师', '设计小王', '灵感猎手'][i % 4],
  date: `2026-07-${String(20 - i % 7).padStart(2, '0')}`,
  likes: Math.floor(Math.random() * 500) + 10,
  style: ['realistic', 'anime', '3d', 'oil'][i % 4],
  model: ['flux', 'sdxl', 'kling'][i % 3],
}))

const filteredResults = computed(() => {
  let result = allResults
  if (query.value) {
    const kw = query.value.toLowerCase()
    result = result.filter(r => r.title.toLowerCase().includes(kw) || r.description.toLowerCase().includes(kw))
  }
  const typeFilter = filters.type
  const styleFilter = filters.style
  const modelFilter = filters.model
  if (typeFilter?.length) result = result.filter(r => r.type && typeFilter.includes(r.type))
  if (styleFilter?.length) result = result.filter(r => r.style && styleFilter.includes(r.style))
  if (modelFilter?.length) result = result.filter(r => r.model && modelFilter.includes(r.model))
  return result
})

function toggleFilter(group: string, value: string) {
  if (!filters[group]) filters[group] = []
  const idx = filters[group].indexOf(value)
  if (idx === -1) filters[group].push(value)
  else filters[group].splice(idx, 1)
}

function clearFilters() {
  Object.keys(filters).forEach(k => delete filters[k])
}

function doSearch() { /* filteredResults is reactive */ }
</script>

<style scoped lang="scss">
.search-page { display: flex; flex-direction: column; gap: 16px; }
.search-wrapper-lg { display: flex; align-items: center; gap: 8px; position: relative; width: 480px; }
.search-icon { position: absolute; left: 16px; width: 20px; height: 20px; color: var(--app-text-tertiary); pointer-events: none; }
.search-input-lg {
  flex: 1; padding: 10px 16px 10px 48px; border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px) 0 0 var(--app-radius-md, 12px); font-size: 14px;
  color: var(--app-text); background: var(--el-bg-color, #fff); outline: none;
  &:focus { border-color: var(--app-primary); }
}

.search-layout { display: grid; grid-template-columns: 260px 1fr; gap: 24px; @media (max-width: 768px) { grid-template-columns: 1fr; } }
.filter-panel { display: flex; flex-direction: column; gap: 12px; }
.filter-title { font-size: 13px; font-weight: 600; color: var(--app-text); }
.filter-options { display: flex; flex-direction: column; gap: 4px; }
.filter-check {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  cursor: pointer; font-size: 13px; color: var(--app-text-secondary); transition: background 0.15s;
  &:hover { background: var(--app-bg-muted, #f5f5f7); }
  &.active { color: var(--app-primary); background: var(--app-primary-lightest, rgba(255,107,0,0.08)); }
}
.check-box { width: 16px; height: 16px; border: 1.5px solid var(--app-section-border-color); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px;
  .filter-check.active & { background: var(--app-primary); color: #fff; border-color: var(--app-primary); }
}
.filter-count { margin-left: auto; font-size: 11px; color: var(--app-text-tertiary); }

.results-main { display: flex; flex-direction: column; gap: 16px; }
.results-header { display: flex; justify-content: space-between; align-items: center; }
.results-count { font-size: 14px; color: var(--app-text-secondary); }

.no-results { text-align: center; padding: 80px 0; color: var(--app-text-tertiary); i { font-size: 48px; display: block; margin-bottom: 12px; } p { font-size: 14px; } }

.results-list { display: flex; flex-direction: column; gap: 12px; }
.result-item {
  display: flex; gap: 16px; padding: 16px; background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-section-border-color); border-radius: var(--app-radius-md, 12px);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--app-primary); box-shadow: var(--app-shadow-sm); }
}
.result-thumb { width: 160px; height: 100px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.result-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.result-title { font-size: 16px; font-weight: 600; color: var(--app-text); margin: 0; }
.result-desc { font-size: 13px; color: var(--app-text-secondary); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-meta { display: flex; align-items: center; gap: 8px; margin-top: auto; font-size: 12px; color: var(--app-text-tertiary); }
.result-likes { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; }
</style>
