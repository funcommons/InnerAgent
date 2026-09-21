<template>
  <div class="app-page home-page">
    <FcSectionHeader :title="'下午好，Demo 用户'" subtitle="工作台概览 (DEMO) — Mock 数据演示" :back="true" @back="router.back()">
      <template #welcome>
        <div class="creation-tiles">
          <div class="creation-tile">
            <div class="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="tile-content">
              <h3 class="tile-title">AI 视频</h3>
              <p class="tile-desc">文字生成视频，一键创作</p>
            </div>
            <div class="tile-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 10l7-7m0 0l7 7m-7-7v18" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>

          <div class="creation-tile is-dark">
            <div class="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="tile-content">
              <h3 class="tile-title">AI 图片</h3>
              <p class="tile-desc">文字生成图片，灵感无限</p>
            </div>
            <div class="tile-arrow is-light">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 10l7-7m0 0l7 7m-7-7v18" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
        </div>
      </template>
    </FcSectionHeader>

    <div class="home-grid-2col">
      <!-- 左侧: 最近生成 -->
      <FcSection>
        <template #header>
          <div class="section-header">
            <h2 class="section-header__title">最近生成</h2>
            <span class="section-header__link">查看全部 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </div>
        </template>
        <div class="assets-grid">
          <div v-for="work in recentWorks" :key="work.id" class="asset-thumb">
            <img loading="lazy" :src="work.thumbnail" :alt="work.prompt" />
            <span class="asset-type">{{ work.type === 'video' ? 'VIDEO' : 'IMAGE' }}</span>
          </div>
          <div class="asset-thumb add-new" role="button" tabindex="0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </FcSection>

      <!-- 右侧面板 -->
      <div class="right-column">
        <!-- 算力卡片 -->
        <div class="credit-card">
          <div class="credit-header">
            <div class="credit-info">
              <p class="credit-label">可用算力</p>
              <h4 class="credit-amount">8,640 <span class="credit-unit">Credits</span></h4>
            </div>
            <div class="credit-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          <div class="credit-actions">
            <button class="credit-btn">申请算力</button>
            <p class="credit-info-text">下次发放: 2026-08-01</p>
          </div>
        </div>

        <!-- 灵感推荐卡片 -->
        <div class="inspiration-card">
          <div class="inspiration-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h4 class="inspiration-title">灵感推荐</h4>
          <p class="inspiration-desc">探索社区热门作品，获取创作灵感</p>
          <router-link to="/dev/inspiration" class="inspiration-link">
            去灵感广场
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevWorkspacePage' })
import { useRouter } from 'vue-router'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'

const router = useRouter()

const recentWorks = Array.from({ length: 4 }, (_, i) => ({
  id: `mock-ws-${i + 1}`,
  type: i === 1 ? 'video' : 'image',
  thumbnail: `https://picsum.photos/seed/workspace${i + 1}/300/400`,
  prompt: ['赛博朋克城市', '日落延时摄影', '水彩花卉', '3D产品渲染'][i],
}))
</script>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.creation-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
}

.creation-tile {
  position: relative;
  height: 180px;
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--app-shadow-sm);
  border: 1px solid var(--app-section-border-color);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 24px;
  text-decoration: none;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  &:hover { transform: translateY(-2px); box-shadow: var(--app-shadow-md); }
  &.is-dark { background: #1d1d1f; .tile-title { color: #fff; } .tile-desc { color: rgba(255,255,255,0.5); } .tile-icon { background: rgba(255,255,255,0.1); color: #fff; } }
}

.tile-icon {
  position: absolute; top: 24px; left: 24px; width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; background: #f5f5f7; color: #007aff;
  svg { width: 20px; height: 20px; }
}

