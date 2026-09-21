<template>
  <div class="app-page templates-page">
    <FcSectionHeader title="模板市场 (DEMO)" subtitle="分类导航 + 卡片网格 + 预览弹窗" :back="true" @back="router.back()">
      <template #actions>
        <div class="search-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input v-model="searchKeyword" type="text" placeholder="搜索模板..."" class="search-input" />
        </div>
      </template>
    </FcSectionHeader>

    <!-- 分类导航 -->
    <FcFilterBar>
      <FcFilterButton v-for="cat in categories" :key="cat.value" :active="activeCategory === cat.value" @click="activeCategory = cat.value">
        {{ cat.label }}
      </FcFilterButton>
    </FcFilterBar>

    <!-- 精选横幅 -->
    <div v-if="activeCategory === 'all'" class="featured-banner">
      <div class="featured-content">
        <FcTag color="primary" size="sm">精选推荐</FcTag>
        <h2 class="featured-title">夏日创意模板合集</h2>
        <p class="featured-desc">50+ 精选模板，一键生成夏日风格作品</p>
        <FcButton type="primary" size="small">立即查看</FcButton>
      </div>
      <img src="https://picsum.photos/seed/featured/600/200" class="featured-img" />
    </div>

    <!-- 模板网格 -->
    <div class="template-grid">
      <div v-for="tpl in filteredTemplates" :key="tpl.id" class="template-card" @click="openPreview(tpl)">
        <div class="tpl-thumb">
          <img :src="tpl.thumbnail" :alt="tpl.name" loading="lazy" />
          <div class="tpl-overlay">
            <FcButton size="small" type="primary">使用模板</FcButton>
          </div>
          <FcTag v-if="tpl.tag" :color="tpl.tagColor" size="sm" class="tpl-tag">{{ tpl.tag }}</FcTag>
        </div>
        <div class="tpl-info">
          <h4 class="tpl-name">{{ tpl.name }}</h4>
          <div class="tpl-meta">
            <span class="tpl-category">{{ tpl.categoryLabel }}</span>
            <span class="tpl-usage"><i class="ri-fire-line" /> {{ tpl.usageCount }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 预览弹窗 -->
    <FcDialog v-model:open="previewVisible" :title="previewTpl?.name ?? ''" width="680px" append-to-body>
      <template v-if="previewTpl">
        <div class="preview-hero">
          <img :src="previewTpl.thumbnail" :alt="previewTpl.name" />
        </div>
        <div class="preview-details">
          <div class="preview-meta-row">
            <Avatar :src="previewTpl.authorAvatar" :name="previewTpl.author" size="small" />
            <span class="preview-author">{{ previewTpl.author }}</span>
            <span class="preview-usage"><i class="ri-fire-line" /> {{ previewTpl.usageCount }} 次使用</span>
          </div>
          <p class="preview-desc">{{ previewTpl.description }}</p>
          <div class="preview-params">
            <div v-for="p in previewTpl.params" :key="p.label" class="preview-param">
              <span class="pp-label">{{ p.label }}</span>
              <span class="pp-value">{{ p.value }}</span>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <FcButton @click="previewVisible = false">取消</FcButton>
        <FcButton type="primary"><i class="ri-sparkling-line" /> 使用此模板</FcButton>
      </template>
    </FcDialog>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevTemplatesPage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcDialog from '@/components/sdk/overlay/FcDialog.vue'
import { FcButton, FcTag } from '@/components/sdk'
import type { FcTagProps } from '@/components/sdk'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'

const router = useRouter()
const searchKeyword = ref('')
const activeCategory = ref('all')
const previewVisible = ref(false)
const previewTpl = ref<Template | null>(null)

const categories = [
  { label: '全部', value: 'all' },
  { label: '视频', value: 'video' },
  { label: '图片', value: 'image' },
  { label: '人像', value: 'portrait' },
  { label: '风景', value: 'landscape' },
  { label: '电商', value: 'ecommerce' },
  { label: '社交', value: 'social' },
]

interface Template {
  id: string; name: string; thumbnail: string; category: string; categoryLabel: string;
  tag?: string; tagColor?: FcTagProps['color']; usageCount: number; author: string; authorAvatar: string;
  description: string; params: { label: string; value: string }[];
}

const templates: Template[] = [
  { id: 't1', name: '赛博朋克城市', thumbnail: 'https://picsum.photos/seed/tpl1/400/300', category: 'landscape', categoryLabel: '风景', tag: '热门', tagColor: 'danger', usageCount: 2847, author: '创意工坊', authorAvatar: 'https://picsum.photos/seed/a1/80/80', description: '未来都市夜景，霓虹灯与雨后倒影交织', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '16:9' }] },
  { id: 't2', name: '国风水墨山水', thumbnail: 'https://picsum.photos/seed/tpl2/400/300', category: 'landscape', categoryLabel: '风景', tag: '精选', tagColor: 'primary', usageCount: 1923, author: '东方美学', authorAvatar: 'https://picsum.photos/seed/a2/80/80', description: '传统水墨画风格，云雾缭绕的山水意境', params: [{ label: '模型', value: 'SDXL' }, { label: '尺寸', value: '3:4' }] },
  { id: 't3', name: '职业形象照', thumbnail: 'https://picsum.photos/seed/tpl3/400/300', category: 'portrait', categoryLabel: '人像', usageCount: 5621, author: '人像大师', authorAvatar: 'https://picsum.photos/seed/a3/80/80', description: '专业商务形象照，自然光+浅景深', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '3:4' }] },
  { id: 't4', name: '产品白底图', thumbnail: 'https://picsum.photos/seed/tpl4/400/300', category: 'ecommerce', categoryLabel: '电商', tag: '新品', tagColor: 'success', usageCount: 8934, author: '电商视觉', authorAvatar: 'https://picsum.photos/seed/a4/80/80', description: '电商产品展示，纯白背景+柔和阴影', params: [{ label: '模型', value: 'SDXL' }, { label: '尺寸', value: '1:1' }] },
  { id: 't5', name: '小红书封面', thumbnail: 'https://picsum.photos/seed/tpl5/400/300', category: 'social', categoryLabel: '社交', usageCount: 3456, author: '社媒达人', authorAvatar: 'https://picsum.photos/seed/a5/80/80', description: '小红书风格封面图，清新文艺排版', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '3:4' }] },
  { id: 't6', name: '延时摄影', thumbnail: 'https://picsum.photos/seed/tpl6/400/300', category: 'video', categoryLabel: '视频', tag: '视频', tagColor: 'warning', usageCount: 1234, author: '视频工坊', authorAvatar: 'https://picsum.photos/seed/a6/80/80', description: '城市延时摄影，车流光轨+日落', params: [{ label: '模型', value: 'Kling v1.6' }, { label: '时长', value: '5s' }] },
  { id: 't7', name: '二次元少女', thumbnail: 'https://picsum.photos/seed/tpl7/400/300', category: 'portrait', categoryLabel: '人像', usageCount: 4120, author: '动漫工坊', authorAvatar: 'https://picsum.photos/seed/a7/80/80', description: '日系动漫风格人物，樱花背景', params: [{ label: '模型', value: 'SDXL' }, { label: '尺寸', value: '9:16' }] },
  { id: 't8', name: '美食特写', thumbnail: 'https://picsum.photos/seed/tpl8/400/300', category: 'image', categoryLabel: '图片', usageCount: 2156, author: '美食摄影', authorAvatar: 'https://picsum.photos/seed/a8/80/80', description: '微距美食摄影，奶油质感+暖色调', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '1:1' }] },
  { id: 't9', name: '品牌宣传片', thumbnail: 'https://picsum.photos/seed/tpl9/400/300', category: 'video', categoryLabel: '视频', tag: '视频', tagColor: 'warning', usageCount: 876, author: '品牌视觉', authorAvatar: 'https://picsum.photos/seed/a9/80/80', description: '品牌宣传短视频，动态文字+转场', params: [{ label: '模型', value: 'Kling v1.6' }, { label: '时长', value: '15s' }] },
  { id: 't10', name: '3D产品渲染', thumbnail: 'https://picsum.photos/seed/tpl10/400/300', category: 'ecommerce', categoryLabel: '电商', usageCount: 6789, author: '3D渲染师', authorAvatar: 'https://picsum.photos/seed/a10/80/80', description: '3D产品渲染，360度展示+材质细节', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '1:1' }] },
  { id: 't11', name: '朋友圈九宫格', thumbnail: 'https://picsum.photos/seed/tpl11/400/300', category: 'social', categoryLabel: '社交', usageCount: 7234, author: '社媒达人', authorAvatar: 'https://picsum.photos/seed/a11/80/80', description: '朋友圈九宫格拼图，旅行/美食/日常', params: [{ label: '模型', value: 'SDXL' }, { label: '尺寸', value: '1:1' }] },
  { id: 't12', name: '油画静物', thumbnail: 'https://picsum.photos/seed/tpl12/400/300', category: 'image', categoryLabel: '图片', usageCount: 1567, author: '艺术工坊', authorAvatar: 'https://picsum.photos/seed/a12/80/80', description: '古典油画风格，水果与花瓶', params: [{ label: '模型', value: 'FLUX Pro' }, { label: '尺寸', value: '4:3' }] },
]

