<template>
  <div class="app-page profile-page">
    <FcSectionHeader title="个人中心 (DEMO)" subtitle="仿大厂设计 · Mock 数据" :back="true" @back="router.back()" />

    <!-- 封面 + 头像区 -->
    <div class="profile-hero">
      <div class="hero-cover">
        <img src="https://picsum.photos/seed/profilecover/1200/300" alt="cover" />
        <div class="hero-overlay" />
      </div>
      <div class="hero-content">
        <div class="avatar-ring">
          <Avatar src="https://picsum.photos/seed/myavatar/200/200" name="Demo" size="large" />
        </div>
        <div class="hero-info">
          <h1 class="hero-name">Demo 用户</h1>
          <p class="hero-bio">AIGC 创作者 · 视觉设计师 · 探索 AI 与艺术的边界</p>
          <div class="hero-meta">
            <span><i class="ri-map-pin-line" /> 北京</span>
            <span><i class="ri-links-line" /> demo.design</span>
            <span><i class="ri-calendar-line" /> 2025年3月加入</span>
          </div>
        </div>
        <div class="hero-actions">
          <FcButton type="primary"><i class="ri-edit-line" /> 编辑资料</FcButton>
          <FcButton><i class="ri-share-line" /> 分享</FcButton>
        </div>
      </div>
    </div>

    <!-- 数据统计条 -->
    <div class="stats-bar">
      <div v-for="stat in statsItems" :key="stat.label" class="stat-item">
        <span class="stat-value">{{ stat.value }}</span>
        <span class="stat-label">{{ stat.label }}</span>
      </div>
    </div>

    <!-- Tab 切换 -->
    <FcFilterBar>
      <FcFilterButton v-for="tab in tabs" :key="tab.value" :active="activeTab === tab.value" @click="activeTab = tab.value">
        {{ tab.label }}
      </FcFilterButton>
    </FcFilterBar>

    <!-- 作品 Tab -->
    <template v-if="activeTab === 'works'">
      <div class="works-masonry">
        <div v-for="work in myWorks" :key="work.id" class="masonry-item">
          <div class="masonry-thumb">
            <img :src="work.thumbnail" :alt="work.title" loading="lazy" />
            <div class="masonry-overlay">
              <span class="masonry-type">{{ work.type === 'video' ? 'VIDEO' : 'IMAGE' }}</span>
            </div>
          </div>
          <div class="masonry-info">
            <p class="masonry-title">{{ work.title }}</p>
            <div class="masonry-stats">
              <span><i class="ri-heart-line" /> {{ work.likes }}</span>
              <span><i class="ri-eye-line" /> {{ work.views }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 收藏 Tab -->
    <template v-if="activeTab === 'favorites'">
      <div class="works-masonry">
        <div v-for="work in favoriteWorks" :key="work.id" class="masonry-item">
          <div class="masonry-thumb">
            <img :src="work.thumbnail" :alt="work.title" loading="lazy" />
          </div>
          <div class="masonry-info">
            <p class="masonry-title">{{ work.title }}</p>
            <span class="masonry-author">by {{ work.author }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 算力 Tab -->
    <template v-if="activeTab === 'credits'">
      <FcSection>
        <template #header>
          <div class="section-header">
            <span class="section-title">算力账户</span>
            <FcButton size="small" type="primary"><i class="ri-add-line" /> 充值</FcButton>
          </div>
        </template>
        <div class="credits-overview">
          <div class="credit-balance">
            <span class="balance-label">当前余额</span>
            <span class="balance-value">8,640 <small>Credits</small></span>
          </div>
          <div class="credit-usage">
            <div class="usage-bar">
              <div class="usage-fill" style="width: 65%" />
            </div>
            <div class="usage-text">本月已用 5,600 / 总额 8,640</div>
          </div>
        </div>
      </FcSection>

      <FcSection>
        <template #header><span class="section-title">最近记录</span></template>
        <div class="credit-records">
          <div v-for="rec in creditRecords" :key="rec.id" class="record-row">
            <div class="record-icon" :class="rec.amount > 0 ? 'income' : 'expense'">
              <i :class="rec.amount > 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line'" />
            </div>
            <div class="record-info">
              <span class="record-title">{{ rec.title }}</span>
              <span class="record-date">{{ rec.date }}</span>
            </div>
            <span class="record-amount" :class="rec.amount > 0 ? 'income' : 'expense'">
              {{ rec.amount > 0 ? '+' : '' }}{{ rec.amount }}
            </span>
          </div>
        </div>
      </FcSection>
    </template>

    <!-- 设置 Tab -->
    <template v-if="activeTab === 'settings'">
      <FcSection>
        <template #header><span class="section-title">基本信息</span></template>
        <div class="settings-form">
          <div class="form-row">
            <label>昵称</label>
            <span class="form-value">Demo 用户</span>
          </div>
          <div class="form-row">
            <label>手机号</label>
            <span class="form-value">138****5678</span>
          </div>
          <div class="form-row">
            <label>邮箱</label>
            <span class="form-value">demo@example.com</span>
          </div>
          <div class="form-row">
            <label>角色</label>
            <FcTag color="primary" size="sm">VIP 用户</FcTag>
          </div>
          <div class="form-row">
            <label>注册时间</label>
            <span class="form-value">2025-03-15</span>
          </div>
        </div>
      </FcSection>

      <FcSection>
        <template #header><span class="section-title">安全设置</span></template>
        <div class="settings-form">
          <div class="form-row">
            <label>登录密码</label>
            <FcButton link type="primary">修改密码</FcButton>
          </div>
          <div class="form-row">
            <label>两步验证</label>
            <FcSwitch :model-value="true" disabled />
          </div>
          <div class="form-row">
            <label>登录设备</label>
            <span class="form-value">3 台设备</span>
          </div>
        </div>
      </FcSection>

      <FcSection>
        <template #header><span class="section-title">偏好设置</span></template>
        <div class="settings-form">
          <div class="form-row">
            <label>默认生成质量</label>
            <FcSelect :model-value="'high'" disabled size="small" style="width: 160px">
              <option value="low">标准</option>
              <option value="high">高清</option>
            </FcSelect>
          </div>
          <div class="form-row">
            <label>消息通知</label>
            <FcSwitch :model-value="true" disabled />
          </div>
          <div class="form-row">
            <label>水印设置</label>
            <FcSwitch :model-value="false" disabled />
          </div>
        </div>
      </FcSection>
    </template>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevProfilePage' })
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcButton, FcTag, FcSwitch, FcSelect } from '@/components/sdk'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'

const router = useRouter()
const activeTab = ref('works')

const tabs = [
  { label: '我的作品', value: 'works' },
  { label: '收藏', value: 'favorites' },
  { label: '算力', value: 'credits' },
  { label: '设置', value: 'settings' },
]

const statsItems = [
  { label: '作品', value: '128' },
  { label: '获赞', value: '3.2k' },
  { label: '关注', value: '56' },
  { label: '粉丝', value: '892' },
  { label: '算力', value: '8,640' },
]

const myWorks = Array.from({ length: 12 }, (_, i) => ({
  id: `pw-${i + 1}`,
  title: ['赛博朋克城市', '国风山水', '写实人像', '二次元少女', '3D产品', '油画静物', '极简建筑', '太空站', '猫咪写真', '法式甜点', '仙侠人物', '未来城市'][i],
  type: (i % 5 === 2 ? 'video' : 'image') as 'video' | 'image',
  thumbnail: `https://picsum.photos/seed/mywork${i + 1}/400/${300 + (i % 3) * 80}`,
  likes: Math.floor(Math.random() * 800) + 20,
  views: Math.floor(Math.random() * 5000) + 100,
}))

const favoriteWorks = Array.from({ length: 8 }, (_, i) => ({
  id: `fav-${i + 1}`,
  title: ['梦幻极光', '机械朋克', '水彩花园', '微距世界', '街头艺术', '古风建筑', '赛博少女', '星空银河'][i],
  thumbnail: `https://picsum.photos/seed/favwork${i + 1}/400/${300 + (i % 3) * 60}`,
  author: ['创意达人', 'AI画师', '设计小王', '灵感猎手', '视觉工坊', '像素诗人', '光影匠人', '色彩魔术师'][i],
}))

const creditRecords = [
  { id: 'r1', title: '生成视频 — 赛博朋克城市', date: '2026-07-21 14:30', amount: -120 },
  { id: 'r2', title: '每日签到奖励', date: '2026-07-21 00:00', amount: 50 },
  { id: 'r3', title: '生成图片 — 国风山水', date: '2026-07-20 16:45', amount: -30 },
  { id: 'r4', title: '充值 500 Credits', date: '2026-07-20 10:00', amount: 500 },
  { id: 'r5', title: '生成视频 — 写实人像', date: '2026-07-19 20:15', amount: -120 },
  { id: 'r6', title: '邀请好友奖励', date: '2026-07-19 09:00', amount: 200 },
  { id: 'r7', title: '生成图片 — 油画静物', date: '2026-07-18 11:30', amount: -30 },
  { id: 'r8', title: 'VIP 月度算力发放', date: '2026-07-01 00:00', amount: 2000 },
]
</script>

<style scoped lang="scss">
.profile-page { display: flex; flex-direction: column; gap: 16px; }

// Hero
.profile-hero {
  position: relative;
  border-radius: var(--app-radius-xl, 20px);
  overflow: hidden;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-section-border-color);
}

