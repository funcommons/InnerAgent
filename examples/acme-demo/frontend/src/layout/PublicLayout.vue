<script setup lang="ts">
/**
 * PublicLayout — 公开官网布局(与控制台 AppLayout 侧栏形态分离)。
 *
 * 结构:SiteHeader(顶部导航) + router-view(页面主体) + SiteFooter(页脚)。
 * 路由 meta.layout = 'public' 的页面挂在本布局下,无需登录。
 */
import SiteHeader from '@/components/site/SiteHeader.vue'
import SiteFooter from '@/components/site/SiteFooter.vue'

defineOptions({ name: 'PublicLayout' })
</script>

<template>
  <div class="public-shell" data-testid="public-shell">
    <SiteHeader />
    <main class="public-main">
      <router-view />
    </main>
    <SiteFooter />
  </div>
</template>

<style lang="scss" scoped>
.public-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}

.public-main {
  flex: 1;
  min-width: 0;
}
</style>
