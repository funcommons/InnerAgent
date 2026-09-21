<script setup lang="ts">
/**
 * [new] 管理站布局壳:侧边导航 + 顶栏(会话/登出)。
 * 导航项与视图清单一一对应;当前路由高亮。
 * P4 批次扩档:三方 MCP / Skill 管理 / 知识库(集成·知识侧)+
 * 用量统计 / 用户反馈(数据洞察侧)。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Monitor, Coin, Document, Cpu, Lightning, Connection, Tickets, SwitchButton, Link, MagicStick, Reading, TrendCharts, ChatDotRound } from '@element-plus/icons-vue'
import IaEnvBadge from '@/components/IaEnvBadge.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

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

const activePath = computed(() => `/${String(route.path).split('/')[1]}`)

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
        <el-menu-item v-for="nav in navs" :key="nav.path" :index="nav.path">
          <el-icon><component :is="nav.icon" /></el-icon>
          <span>{{ nav.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="admin-header">
        <span class="admin-header__title">{{ route.meta.title }}</span>
        <div class="admin-header__actions">
          <IaEnvBadge />
          <el-button text :icon="SwitchButton" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="admin-main">
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
.admin-main {
  background: #f5f7fa;
}
</style>
