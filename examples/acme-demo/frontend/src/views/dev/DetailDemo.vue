<template>
  <div class="app-page detail-page">
    <FcSectionHeader title="作品详情 (DEMO)" subtitle="大图 + 元数据 + 操作 + 评论" :back="true" @back="router.back()" />

    <div class="detail-layout">
      <!-- 左侧大图 -->
      <div class="detail-media">
        <div class="media-main">
          <img :src="currentImage" alt="作品" />
          <div v-if="work.type === 'video'" class="video-badge"><i class="ri-play-fill" /> VIDEO</div>
        </div>
        <div v-if="work.images.length > 1" class="media-thumbs">
          <div v-for="(img, i) in work.images" :key="i" class="thumb-item" :class="{ active: currentImage === img }" @click="currentImage = img">
            <img :src="img" />
          </div>
        </div>
      </div>

      <!-- 右侧信息 -->
      <div class="detail-info">
        <!-- 作者 -->
        <div class="author-bar">
          <Avatar :src="work.authorAvatar" :name="work.author" size="medium" />
          <div class="author-text">
            <span class="author-name">{{ work.author }}</span>
            <span class="author-time">{{ work.createdAt }}</span>
          </div>
          <FcButton size="small"><i class="ri-user-add-line" /> 关注</FcButton>
        </div>

        <!-- 操作栏 -->
        <div class="action-bar">
          <button class="action-item" :class="{ liked: liked }" @click="liked = !liked">
            <i :class="liked ? 'ri-heart-fill' : 'ri-heart-line'" /> {{ work.likes + (liked ? 1 : 0) }}
          </button>
          <button class="action-item" @click="collected = !collected">
            <i :class="collected ? 'ri-bookmark-fill' : 'ri-bookmark-line'" /> 收藏
          </button>
          <button class="action-item"><i class="ri-share-line" /> 分享</button>
          <button class="action-item"><i class="ri-download-line" /> 下载</button>
          <button class="action-item"><i class="ri-flag-line" /> 举报</button>
        </div>

        <!-- 提示词 -->
        <FcSection>
          <template #header><span class="info-title">提示词</span></template>
          <p class="prompt-text">{{ work.prompt }}</p>
          <div v-if="work.negativePrompt" class="neg-prompt">
            <label>负面提示词</label>
            <p>{{ work.negativePrompt }}</p>
          </div>
        </FcSection>

        <!-- 生成参数 -->
        <FcSection>
          <template #header><span class="info-title">生成参数</span></template>
          <div class="params-grid">
            <div v-for="p in work.params" :key="p.label" class="param-item">
              <span class="param-label">{{ p.label }}</span>
              <span class="param-value">{{ p.value }}</span>
            </div>
          </div>
        </FcSection>

        <!-- 一键同款 -->
        <FcButton type="primary" size="large" class="remix-btn">
          <i class="ri-sparkling-line" /> 一键同款
        </FcButton>

        <!-- 评论区 -->
        <FcSection>
          <template #header>
            <span class="info-title">评论 ({{ comments.length }})</span>
          </template>
          <div class="comment-input-row">
            <Avatar src="" name="Me" size="small" />
            <input v-model="newComment" type="text" placeholder="写下你的评论..." class="comment-input" @keyup.enter="addComment" />
            <FcButton size="small" type="primary" @click="addComment">发送</FcButton>
          </div>
          <div class="comment-list">
            <div v-for="c in comments" :key="c.id" class="comment-item">
              <Avatar :src="c.avatar" :name="c.name" size="small" />
              <div class="comment-body">
                <div class="comment-header">
                  <span class="comment-name">{{ c.name }}</span>
                  <span class="comment-time">{{ c.time }}</span>
                </div>
                <p class="comment-text">{{ c.text }}</p>
                <div class="comment-actions">
                  <button class="comment-action" @click="c.liked = !c.liked">
                    <i :class="c.liked ? 'ri-heart-fill' : 'ri-heart-line'" /> {{ c.likes + (c.liked ? 1 : 0) }}
                  </button>
                  <button class="comment-action"><i class="ri-chat-3-line" /> 回复</button>
                </div>
              </div>
            </div>
          </div>
        </FcSection>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevDetailPage' })
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcButton } from '@/components/sdk'

const router = useRouter()
const liked = ref(false)
const collected = ref(false)
const newComment = ref('')

const work = {
  type: 'image' as 'image' | 'video',
  images: [
    'https://picsum.photos/seed/detail1/800/600',
    'https://picsum.photos/seed/detail2/800/600',
    'https://picsum.photos/seed/detail3/800/600',
    'https://picsum.photos/seed/detail4/800/600',
  ],
  prompt: '赛博朋克城市夜景，霓虹灯闪烁，雨后倒影，超高细节，8K分辨率，电影级光影效果，未来都市，飞行汽车穿梭于摩天大楼之间',
  negativePrompt: '低质量, 模糊, 变形, 水印, 文字',
  author: '创意达人',
  authorAvatar: 'https://picsum.photos/seed/author1/100/100',
  createdAt: '2026-07-20 14:30',
  likes: 328,
  params: [
    { label: '模型', value: 'FLUX Pro' },
    { label: '尺寸', value: '16:9 (1920×1080)' },
    { label: 'CFG Scale', value: '7.5' },
    { label: '采样步数', value: '30' },
    { label: '采样器', value: 'Euler a' },
    { label: '种子', value: '284756103' },
  ],
}

