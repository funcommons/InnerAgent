<template>
  <div class="app-page notifications-page">
    <FcSectionHeader title="通知中心 (DEMO)" subtitle="时间线 + 已读/未读 + 分类" :back="true" @back="router.back()">
      <template #actions>
        <FcButton size="small" @click="markAllRead">全部已读</FcButton>
      </template>
    </FcSectionHeader>

    <FcFilterBar>
      <FcFilterButton v-for="tab in tabs" :key="tab.value" :active="activeTab === tab.value" @click="activeTab = tab.value">
        {{ tab.label }}
        <span v-if="tab.unread" class="badge">{{ tab.unread }}</span>
      </FcFilterButton>
    </FcFilterBar>

    <div class="timeline">
      <div v-for="group in groupedNotifications" :key="group.date" class="timeline-group">
        <div class="timeline-date">{{ group.date }}</div>
        <div v-for="n in group.items" :key="n.id" class="timeline-item" :class="{ unread: !n.read }" @click="n.read = true">
          <div class="timeline-dot" :class="n.category" />
          <div class="timeline-card">
            <div class="notif-header">
              <div class="notif-icon" :class="n.category"><i :class="n.icon" /></div>
              <div class="notif-info">
                <span class="notif-title">{{ n.title }}</span>
                <span class="notif-time">{{ n.time }}</span>
              </div>
              <span v-if="!n.read" class="unread-dot" />
            </div>
            <p class="notif-body">{{ n.body }}</p>
            <div v-if="n.actions?.length" class="notif-actions">
              <FcButton v-for="a in n.actions" :key="a.label" size="small" :type="a.primary ? 'primary' : undefined" @click.stop>{{ a.label }}</FcButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="filteredNotifications.length === 0" class="empty-state">
      <i class="ri-notification-off-line" />
      <p>暂无通知</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevNotificationsPage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import { FcButton } from '@/components/sdk'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'

const router = useRouter()
const activeTab = ref('all')

interface Notification {
  id: string; title: string; body: string; time: string; date: string;
  category: string; icon: string; read: boolean;
  actions?: { label: string; primary?: boolean }[];
}

const notifications = ref<Notification[]>([
  { id: '1', title: '作品生成完成', body: '你的视频「赛博朋克城市夜景」已生成完毕，点击查看结果。', time: '10分钟前', date: '今天', category: 'system', icon: 'ri-sparkling-line', read: false, actions: [{ label: '查看', primary: true }] },
  { id: '2', title: '获得新粉丝', body: '用户「灵感猎手」关注了你', time: '30分钟前', date: '今天', category: 'social', icon: 'ri-user-add-line', read: false },
  { id: '3', title: '作品被点赞', body: '你的作品「国风水墨山水」获得了 12 个新赞', time: '1小时前', date: '今天', category: 'social', icon: 'ri-heart-line', read: false },
  { id: '4', title: '算力充值成功', body: '已成功充值 500 Credits，当前余额 8,640', time: '2小时前', date: '今天', category: 'billing', icon: 'ri-coin-line', read: true },
  { id: '5', title: '系统维护通知', body: '平台将于今晚 23:00-01:00 进行系统维护，届时部分功能可能暂时不可用', time: '5小时前', date: '今天', category: 'system', icon: 'ri-tools-line', read: true },
  { id: '6', title: '评论回复', body: 'AI画师 回复了你的评论：「谢谢分享！」', time: '昨天 16:30', date: '昨天', category: 'social', icon: 'ri-chat-3-line', read: true, actions: [{ label: '回复' }] },
  { id: '7', title: '作品审核通过', body: '你的作品「3D产品渲染」已通过审核，已在灵感广场展示', time: '昨天 14:20', date: '昨天', category: 'system', icon: 'ri-checkbox-circle-line', read: true },
  { id: '8', title: 'VIP 到期提醒', body: '你的 VIP 会员将于 7 天后到期，续费享 8 折优惠', time: '昨天 09:00', date: '昨天', category: 'billing', icon: 'ri-vip-crown-line', read: true, actions: [{ label: '续费', primary: true }] },
  { id: '9', title: '新模板上线', body: '新增 20+ 夏日风格模板，立即体验！', time: '3天前', date: '更早', category: 'system', icon: 'ri-layout-grid-line', read: true, actions: [{ label: '查看' }] },
  { id: '10', title: '邀请奖励', body: '你邀请的好友已注册，获得 200 Credits 奖励', time: '5天前', date: '更早', category: 'billing', icon: 'ri-gift-line', read: true },
])

const tabs = computed(() => [
  { label: '全部', value: 'all', unread: notifications.value.filter(n => !n.read).length },
  { label: '系统', value: 'system', unread: notifications.value.filter(n => !n.read && n.category === 'system').length },
  { label: '社交', value: 'social', unread: notifications.value.filter(n => !n.read && n.category === 'social').length },
  { label: '账单', value: 'billing', unread: notifications.value.filter(n => !n.read && n.category === 'billing').length },
])

const filteredNotifications = computed(() => {
  if (activeTab.value === 'all') return notifications.value
  return notifications.value.filter(n => n.category === activeTab.value)
})

const groupedNotifications = computed(() => {
  const groups: { date: string; items: Notification[] }[] = []
  const map = new Map<string, Notification[]>()
  for (const n of filteredNotifications.value) {
    if (!map.has(n.date)) map.set(n.date, [])
    map.get(n.date)!.push(n)
  }
  for (const [date, items] of map) groups.push({ date, items })
  return groups
})

function markAllRead() {
  notifications.value.forEach(n => n.read = true)
}
</script>

<style scoped lang="scss">
.notifications-page { display: flex; flex-direction: column; gap: 16px; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 9px; background: var(--app-primary); color: #fff; font-size: 10px; font-weight: 700; padding: 0 5px; margin-left: 4px; }

.timeline { display: flex; flex-direction: column; gap: 8px; }
.timeline-group { display: flex; flex-direction: column; gap: 8px; }
.timeline-date { font-size: 12px; font-weight: 600; color: var(--app-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 0 4px; }

.timeline-item { display: flex; gap: 12px; position: relative; padding-left: 24px;
  &.unread .timeline-card { border-left: 3px solid var(--app-primary); }
}
.timeline-dot { position: absolute; left: 6px; top: 20px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--el-bg-color, #fff);
  &.system { background: var(--el-color-primary); }
  &.social { background: var(--el-color-success); }
  &.billing { background: var(--el-color-warning); }
}

.timeline-card {
  flex: 1; padding: 16px; background: var(--el-bg-color, #fff); border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px); border-left: 3px solid transparent; cursor: pointer; transition: all 0.15s;
  &:hover { box-shadow: var(--app-shadow-sm); }
}

.notif-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.notif-icon {
  width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px;
  &.system { background: rgba(0,122,255,0.1); color: var(--el-color-primary); }
  &.social { background: rgba(52,199,89,0.1); color: var(--el-color-success); }
  &.billing { background: rgba(255,149,0,0.1); color: var(--el-color-warning); }
}
.notif-info { flex: 1; min-width: 0; }
.notif-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
.notif-time { font-size: 12px; color: var(--app-text-tertiary); margin-left: 8px; }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--app-primary); flex-shrink: 0; }

.notif-body { font-size: 13px; color: var(--app-text-secondary); line-height: 1.5; margin: 0; }
.notif-actions { display: flex; gap: 8px; margin-top: 12px; }

.empty-state { text-align: center; padding: 80px 0; color: var(--app-text-tertiary);
  i { font-size: 48px; display: block; margin-bottom: 12px; }
  p { font-size: 14px; margin: 0; }
}
</style>