.hero-cover {
  position: relative;
  height: 200px;
  overflow: hidden;
  img { width: 100%; height: 100%; object-fit: cover; }
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.4));
}

.hero-content {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  padding: 0 32px 24px;
  margin-top: -48px;
  position: relative;
  z-index: 1;
}

.avatar-ring {
  flex-shrink: 0;
  padding: 4px;
  background: var(--el-bg-color, #fff);
  border-radius: 50%;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

.hero-info { flex: 1; min-width: 0; padding-bottom: 4px; }
.hero-name { font-size: 24px; font-weight: 700; color: var(--app-text); margin: 0 0 4px; }
.hero-bio { font-size: 14px; color: var(--app-text-secondary); margin: 0 0 8px; }
.hero-meta {
  display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--app-text-tertiary);
  span { display: inline-flex; align-items: center; gap: 4px; }
}

.hero-actions {
  display: flex; gap: 8px; flex-shrink: 0; padding-bottom: 4px;
}

// Stats bar
.stats-bar {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: var(--app-section-border-color);
  border-radius: var(--app-radius-lg, 16px);
  overflow: hidden;
  border: 1px solid var(--app-section-border-color);

  @media (max-width: 640px) { grid-template-columns: repeat(3, 1fr); }
}

.stat-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 20px 16px;
  background: var(--el-bg-color, #fff);
}

.stat-value { font-size: 22px; font-weight: 700; color: var(--app-text); }
.stat-label { font-size: 12px; color: var(--app-text-tertiary); }

// Masonry grid
.works-masonry {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.masonry-item {
  border-radius: var(--app-radius-md, 12px);
  overflow: hidden;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-section-border-color);
  transition: transform 0.2s, box-shadow 0.2s;
  &:hover { transform: translateY(-4px); box-shadow: var(--app-shadow-md); }
}

.masonry-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--app-bg-muted, #f5f5f7);
  img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
  .masonry-item:hover & img { transform: scale(1.05); }
}