const currentImage = ref(work.images[0])

const comments = ref([
  { id: 1, name: '设计小王', avatar: 'https://picsum.photos/seed/c1/80/80', text: '这个光影效果太棒了！请问用的什么模型？', time: '2小时前', likes: 12, liked: false },
  { id: 2, name: 'AI画师', avatar: 'https://picsum.photos/seed/c2/80/80', text: '赛博朋克风格拿捏得很到位，雨后倒影的细节很惊艳', time: '5小时前', likes: 8, liked: false },
  { id: 3, name: '灵感猎手', avatar: 'https://picsum.photos/seed/c3/80/80', text: '已收藏！想用同款参数试试', time: '1天前', likes: 3, liked: false },
])

function addComment() {
  if (!newComment.value.trim()) return
  comments.value.unshift({
    id: Date.now(), name: 'Demo 用户', avatar: '', text: newComment.value, time: '刚刚', likes: 0, liked: false,
  })
  newComment.value = ''
}
</script>

<style scoped lang="scss">
.detail-page { display: flex; flex-direction: column; gap: 16px; }
.detail-layout { display: grid; grid-template-columns: 1fr 400px; gap: 24px; @media (max-width: 1024px) { grid-template-columns: 1fr; } }

// 左侧大图
.detail-media { display: flex; flex-direction: column; gap: 12px; }
.media-main {
  position: relative; border-radius: var(--app-radius-lg, 16px); overflow: hidden;
  background: var(--app-bg-muted, #f5f5f7); aspect-ratio: 4/3;
  img { width: 100%; height: 100%; object-fit: contain; }
}
.video-badge {
  position: absolute; top: 16px; left: 16px; background: rgba(0,0,0,0.7); color: #fff;
  padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; gap: 4px; backdrop-filter: blur(4px);
}
.media-thumbs { display: flex; gap: 8px; }
.thumb-item {
  width: 72px; height: 54px; border-radius: 8px; overflow: hidden; cursor: pointer;
  border: 2px solid transparent; transition: border-color 0.15s; flex-shrink: 0;
  &.active { border-color: var(--app-primary); }
  &:hover { border-color: var(--app-primary-lightest); }
  img { width: 100%; height: 100%; object-fit: cover; }
}

// 右侧信息
.detail-info { display: flex; flex-direction: column; gap: 16px; }
.author-bar { display: flex; align-items: center; gap: 12px; }
.author-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.author-name { font-size: 15px; font-weight: 600; color: var(--app-text); }
.author-time { font-size: 12px; color: var(--app-text-tertiary); }

.action-bar { display: flex; gap: 4px; flex-wrap: wrap; }
.action-item {
  display: inline-flex; align-items: center; gap: 4px; padding: 8px 14px;
  border-radius: var(--app-radius-md, 12px); font-size: 13px; color: var(--app-text-secondary);
  background: var(--app-bg-muted, #f5f5f7); border: none; cursor: pointer; transition: all 0.15s;
  &:hover { background: var(--app-section-border-color); color: var(--app-text); }
  &.liked { color: var(--el-color-danger); }
}

.info-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
.prompt-text { font-size: 14px; color: var(--app-text); line-height: 1.6; margin: 0; }
.neg-prompt {
  margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--app-border-light);
  label { font-size: 12px; color: var(--app-text-tertiary); display: block; margin-bottom: 4px; }
  p { font-size: 13px; color: var(--app-text-secondary); margin: 0; }
}

.params-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.param-item { display: flex; justify-content: space-between; padding: 8px 12px; background: var(--app-bg-muted, #f5f5f7); border-radius: 8px; }
.param-label { font-size: 12px; color: var(--app-text-tertiary); }
.param-value { font-size: 13px; font-weight: 500; color: var(--app-text); }

.remix-btn { width: 100%; }

// 评论
.comment-input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.comment-input {
  flex: 1; padding: 8px 14px; border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px); font-size: 14px; color: var(--app-text);
  background: var(--el-bg-color, #fff); outline: none;
  &:focus { border-color: var(--app-primary); }
}

.comment-list { display: flex; flex-direction: column; gap: 16px; }
.comment-item { display: flex; gap: 10px; }
.comment-body { flex: 1; min-width: 0; }
.comment-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.comment-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
.comment-time { font-size: 11px; color: var(--app-text-tertiary); }
.comment-text { font-size: 14px; color: var(--app-text); margin: 0 0 6px; line-height: 1.5; }
.comment-actions { display: flex; gap: 12px; }
.comment-action {
  display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--app-text-tertiary);
  background: none; border: none; cursor: pointer; padding: 0;
  &:hover { color: var(--app-text-secondary); }
}
</style>