const filteredTemplates = computed(() => {
  let result = templates
  if (activeCategory.value !== 'all') result = result.filter(t => t.category === activeCategory.value)
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    result = result.filter(t => t.name.toLowerCase().includes(kw) || t.description.toLowerCase().includes(kw))
  }
  return result
})

function openPreview(tpl: Template) {
  previewTpl.value = tpl
  previewVisible.value = true
}
</script>

<style scoped lang="scss">
.templates-page { display: flex; flex-direction: column; gap: 16px; }

.search-wrapper { position: relative; width: 320px; }
.search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--app-text-tertiary); pointer-events: none; }
.search-input {
  width: 100%; padding: 10px 16px 10px 48px; background: var(--app-bg-muted, #f5f5f7);
  border: 1px solid var(--el-border-color-extra-light); border-radius: var(--app-radius-input, 8px);
  font-size: var(--app-font-size-base); color: var(--app-text); outline: none; transition: border-color 0.2s;
  &:focus { border-color: var(--app-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-primary) 15%, transparent); }
  &::placeholder { color: var(--app-text-tertiary); }
}

.featured-banner {
  display: flex; align-items: center; gap: 24px; padding: 24px 32px;
  background: linear-gradient(135deg, var(--app-primary-lightest, rgba(255,107,0,0.08)), var(--el-bg-color, #fff));
  border: 1px solid var(--app-section-border-color); border-radius: var(--app-radius-lg, 16px); overflow: hidden;
}
.featured-content { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.featured-title { font-size: 22px; font-weight: 700; color: var(--app-text); margin: 0; }
.featured-desc { font-size: 14px; color: var(--app-text-secondary); margin: 0; }
.featured-img { width: 200px; height: 120px; border-radius: 12px; object-fit: cover; flex-shrink: 0; }

.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

.template-card {
  border-radius: var(--app-radius-md, 12px); overflow: hidden; background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-section-border-color); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
  &:hover { transform: translateY(-4px); box-shadow: var(--app-shadow-md); }
  &:hover .tpl-overlay { opacity: 1; }
}

.tpl-thumb { position: relative; aspect-ratio: 4/3; overflow: hidden; background: var(--app-bg-muted, #f5f5f7);
  img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
  .template-card:hover & img { transform: scale(1.05); }
}
.tpl-overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.2s;
}
.tpl-tag { position: absolute; top: 8px; right: 8px; }
.tpl-info { padding: 12px; }
.tpl-name { font-size: 14px; font-weight: 600; color: var(--app-text); margin: 0 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--app-text-tertiary); }
.tpl-usage { display: inline-flex; align-items: center; gap: 3px; }

// Preview dialog
.preview-hero { border-radius: 12px; overflow: hidden; margin-bottom: 16px; background: var(--app-bg-muted, #f5f5f7);
  img { width: 100%; display: block; }
}
.preview-details { display: flex; flex-direction: column; gap: 12px; }
.preview-meta-row { display: flex; align-items: center; gap: 8px; }
.preview-author { font-size: 14px; font-weight: 500; color: var(--app-text); }
.preview-usage { font-size: 12px; color: var(--app-text-tertiary); margin-left: auto; display: inline-flex; align-items: center; gap: 3px; }
.preview-desc { font-size: 14px; color: var(--app-text-secondary); margin: 0; line-height: 1.5; }
.preview-params { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.preview-param { display: flex; justify-content: space-between; padding: 8px 12px; background: var(--app-bg-muted, #f5f5f7); border-radius: 8px; }
.pp-label { font-size: 12px; color: var(--app-text-tertiary); }
.pp-value { font-size: 13px; font-weight: 500; color: var(--app-text); }
</style>