.masonry-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%);
  opacity: 0; transition: opacity 0.2s;
  .masonry-item:hover & { opacity: 1; }
}

.masonry-type {
  position: absolute; bottom: 8px; left: 8px;
  background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 6px; backdrop-filter: blur(4px);
}

.masonry-info { padding: 12px; }
.masonry-title { font-size: 13px; color: var(--app-text); margin: 0 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.masonry-stats {
  display: flex; gap: 12px; font-size: 12px; color: var(--app-text-tertiary);
  span { display: inline-flex; align-items: center; gap: 3px; }
}
.masonry-author { font-size: 12px; color: var(--app-text-tertiary); }

// Credits
.section-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.section-title { font-size: 14px; font-weight: 600; color: var(--app-text); }

.credits-overview {
  display: flex; flex-direction: column; gap: 20px;
}

.credit-balance { display: flex; flex-direction: column; gap: 4px; }
.balance-label { font-size: 12px; color: var(--app-text-tertiary); }
.balance-value { font-size: 36px; font-weight: 700; color: var(--app-primary); small { font-size: 14px; font-weight: 400; opacity: 0.7; } }

.usage-bar {
  height: 8px; background: var(--app-bg-muted, #f5f5f7); border-radius: 4px; overflow: hidden;
}
.usage-fill { height: 100%; background: var(--app-primary); border-radius: 4px; transition: width 0.3s; }
.usage-text { font-size: 12px; color: var(--app-text-tertiary); margin-top: 6px; }

.credit-records { display: flex; flex-direction: column; }

.record-row {
  display: flex; align-items: center; gap: 12px; padding: 14px 0;
  border-bottom: 1px solid var(--app-border-light);
  &:last-child { border-bottom: none; }
}

.record-icon {
  width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
  &.income { background: rgba(52,199,89,0.1); color: var(--el-color-success); }
  &.expense { background: rgba(255,59,48,0.1); color: var(--el-color-danger); }
}

.record-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.record-title { font-size: 14px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-date { font-size: 12px; color: var(--app-text-tertiary); }

.record-amount {
  font-size: 15px; font-weight: 600; flex-shrink: 0;
  &.income { color: var(--el-color-success); }
  &.expense { color: var(--el-color-danger); }
}

// Settings
.settings-form { display: flex; flex-direction: column; }

.form-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0; border-bottom: 1px solid var(--app-border-light);
  &:last-child { border-bottom: none; }

  label { font-size: 14px; color: var(--app-text); font-weight: 500; }
}

.form-value { font-size: 14px; color: var(--app-text-secondary); }
</style>