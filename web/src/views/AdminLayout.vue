<script setup lang="ts">
/**
 * [new] 管理站布局壳:侧边导航 + 顶栏(应用上下文切换器/会话/登出)。
 * 导航项与视图清单一一对应;当前路由高亮。
 * P4 批次扩档:三方 MCP / Skill 管理 / 知识库(集成·知识侧)+
 * 用量统计 / 用户反馈(数据洞察侧)。
 * 2026-09-23:顶栏应用上下文切换器(store/appContext)——Skill/知识库/用量/
 * 反馈四个应用级视图随选中应用加载(各视图 watch 并重查);定义/工具等
 * 聚合视角视图不受影响。
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Monitor, Coin, Document, Cpu, Lightning, Connection, Tickets, SwitchButton, Link, MagicStick, Reading, TrendCharts, ChatDotRound } from '@element-plus/icons-vue'
import IaEnvBadge from '@/components/IaEnvBadge.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppContextStore } from '@/stores/appContext'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const appContext = useAppContextStore()

const navs = [
  { path: '/apps', title: '应用管理', icon: Monitor },
  { path: '/tools', title: '工具注册与授权', icon: Coin },
  { path: '/definitions', title: 'Agent 定义', icon: Tickets },
  { path: '/mcp-servers', title: '三方 MCP', icon: Link },
  { path: '/skills', title: 'Skill 管理', icon: MagicStick },
  { path: '/kb', title: '知识库', icon: Reading },
  { path: '/audit', title: '审计查询', icon: Document },
  { path: '/models', title: '模型配置', icon: Cpu },
  { path: '/usage', title: '用量统计', icon: TrendCharts },
  { path: '/feedbacks', title: '用户反馈', icon: ChatDotRound },
  { path: '/circuit', title: '熔断与紧急停用', icon: Lightning },
  { path: '/webhooks', title: 'Webhook', icon: Connection },
]

/**
 * [C1 · P3 2026-09-27] 导航分组显性化(§C1):语义分组(集成中心/数据洞察/
 * 运行治理)此前只存在于面包屑,侧栏 12 项平铺看不出结构——按面包屑口径
 * 分三组渲染(⌘K 命令面板另批,不在本项)。
 */
const navGroups: { title: string; items: typeof navs }[] = [
  {
    title: '集成中心',
    items: navs.filter((n) =>
      ['/apps', '/tools', '/definitions', '/mcp-servers', '/skills', '/kb']
          .includes(n.path)),
  },
  {
    title: '数据洞察',
    items: navs.filter((n) => ['/usage', '/feedbacks'].includes(n.path)),
  },
  {
    title: '运行治理',
    items: navs.filter((n) =>
      ['/audit', '/models', '/circuit', '/webhooks'].includes(n.path)),
  },
]

/**
 * [C2 · P3 2026-09-27] 页面级「当前应用」徽标(§C2):Skill/知识库/用量/反馈
 * 四个应用级视图随顶栏切换器加载,页面本身不再回显当前应用——截屏/汇报时
 * 失焦。在应用级路由的主区顶部常驻回显(聚合视角路由不渲染)。
 */
const APP_SCOPED_PATHS = ['/skills', '/kb', '/usage', '/feedbacks']
const showAppScopeBadge = computed(() => APP_SCOPED_PATHS.includes(activePath.value))
const currentAppName = computed(() =>
  appContext.apps.find((app) => app.id === appContext.currentAppId)?.name
  ?? '')

const activePath = computed(() => `/${String(route.path).split('/')[1]}`)

onMounted(() => {
  void appContext.loadApps()
})

/** 应用管理页的增删改会影响下拉项:每次路由切换静默刷新候选列表 */
watch(activePath, () => {
  void appContext.loadApps()
})

async function handleLogout() {
  await auth.logout()
  ElMessage.success('已退出登录')
  void router.push('/login')
}
</script>

<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="admin-aside">
      <div class="admin-brand">InnerAgent 管理站</div>
      <el-menu :default-active="activePath" router class="admin-menu">
        <el-menu-item-group
          v-for="group in navGroups"
          :key="group.title"
          :title="group.title"
        >
          <el-menu-item v-for="nav in group.items" :key="nav.path" :index="nav.path">
            <el-icon><component :is="nav.icon" /></el-icon>
            <span>{{ nav.title }}</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="admin-header">
        <span class="admin-header__title">{{ route.meta.title }}</span>
        <div class="admin-header__actions">
          <el-select
            class="admin-header__app"
            data-testid="app-context-select"
            :model-value="appContext.currentAppId"
            :loading="appContext.loading"
            placeholder="应用上下文"
            @update:model-value="appContext.selectApp"
          >
            <el-option
              v-for="app in appContext.apps"
              :key="app.id"
              :label="`${app.name}(${app.appKey})`"
              :value="app.id"
            />
          </el-select>
          <IaEnvBadge />
          <el-button text :icon="SwitchButton" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="admin-main">
        <div
          v-if="showAppScopeBadge"
          class="app-scope-badge"
          data-testid="app-scope-badge"
        >
          当前应用:<b>{{ currentAppName || appContext.currentAppId }}</b>
          <span class="app-scope-badge__id">(id={{ appContext.currentAppId }})</span>
        </div>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
}
.admin-aside {
  border-right: 1px solid #e4e7ed;
  background: #fff;
}
.admin-brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-weight: 600;
  font-size: 16px;
  border-bottom: 1px solid #e4e7ed;
}
.admin-menu {
  border-right: none;
}
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}
.admin-header__title {
  font-size: 15px;
  font-weight: 600;
}
.admin-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.admin-header__app {
  width: 240px;
}
.admin-main {
  background: #f5f7fa;
}
.app-scope-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 999px;
}
.app-scope-badge__id {
  color: var(--el-text-color-secondary);
}
</style>
