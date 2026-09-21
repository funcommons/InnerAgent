<template>
  <div class="dev-index">
    <FcSectionHeader title="开发者" />
    <FcSection class="dev-body">
      <div class="dev-grid">
        <router-link v-for="item in devItems" :key="item.path" :to="item.path" class="dev-card">
          <div class="dev-card-icon">
            <component :is="item.icon" />
          </div>
          <div class="dev-card-info">
            <h3>{{ item.title }}</h3>
            <p>{{ item.desc }}</p>
          </div>
        </router-link>

        <!-- 外观设置: 点击打开 drawer -->
        <button type="button" class="dev-card" @click="appearanceVisible = true">
          <div class="dev-card-icon">
            <component :is="appearanceItem.icon" />
          </div>
          <div class="dev-card-info">
            <h3>{{ appearanceItem.title }}</h3>
            <p>{{ appearanceItem.desc }}</p>
          </div>
        </button>
      </div>
    </FcSection>

    <!-- 外观 drawer (主题/品牌) -->
    <FcDrawer
      v-model:open="appearanceVisible"
      :title="t('preference.appearance.title')"
      direction="rtl"
      size="380px"
      drawer-class="appearance-drawer-wrap"
    >
      <FcThemeSwitcher
        v-model:brand="brand"
        v-model:theme="theme"
        variant="inline"
        :show-reset="true"
        @reset="onReset"
      />
    </FcDrawer>
  </div>
</template>

<script setup lang="ts">defineOptions({ name: 'Index' })
import { h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import FcDrawer from '@/components/sdk/overlay/FcDrawer.vue'
import { FcThemeSwitcher } from '@/components/sdk'
import type { ThemeMode } from '@/components/sdk/theme/brands'

const { t } = useI18n()

// 主题/品牌状态 (跟 FcThemeProvider 同源, 通过 localStorage 持久化)
const brand = ref<string>(localStorage.getItem('fc-theme-provider') ? JSON.parse(localStorage.getItem('fc-theme-provider')!).brand : 'ldx2')
const theme = ref<ThemeMode>(localStorage.getItem('fc-theme-provider') ? JSON.parse(localStorage.getItem('fc-theme-provider')!).theme : 'light')

function onReset() {
  // 重置: 清 localStorage + 重置到 OEM 默认
  localStorage.removeItem('fc-theme-provider')
  brand.value = 'ldx2'
  theme.value = 'light'
}

const ri = (name: string) => ({
  render: () => h('i', { class: `ri-${name}`, style: 'font-size: 28px;' }),
})

const devItems = [
  {
    path: '/dev/inspiration',
    title: '灵感广场 Demo',
    desc: '标签云 / 筛选 / 作品卡片 / 详情弹窗',
    icon: ri('compass-3-line'),
  },
  {
    path: '/dev/users',
    title: '用户管理 Demo',
    desc: '表格 / 筛选 / 充值弹窗 / 状态切换',
    icon: ri('group-line'),
  },
  {
    path: '/dev/statistics',
    title: '报表统计 Demo',
    desc: 'KPI 卡片 / ECharts 图表 / 热力图 / 日明细',
    icon: ri('bar-chart-grouped-line'),
  },
  {
    path: '/dev/workspace',
    title: '工作台概览 Demo',
    desc: '创作磁贴 / 最近资产 / 算力卡片 / 灵感推荐',
    icon: ri('dashboard-3-line'),
  },
  {
    path: '/dev/profile',
    title: '个人中心 Demo',
    desc: '封面头像 / 数据统计 / 作品收藏 / 算力记录 / 设置',
    icon: ri('user-star-line'),
  },
  {
    path: '/dev/creator',
    title: '创作工作台 Demo',
    desc: '左右分栏 · 参数面板 / 模型选择 / 提示词 / 滑块 / 预览区 / 历史记录',
    icon: ri('magic-line'),
  },
  {
    path: '/dev/detail',
    title: '作品详情 Demo',
    desc: '大图 / 缩略图切换 / 参数回显 / 操作栏 / 评论互动',
    icon: ri('image-2-line'),
  },
  {
    path: '/dev/templates',
    title: '模板市场 Demo',
    desc: '分类导航 / 卡片网格 / 精选横幅 / 预览弹窗',
    icon: ri('layout-grid-line'),
  },
  {
    path: '/dev/chat',
    title: 'AI 对话 Demo',
    desc: '会话列表 / 聊天气泡流 / 打字动画 / 快捷提问',
    icon: ri('chat-ai-line'),
  },
  {
    path: '/dev/form',
    title: '表单向导 Demo',
    desc: '多步骤 / 校验 / 参数滑块 / 确认预览 / 提交成功',
    icon: ri('file-list-3-line'),
  },
  {
    path: '/dev/search',
    title: '搜索结果 Demo',
    desc: '搜索栏 / 左侧筛选面板 / 结果列表 / 预览弹窗',
    icon: ri('search-eye-line'),
  },
  {
    path: '/dev/notifications',
    title: '通知中心 Demo',
    desc: '时间线 / 已读未读 / 分类 Tab / 操作按钮',
    icon: ri('notification-3-line'),
  },
  {
    path: '/dev/settings',
    title: '设置中心 Demo',
    desc: '左侧导航 / 右侧配置 / 开关 / 主题选择 / 存储管理',
    icon: ri('settings-4-line'),
  },
  {
    path: '/dev/kanban',
    title: '看板视图 Demo',
    desc: '多列拖拽卡片 / 优先级标签 / 任务管理',
    icon: ri('kanban-line'),
  },
  {
    path: '/dev/timeline',
    title: '时间线 Demo',
    desc: '竖向时间轴 / 版本发布 / 操作日志 / 变更记录',
    icon: ri('git-branch-line'),
  },
  {
    path: '/dev/ux-demo',
    title: 'UX 能力 Demo',
    desc: '错误边界 / 草稿 / 复制 / 命令面板 / 拖拽 / 撤销 / 幂等 / 提示',
    icon: ri('magic-line'),
  },
]

const appearanceItem = {
  title: t('preference.appearance.title'),
  desc: t('preference.appearance.themeSection') + ' / ' + t('preference.appearance.brandSection'),
  icon: ri('palette-line'),
}

const appearanceVisible = ref(false)
</script>

<style scoped lang="scss">
.dev-index {
  display: flex;
  flex-direction: column;
  gap: var(--app-block-mb);
}

.dev-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.dev-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--app-primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }
}

.dev-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: rgba(var(--app-primary-rgb, 0, 122, 255), 0.1);
  color: var(--app-primary);
  flex-shrink: 0;
}

.dev-card-info {
  h3 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  p {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }
}
</style>
