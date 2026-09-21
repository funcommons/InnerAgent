<template>
  <div class="app-page inspiration-page">
    <FcSectionHeader title="灵感广场 (DEMO)" subtitle="Mock 数据演示" :back="true" @back="router.back()">
      <template #actions>
        <div class="search-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索灵感作品..."
            class="search-input"
          />
        </div>
      </template>
    </FcSectionHeader>

    <FcFilterBar>
      <FcFilterButton
        v-for="filter in filterOptions"
        :key="filter.value"
        :active="selectedFilter === filter.value"
        @click="selectFilter(filter.value)"
      >
        {{ filter.label }}
      </FcFilterButton>
    </FcFilterBar>

    <FcSectionCard padding="sm">
      <div class="mock-tag-cloud">
        <span
          v-for="tag in mockTags"
          :key="tag"
          class="mock-tag"
          :class="{ active: selectedTags.includes(tag) }"
          @click="toggleTag(tag)"
        >{{ tag }}</span>
      </div>
    </FcSectionCard>

    <main class="works-grid">
      <div
        v-for="work in displayWorks"
        :key="work.id"
        class="work-card"
        @click="handleWorkClick(work)"
      >
        <div class="work-thumb">
          <img :src="work.thumbnail" :alt="work.prompt" loading="lazy" />
          <span class="work-type">{{ work.type === 'video' ? 'VIDEO' : 'IMAGE' }}</span>
        </div>
        <div class="work-info">
          <p class="work-prompt">{{ work.prompt }}</p>
          <div class="work-meta">
            <span class="work-author">{{ work.author }}</span>
            <span class="work-likes"><i class="ri-heart-line" /> {{ work.likes }}</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevInspirationPage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSectionCard from '@/components/sdk/display/FcSectionCard.vue'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'
import type { WorkDetailVO } from '@/api/types'

const router = useRouter()
const searchKeyword = ref('')
const selectedFilter = ref<'all' | 'video' | 'image'>('all')
const selectedTags = ref<string[]>([])

const filterOptions = [
  { label: '全部', value: 'all' as const },
  { label: '视频', value: 'video' as const },
  { label: '图片', value: 'image' as const }
]

const mockTags = ['赛博朋克', '国风水墨', '写实人像', '二次元', '3D渲染', '油画风格', '极简主义', '科幻场景', '动物', '美食']

const mockWorks = generateMockWorks()

function generateMockWorks() {
  const prompts = [
    '赛博朋克城市夜景，霓虹灯闪烁，雨后倒影',
    '国风水墨山水画，云雾缭绕，远山近水',
    '写实人像摄影，自然光，浅景深',
    '二次元少女，樱花树下，春风拂面',
    '3D渲染产品展示，极简白色背景',
    '油画风格静物，水果与花瓶，暖色调',
    '极简主义建筑摄影，几何线条，黑白',
    '科幻太空站内部，全息投影，未来感',
    '可爱猫咪，毛绒质感，柔和光线',
    '精致法式甜点，微距摄影，奶油质感',
    '古风仙侠人物，飘逸长裙，剑气如虹',
    '未来城市天际线，飞行汽车，日落余晖',
    '水彩风格花卉，淡雅配色，留白意境',
    '机械朋克机器人，齿轮蒸汽，铜色金属',
    '梦幻森林，萤火虫，月光小径',
    '街头涂鸦艺术，色彩碰撞，城市墙绘',
  ]
  const authors = ['创意达人', 'AI画师', '设计小王', '灵感猎手', '视觉工坊', '像素诗人', '光影匠人', '色彩魔术师']
  const types: ('video' | 'image')[] = ['image', 'image', 'image', 'video', 'image', 'image', 'video', 'image']
  const tagSets = [
    ['赛博朋克', '科幻场景'], ['国风水墨', '油画风格'], ['写实人像'], ['二次元'],
    ['3D渲染', '极简主义'], ['油画风格'], ['极简主义'], ['科幻场景'],
    ['动物'], ['美食'], ['国风水墨'], ['科幻场景', '赛博朋克'],
    ['油画风格'], ['赛博朋克', '3D渲染'], ['国风水墨', '极简主义'], ['二次元', '3D渲染'],
  ]

  return prompts.map((prompt, i) => ({
    id: `mock-${i + 1}`,
    prompt,
    type: types[i % types.length] ?? 'image',
    thumbnail: `https://picsum.photos/seed/insp${i + 1}/400/300`,
    author: authors[i % authors.length],
    likes: Math.floor(Math.random() * 500) + 10,
    tags: tagSets[i] || [],
    aspectRatio: '16:9',
    resolution: '720P',
    shareTitle: prompt.slice(0, 20),
    userId: `user-${i + 1}`,
    status: 0,
    createdAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
  })) as unknown as WorkDetailVO[]
}

const displayWorks = computed(() => {
  let result = mockWorks
  if (selectedFilter.value !== 'all') {
    result = result.filter(w => w.type === selectedFilter.value)
  }
  if (selectedTags.value.length > 0) {
    result = result.filter(w => selectedTags.value.some(t => w.tags?.includes(t)))
  }
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    result = result.filter(w =>
      w.prompt.toLowerCase().includes(kw) ||
      (w.shareTitle && w.shareTitle.toLowerCase().includes(kw))
    )
  }
  return result
})

function selectFilter(value: 'all' | 'video' | 'image') {
  selectedFilter.value = value
}

function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag)
  if (idx === -1) selectedTags.value.push(tag)
  else selectedTags.value.splice(idx, 1)
}

function handleWorkClick(_work: WorkDetailVO) {
  // WorkDetailModal removed in /dev slim-down — click handler intentionally no-op.
}
</script>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.search-wrapper {
  position: relative;
  width: 320px;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  color: var(--app-text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 10px 16px 10px 48px;
  background: var(--app-bg-muted, #f5f5f7);
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: var(--app-radius-input, var(--app-radius-sm, 8px));
  font-size: var(--app-font-size-base);
  color: var(--app-text);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &:focus {
    border-color: var(--app-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-primary) 15%, transparent);
  }

  &::placeholder { color: var(--app-text-tertiary); }
}

.mock-tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mock-tag {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  background: var(--app-bg-muted, #f5f5f7);
  color: var(--app-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;

  &:hover { color: var(--app-primary); background: var(--app-primary-lightest, rgba(255,107,0,0.08)); }
  &.active { background: var(--app-primary-lightest, rgba(255,107,0,0.08)); color: var(--app-primary); border-color: var(--app-primary); }
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--app-block-mb);

  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
}

.work-card {
  border-radius: var(--app-radius-md, 12px);
  overflow: hidden;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-section-border-color);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover { transform: translateY(-4px); box-shadow: var(--app-shadow-md); }
}

.work-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--app-bg-muted, #f5f5f7);

  img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
  .work-card:hover & img { transform: scale(1.05); }
}

.work-type {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0,0,0,0.6);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  backdrop-filter: blur(4px);
}

.work-info { padding: 12px; }

.work-prompt {
  font-size: 13px;
  color: var(--app-text);
  margin: 0 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--app-text-tertiary);
}

.work-likes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
