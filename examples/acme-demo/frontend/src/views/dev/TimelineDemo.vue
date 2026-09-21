<template>
  <div class="app-page timeline-page">
    <FcSectionHeader title="时间线 (DEMO)" subtitle="竖向时间轴 + 节点卡片 · 版本历史 / 操作日志" :back="true" @back="router.back()">
      <template #actions>
        <FcFilterBar>
          <FcFilterButton v-for="tab in tabs" :key="tab.value" :active="activeTab === tab.value" @click="activeTab = tab.value">
            {{ tab.label }}
          </FcFilterButton>
        </FcFilterBar>
      </template>
    </FcSectionHeader>

    <div class="timeline-container">
      <div class="timeline-track">
        <div v-for="(event, i) in filteredEvents" :key="event.id" class="timeline-node" :class="{ 'last-item': i === filteredEvents.length - 1 }">
          <!-- 时间轴竖线 + 节点 -->
          <div class="node-track">
            <div class="node-dot" :class="event.type">
              <i :class="event.icon" />
            </div>
            <div v-if="i < filteredEvents.length - 1" class="node-line" />
          </div>

          <!-- 内容卡片 -->
          <div class="node-card">
            <div class="node-header">
              <span class="node-title">{{ event.title }}</span>
              <span class="node-time">{{ event.time }}</span>
            </div>
            <p class="node-desc">{{ event.desc }}</p>

            <!-- 变更详情 -->
            <div v-if="event.changes?.length" class="node-changes">
              <div v-for="c in event.changes" :key="c.field" class="change-row">
                <span class="change-field">{{ c.field }}</span>
                <span class="change-old">{{ c.old }}</span>
                <i class="ri-arrow-right-line change-arrow" />
                <span class="change-new">{{ c.new }}</span>
              </div>
            </div>

            <!-- 附件/图片 -->
            <div v-if="event.images?.length" class="node-images">
              <img v-for="(img, j) in event.images" :key="j" :src="img" class="node-img" />
            </div>

            <!-- 操作人 -->
            <div class="node-meta">
              <Avatar :src="event.actorAvatar" :name="event.actor" size="small" />
              <span class="node-actor">{{ event.actor }}</span>
              <span v-if="event.version" class="node-version"><i class="ri-git-branch-line" /> {{ event.version }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevTimelinePage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'

const router = useRouter()
const activeTab = ref('all')

const tabs = [
  { label: '全部', value: 'all' },
  { label: '版本发布', value: 'release' },
  { label: '操作日志', value: 'action' },
  { label: '系统事件', value: 'system' },
]

interface TimelineEvent {
  id: string; title: string; desc: string; time: string; type: string; icon: string;
  actor: string; actorAvatar: string; version?: string;
  changes?: { field: string; old: string; new: string }[];
  images?: string[];
}

const events: TimelineEvent[] = [
  { id: '1', title: 'v2.4.0 发布', desc: '新增视频创作功能、模板市场、个人中心', time: '2026-07-20 16:00', type: 'release', icon: 'ri-rocket-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80', version: 'v2.4.0' },
  { id: '2', title: '修改用户角色', desc: '将用户「张三」的角色从普通用户升级为 VIP', time: '2026-07-20 14:30', type: 'action', icon: 'ri-user-settings-line', actor: '管理员', actorAvatar: 'https://picsum.photos/seed/admin/80/80', changes: [{ field: '角色', old: 'user', new: 'vip' }] },
  { id: '3', title: '模型配置更新', desc: '新增 Kling v1.6 视频模型，调整 FLUX Pro 参数上限', time: '2026-07-20 10:00', type: 'system', icon: 'ri-settings-3-line', actor: '系统', actorAvatar: '', changes: [{ field: '新增模型', old: '-', new: 'Kling v1.6' }, { field: 'CFG 上限', old: '15', new: '20' }] },
  { id: '4', title: 'v2.3.2 热修复', desc: '修复图片生成偶发超时、移动端布局错位', time: '2026-07-19 18:00', type: 'release', icon: 'ri-bug-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80', version: 'v2.3.2' },
  { id: '5', title: '批量充值算力', desc: '为 15 位 VIP 用户批量充值月度算力', time: '2026-07-19 09:00', type: 'action', icon: 'ri-coin-line', actor: '系统', actorAvatar: '' },
  { id: '6', title: '数据库迁移完成', desc: 'PostgreSQL 15 → 16 升级，迁移耗时 23 分钟', time: '2026-07-18 02:00', type: 'system', icon: 'ri-database-2-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80', changes: [{ field: '版本', old: 'PG 15', new: 'PG 16' }] },
  { id: '7', title: 'v2.3.0 发布', desc: 'FC 组件库重构、主题系统升级、多品牌支持', time: '2026-07-15 16:00', type: 'release', icon: 'ri-rocket-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80', version: 'v2.3.0', images: ['https://picsum.photos/seed/release1/200/120', 'https://picsum.photos/seed/release2/200/120', 'https://picsum.photos/seed/release3/200/120'] },
  { id: '8', title: '删除违规作品', desc: '删除 3 条违规内容，封禁 1 个账号', time: '2026-07-14 11:00', type: 'action', icon: 'ri-shield-line', actor: '管理员', actorAvatar: 'https://picsum.photos/seed/admin/80/80' },
  { id: '9', title: 'CDN 配置更新', desc: '切换静态资源 CDN 至新节点，亚太区加速', time: '2026-07-12 08:00', type: 'system', icon: 'ri-cloud-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80' },
  { id: '10', title: 'v2.2.0 发布', desc: '算力系统上线、充值功能、VIP 等级', time: '2026-07-01 16:00', type: 'release', icon: 'ri-rocket-line', actor: '运维团队', actorAvatar: 'https://picsum.photos/seed/ops/80/80', version: 'v2.2.0' },
]

const filteredEvents = computed(() => {
  if (activeTab.value === 'all') return events
  return events.filter(e => e.type === activeTab.value)
})
</script>

<style scoped lang="scss">
.timeline-page { display: flex; flex-direction: column; gap: 16px; }
.timeline-container { max-width: 800px; margin: 0 auto; }

.timeline-track { display: flex; flex-direction: column; }

.timeline-node { display: flex; gap: 20px; }
.node-track { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.node-dot {
  width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 16px; z-index: 1; flex-shrink: 0;
  &.release { background: var(--app-primary-lightest, rgba(255,107,0,0.1)); color: var(--app-primary); }
  &.action { background: rgba(0,122,255,0.1); color: var(--el-color-primary); }
  &.system { background: rgba(52,199,89,0.1); color: var(--el-color-success); }
}
.node-line { width: 2px; flex: 1; background: var(--app-border-light); min-height: 16px; }

.node-card {
  flex: 1; padding: 20px; margin-bottom: 16px;
  background: var(--el-bg-color, #fff); border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-lg, 16px); transition: box-shadow 0.15s;
  &:hover { box-shadow: var(--app-shadow-sm); }
}

.node-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.node-title { font-size: 16px; font-weight: 600; color: var(--app-text); }
.node-time { font-size: 12px; color: var(--app-text-tertiary); }
.node-desc { font-size: 14px; color: var(--app-text-secondary); line-height: 1.5; margin: 0 0 12px; }

.node-changes { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; padding: 12px; background: var(--app-bg-muted, #f5f5f7); border-radius: 8px; }
.change-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.change-field { font-weight: 500; color: var(--app-text); min-width: 80px; }
.change-old { color: var(--el-color-danger); text-decoration: line-through; font-size: 12px; }
.change-arrow { color: var(--app-text-tertiary); font-size: 12px; }
.change-new { color: var(--el-color-success); font-weight: 500; font-size: 12px; }

.node-images { display: flex; gap: 8px; margin-bottom: 12px; overflow-x: auto; }
.node-img { width: 160px; height: 96px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }

.node-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--app-text-tertiary); }
.node-actor { color: var(--app-text-secondary); font-weight: 500; }
.node-version { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; padding: 2px 10px; border-radius: 10px; background: var(--app-primary-lightest, rgba(255,107,0,0.08)); color: var(--app-primary); font-size: 12px; font-weight: 600; }
</style>
