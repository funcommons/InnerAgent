<template>
  <div class="app-page kanban-page">
    <FcSectionHeader title="看板视图 (DEMO)" subtitle="多列拖拽卡片 · 任务管理" :back="true" @back="router.back()">
      <template #actions>
        <FcButton size="small" @click="addCard"><i class="ri-add-line" /> 新建任务</FcButton>
      </template>
    </FcSectionHeader>

    <div class="kanban-board">
      <div v-for="col in columns" :key="col.id" class="kanban-col">
        <div class="col-header">
          <span class="col-dot" :style="{ background: col.color }" />
          <h3 class="col-title">{{ col.title }}</h3>
          <span class="col-count">{{ col.cards.length }}</span>
        </div>

        <div class="col-body">
          <div v-for="card in col.cards" :key="card.id" class="kanban-card" draggable="true"
            @dragstart="onDragStart(card, col.id)" @dragover.prevent @drop="onDrop(col.id)">
            <div class="card-header">
              <FcTag :color="card.priority === 'high' ? 'danger' : card.priority === 'medium' ? 'warning' : 'gray'" size="sm">{{ card.priority === 'high' ? '高' : card.priority === 'medium' ? '中' : '低' }}</FcTag>
              <span class="card-id">#{{ card.id }}</span>
            </div>
            <h4 class="card-title">{{ card.title }}</h4>
            <p class="card-desc">{{ card.desc }}</p>
            <div class="card-footer">
              <div class="card-tags">
                <span v-for="t in card.tags" :key="t" class="card-tag">{{ t }}</span>
              </div>
              <Avatar :src="card.avatar" :name="card.assignee" size="small" />
            </div>
          </div>

          <!-- 放置提示 -->
          <div v-if="col.cards.length === 0" class="col-empty">拖拽任务到此处</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevKanbanPage' })
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import { FcButton, FcTag } from '@/components/sdk'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import { ElMessage } from 'element-plus'

const router = useRouter()
let nextId = 20

interface Card {
  id: number; title: string; desc: string; priority: string;
  tags: string[]; assignee: string; avatar: string;
}

interface Column { id: string; title: string; color: string; cards: Card[] }

const columns = reactive<Column[]>([
  { id: 'backlog', title: '待处理', color: '#8e8e93', cards: [
    { id: 1, title: '设计落地页 Banner', desc: '为新产品设计主视觉 Banner 图', priority: 'medium', tags: ['设计', 'UI'], assignee: '小王', avatar: 'https://picsum.photos/seed/k1/80/80' },
    { id: 2, title: '编写 API 文档', desc: '补充 v2 接口文档和示例代码', priority: 'low', tags: ['文档'], assignee: '小李', avatar: 'https://picsum.photos/seed/k2/80/80' },
    { id: 3, title: '竞品分析报告', desc: '分析 3 个竞品的功能差异', priority: 'low', tags: ['调研'], assignee: '小赵', avatar: 'https://picsum.photos/seed/k3/80/80' },
  ]},
  { id: 'doing', title: '进行中', color: '#007aff', cards: [
    { id: 4, title: '视频生成功能', desc: '集成 Kling v1.6 视频生成能力', priority: 'high', tags: ['开发', '视频'], assignee: '小张', avatar: 'https://picsum.photos/seed/k4/80/80' },
    { id: 5, title: '移动端适配', desc: '首页和创作页移动端响应式', priority: 'medium', tags: ['前端'], assignee: '小孙', avatar: 'https://picsum.photos/seed/k5/80/80' },
  ]},
  { id: 'review', title: '审核中', color: '#ff9500', cards: [
    { id: 6, title: '模型排行榜', desc: '模型使用量排行统计页面', priority: 'medium', tags: ['开发', '数据'], assignee: '小周', avatar: 'https://picsum.photos/seed/k6/80/80' },
  ]},
  { id: 'done', title: '已完成', color: '#34c759', cards: [
    { id: 7, title: '用户登录重构', desc: '支持 JWT + OAuth2 双模式登录', priority: 'high', tags: ['开发', '安全'], assignee: '小吴', avatar: 'https://picsum.photos/seed/k7/80/80' },
    { id: 8, title: 'FC 组件库 v2', desc: 'SDK 组件拆分和主题系统升级', priority: 'high', tags: ['前端', 'SDK'], assignee: '小郑', avatar: 'https://picsum.photos/seed/k8/80/80' },
    { id: 9, title: '部署流水线优化', desc: 'CI/CD 从 15 分钟优化到 5 分钟', priority: 'medium', tags: ['运维'], assignee: '小陈', avatar: 'https://picsum.photos/seed/k9/80/80' },
  ]},
])

let dragCard: Card | null = null
let dragColId = ''

function onDragStart(card: Card, colId: string) {
  dragCard = card
  dragColId = colId
}

function onDrop(targetColId: string) {
  if (!dragCard || dragColId === targetColId) return
  const srcCol = columns.find(c => c.id === dragColId)
  const tgtCol = columns.find(c => c.id === targetColId)
  if (srcCol && tgtCol) {
    srcCol.cards = srcCol.cards.filter(c => c.id !== dragCard!.id)
    tgtCol.cards.push(dragCard)
  }
  dragCard = null
}

function addCard() {
  columns[0]?.cards.push({
    id: nextId++, title: '新任务', desc: '任务描述', priority: 'medium',
    tags: ['待定'], assignee: 'Me', avatar: '',
  })
  ElMessage.success('已添加到待处理')
}
</script>

<style scoped lang="scss">
.kanban-page { display: flex; flex-direction: column; gap: 16px; height: calc(100vh - 120px); }
.kanban-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; flex: 1; min-height: 0; overflow-x: auto; @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); } }

.kanban-col { display: flex; flex-direction: column; gap: 12px; background: var(--app-bg-muted, #f5f5f7); border-radius: var(--app-radius-lg, 16px); padding: 16px; min-width: 260px; }
.col-header { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--app-border-light); }
.col-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.col-title { font-size: 15px; font-weight: 600; color: var(--app-text); margin: 0; flex: 1; }
.col-count { font-size: 12px; color: var(--app-text-tertiary); background: var(--el-bg-color, #fff); padding: 2px 8px; border-radius: 10px; }

.col-body { display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto; min-height: 100px; }
.col-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--app-text-tertiary); border: 2px dashed var(--app-border-light); border-radius: 12px; min-height: 80px; }

.kanban-card {
  background: var(--el-bg-color, #fff); border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px); padding: 14px; cursor: grab; transition: all 0.15s;
  &:hover { box-shadow: var(--app-shadow-sm); transform: translateY(-2px); }
  &:active { cursor: grabbing; }
}
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-id { font-size: 11px; color: var(--app-text-tertiary); }
.card-title { font-size: 14px; font-weight: 600; color: var(--app-text); margin: 0 0 4px; }
.card-desc { font-size: 12px; color: var(--app-text-tertiary); margin: 0 0 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.card-tag { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--app-bg-muted, #f5f5f7); color: var(--app-text-tertiary); }
</style>
