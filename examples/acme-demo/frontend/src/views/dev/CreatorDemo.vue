<template>
  <div class="app-page creator-page">
    <FcSectionHeader title="创作工作台 (DEMO)" subtitle="左右分栏 · 参数面板 + 预览区" :back="true" @back="router.back()" />

    <div class="creator-layout">
      <!-- 左侧参数面板 -->
      <aside class="creator-params">
        <FcSection>
          <template #header><span class="param-title">模型选择</span></template>
          <div class="model-grid">
            <div v-for="m in models" :key="m.id" class="model-card" :class="{ active: selectedModel === m.id }" @click="selectedModel = m.id">
              <img :src="m.icon" class="model-icon" />
              <span class="model-name">{{ m.name }}</span>
              <FcTag v-if="m.tag" :color="m.tagColor" size="sm">{{ m.tag }}</FcTag>
            </div>
          </div>
        </FcSection>

        <FcSection>
          <template #header><span class="param-title">提示词</span></template>
          <div class="prompt-area">
            <textarea v-model="prompt" class="prompt-input" rows="4" placeholder="描述你想要生成的内容..." />
            <div class="prompt-footer">
              <span class="char-count">{{ prompt.length }} / 2000</span>
              <FcButton size="small" link @click="prompt = ''">清空</FcButton>
            </div>
          </div>
          <label class="param-label">负面提示词</label>
          <textarea v-model="negativePrompt" class="prompt-input negative" rows="2" placeholder="不希望出现的内容..." />
        </FcSection>

        <FcSection>
          <template #header><span class="param-title">生成参数</span></template>
          <div class="param-group">
            <div class="param-row">
              <label>图片尺寸</label>
              <FcSelect v-model="aspectRatio" size="small" style="width: 140px">
                <option value="1:1">1:1 正方形</option>
                <option value="16:9">16:9 宽屏</option>
                <option value="9:16">9:16 竖屏</option>
                <option value="4:3">4:3 标准</option>
                <option value="3:4">3:4 竖版</option>
              </FcSelect>
            </div>
            <div class="param-row">
              <label>生成数量</label>
              <FcRadioGroup v-model="batchSize" variant="button" size="small">
                <FcRadioButton :value="1">1</FcRadioButton>
                <FcRadioButton :value="2">2</FcRadioButton>
                <FcRadioButton :value="4">4</FcRadioButton>
              </FcRadioGroup>
            </div>
            <div class="param-row">
              <label>引导系数 (CFG)</label>
              <div class="slider-row">
                <input v-model.number="cfgScale" type="range" min="1" max="20" step="0.5" class="param-slider" />
                <span class="slider-value">{{ cfgScale }}</span>
              </div>
            </div>
            <div class="param-row">
              <label>采样步数</label>
              <div class="slider-row">
                <input v-model.number="steps" type="range" min="10" max="50" step="1" class="param-slider" />
                <span class="slider-value">{{ steps }}</span>
              </div>
            </div>
            <div class="param-row">
              <label>随机种子</label>
              <div class="seed-row">
                <input v-model.number="seed" type="number" class="seed-input" placeholder="-1 随机" />
                <FcButton size="small" @click="seed = Math.floor(Math.random() * 999999999)"><i class="ri-refresh-line" /></FcButton>
              </div>
            </div>
          </div>
        </FcSection>

        <div class="generate-actions">
          <FcButton type="primary" size="large" :loading="generating" class="generate-btn" @click="handleGenerate">
            <i class="ri-sparkling-line" /> {{ generating ? '生成中...' : '开始生成' }}
          </FcButton>
          <span class="cost-hint">预计消耗 {{ batchSize * 30 }} Credits</span>
        </div>
      </aside>

      <!-- 右侧预览区 -->
      <main class="creator-preview">
        <!-- 生成结果 -->
        <div v-if="results.length > 0" class="results-grid">
          <div v-for="(r, i) in results" :key="i" class="result-card" :class="{ selected: selectedResult === i }" @click="selectedResult = i">
            <img :src="r.url" :alt="r.prompt" />
            <div class="result-overlay">
              <div class="result-actions">
                <button class="result-action" @click.stop><i class="ri-download-line" /></button>
                <button class="result-action" @click.stop><i class="ri-heart-line" /></button>
                <button class="result-action" @click.stop><i class="ri-share-line" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="preview-empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3>输入提示词开始创作</h3>
          <p>在左侧填写参数，点击「开始生成」</p>
        </div>

        <!-- 历史记录 -->
        <div v-if="history.length > 0" class="history-section">
          <div class="history-header">
            <span class="history-title">历史记录</span>
            <FcButton size="small" link @click="history = []">清空</FcButton>
          </div>
          <div class="history-grid">
            <div v-for="(h, i) in history" :key="i" class="history-thumb" @click="loadHistory(h)">
              <img :src="h.results[0]?.url" />
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevCreatorPage' })
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcButton, FcTag, FcSelect, FcRadioGroup, FcRadioButton } from '@/components/sdk'

const router = useRouter()

const selectedModel = ref('flux-pro')
const prompt = ref('')
const negativePrompt = ref('')
const aspectRatio = ref('16:9')
const batchSize = ref(4)
const cfgScale = ref(7)
const steps = ref(30)
const seed = ref(-1)
const generating = ref(false)
const selectedResult = ref(0)
const results = ref<{ url: string; prompt: string }[]>([])
const history = ref<{ prompt: string; results: { url: string; prompt: string }[] }[]>([])