.tile-content { display: flex; justify-content: space-between; align-items: flex-end; flex: 1; }
.tile-title { font-size: 20px; font-weight: 600; color: #1d1d1f; margin: 0 0 4px; }
.tile-desc { font-size: 13px; color: #86868b; font-weight: 400; margin: 0; }

.tile-arrow {
  width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: #1d1d1f; color: #fff; transition: transform 0.2s ease;
  svg { width: 20px; height: 20px; }
  &.is-light { background: #fff; color: #1d1d1f; }
}

.creation-tile:hover .tile-arrow { transform: scale(1.05); }

.home-grid-2col {
  display: grid; grid-template-columns: 2fr 1fr; gap: var(--app-block-mb); align-items: start;
  @media (max-width: 1024px) { grid-template-columns: 1fr; }
}

.section-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.section-header__title { margin: 0; font-weight: 600; color: var(--app-section-title-color); }
.section-header__link {
  display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 600;
  color: var(--app-primary); text-decoration: none; cursor: pointer;
  svg { width: 16px; height: 16px; }
}

.assets-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

.asset-thumb {
  aspect-ratio: 3 / 4; background: var(--app-bg-muted, #f5f5f7); border-radius: 12px;
  overflow: hidden; position: relative; cursor: pointer; border: 1px solid var(--app-section-border-color);
  box-shadow: var(--app-shadow-sm); transition: box-shadow 0.2s ease, transform 0.2s ease;
  &:hover { box-shadow: var(--app-shadow-md); transform: translateY(-2px); }
  img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
  &:hover img { transform: scale(1.05); }
}

.asset-type {
  position: absolute; bottom: 8px; left: 6px; background: rgba(0,0,0,0.6); color: #fff;
  font-size: 8px; font-weight: 700; padding: 2px 6px; border-radius: 6px; backdrop-filter: blur(4px); text-transform: uppercase;
}

.asset-thumb.add-new {
  display: flex; align-items: center; justify-content: center;
  border: 2px dashed var(--app-border-light, rgba(0,0,0,0.15)); background: transparent; box-shadow: none;
  svg { width: 24px; height: 24px; color: var(--app-text-tertiary); }
  &:hover { border-color: var(--app-primary); background: rgba(255,107,0,0.05); svg { color: var(--app-primary); } }
}

.right-column { display: flex; flex-direction: column; gap: var(--app-block-mb); }

.credit-card {
  background: #fff0e5; border: 1px solid #ffd4b0; border-radius: 16px; padding: 24px;
  display: flex; flex-direction: column; min-height: 180px;
}

.credit-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: auto; }
.credit-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #86868b; margin: 0 0 8px; }
.credit-amount { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; margin: 0; color: #ff6b00; }
.credit-unit { font-size: 14px; font-weight: 400; opacity: 0.8; margin-left: 4px; }
.credit-icon {
  width: 40px; height: 40px; background: rgba(255,107,0,0.12); border-radius: 12px;
  display: flex; align-items: center; justify-content: center; color: #ff6b00;
  svg { width: 20px; height: 20px; }
}

.credit-actions { display: flex; flex-direction: column; gap: 16px; margin-top: auto; }
.credit-btn {
  @include reset-button;
  width: 100%; padding: 12px; background: #ff6b00; color: #fff; font-size: 14px; font-weight: 600;
  border-radius: 12px; cursor: pointer; transition: opacity 0.2s ease;
  &:hover { opacity: 0.9; }
}
.credit-info-text { font-size: 11px; color: var(--app-text-tertiary); text-align: center; font-weight: 500; }

.inspiration-card {
  background: #fff; border: 1px solid var(--app-section-border-color); border-radius: 16px;
  padding: 24px; box-shadow: var(--app-shadow-sm);
}

.inspiration-icon {
  width: 40px; height: 40px; background: #fff0e5; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; color: #ff6b00; margin-bottom: 16px;
  svg { width: 20px; height: 20px; }
}

.inspiration-title { font-size: 18px; font-weight: 600; color: var(--app-text); margin: 0 0 8px; }
.inspiration-desc { font-size: 13px; color: var(--app-text-secondary); line-height: 1.5; margin: 0 0 16px; }
.inspiration-link {
  display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600;
  color: #ff6b00; text-decoration: none;
  &:hover { opacity: 0.85; svg { transform: translateX(2px); } }
  svg { width: 16px; height: 16px; transition: transform 0.2s ease; }
}
</style>