const models = [
  { id: 'flux-pro', name: 'FLUX Pro', icon: 'https://picsum.photos/seed/model1/40/40', tag: '推荐', tagColor: 'primary' as const },
  { id: 'sdxl', name: 'SDXL', icon: 'https://picsum.photos/seed/model2/40/40', tag: '', tagColor: 'gray' as const },
  { id: 'kling', name: 'Kling v1.6', icon: 'https://picsum.photos/seed/model3/40/40', tag: '视频', tagColor: 'warning' as const },
  { id: 'midj', name: 'MidJourney', icon: 'https://picsum.photos/seed/model4/40/40', tag: '', tagColor: 'gray' as const },
]

async function handleGenerate() {
  if (!prompt.value.trim()) { ElMessage.warning('请输入提示词'); return }
  generating.value = true
  results.value = []
  await new Promise(r => setTimeout(r, 1500))
  const w = aspectRatio.value === '1:1' ? 400 : aspectRatio.value === '9:16' ? 270 : 400
  const h = aspectRatio.value === '1:1' ? 400 : aspectRatio.value === '9:16' ? 480 : 225
  results.value = Array.from({ length: batchSize.value }, (_, i) => ({
    url: `https://picsum.photos/seed/gen${Date.now()}${i}/${w}/${h}`,
    prompt: prompt.value,
  }))
  history.value.unshift({ prompt: prompt.value, results: [...results.value] })
  if (history.value.length > 10) history.value.pop()
  generating.value = false
  ElMessage.success('生成完成')
}

function loadHistory(h: { prompt: string; results: { url: string; prompt: string }[] }) {
  prompt.value = h.prompt
  results.value = h.results
  selectedResult.value = 0
}
</script>

<style scoped lang="scss">
.creator-page { display: flex; flex-direction: column; gap: 16px; height: calc(100vh - 120px); }
.creator-layout { display: grid; grid-template-columns: 380px 1fr; gap: 16px; flex: 1; min-height: 0; @media (max-width: 1024px) { grid-template-columns: 1fr; } }

// 左侧参数
.creator-params { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 4px; }
.param-title { font-size: 14px; font-weight: 600; color: var(--app-text); }

.model-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.model-card {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border: 2px solid var(--app-section-border-color); border-radius: var(--app-radius-md, 12px);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--app-primary-lightest); }
  &.active { border-color: var(--app-primary); background: var(--app-primary-lightest, rgba(255,107,0,0.08)); }
}
.model-icon { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.model-name { font-size: 13px; font-weight: 500; color: var(--app-text); flex: 1; }

.prompt-area { display: flex; flex-direction: column; gap: 4px; }
.prompt-input {
  width: 100%; padding: 12px; border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px); font-size: 14px; color: var(--app-text);
  background: var(--el-bg-color, #fff); resize: vertical; outline: none; transition: border-color 0.2s;
  &:focus { border-color: var(--app-primary); }
  &.negative { margin-top: 8px; }
}
.prompt-footer { display: flex; justify-content: space-between; align-items: center; }
.char-count { font-size: 12px; color: var(--app-text-tertiary); }
.param-label { font-size: 13px; font-weight: 500; color: var(--app-text-secondary); margin-top: 12px; display: block; }

.param-group { display: flex; flex-direction: column; gap: 16px; }
.param-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  label { font-size: 13px; color: var(--app-text-secondary); white-space: nowrap; min-width: 100px; }
}
.slider-row { display: flex; align-items: center; gap: 8px; flex: 1; }
.param-slider { flex: 1; accent-color: var(--app-primary); }
.slider-value { font-size: 13px; font-weight: 600; color: var(--app-text); min-width: 28px; text-align: right; }
.seed-row { display: flex; gap: 4px; flex: 1; }
.seed-input {
  flex: 1; padding: 6px 10px; border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-sm, 8px); font-size: 13px; color: var(--app-text);
  background: var(--el-bg-color, #fff); outline: none;
  &:focus { border-color: var(--app-primary); }
}

.generate-actions { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 8px; }
.generate-btn { width: 100%; }
.cost-hint { font-size: 12px; color: var(--app-text-tertiary); }

// 右侧预览
.creator-preview { display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

.results-grid {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.result-card {
  position: relative; border-radius: var(--app-radius-md, 12px); overflow: hidden;
  border: 2px solid transparent; cursor: pointer; transition: all 0.15s;
  &.selected { border-color: var(--app-primary); }
  &:hover .result-overlay { opacity: 1; }
  img { width: 100%; display: block; }
}
.result-overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,0.4); opacity: 0;
  display: flex; align-items: center; justify-content: center; transition: opacity 0.2s;
}
.result-actions { display: flex; gap: 8px; }
.result-action {
  width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.9);
  border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--app-text); font-size: 16px; transition: transform 0.15s;
  &:hover { transform: scale(1.1); }
}

.preview-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--app-text-tertiary); padding: 80px 0;
  .empty-icon { width: 64px; height: 64px; color: var(--app-border-light); svg { width: 100%; height: 100%; } }
  h3 { font-size: 18px; font-weight: 600; color: var(--app-text-secondary); margin: 0; }
  p { font-size: 14px; margin: 0; }
}

.history-section { border-top: 1px solid var(--app-border-light); padding-top: 16px; }
.history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.history-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
.history-grid { display: flex; gap: 8px; overflow-x: auto; }
.history-thumb {
  width: 64px; height: 64px; border-radius: 8px; overflow: hidden; flex-shrink: 0;
  cursor: pointer; border: 1px solid var(--app-section-border-color); transition: border-color 0.15s;
  &:hover { border-color: var(--app-primary); }
  img { width: 100%; height: 100%; object-fit: cover; }
}
</style>
