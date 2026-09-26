<script setup lang="ts">
/**
 * InnerAgent 管理台嵌入(/ia/admin)。
 *
 * 架构口径(P4-demo 设计评审定稿):Skill/知识库/MCP/Agent 定义是
 * InnerAgent 域的能力,管理 UI 归 InnerAgent 前端(管理台 web)——
 * 宿主 APP 只提供 APP 内部 MCP(业务工具经 @IaTool → /ia-mcp 桥)。
 * demo 控制台以 iframe 整站嵌入管理台,默认落 Agent 定义页;
 * 管理台独立管理员登录(不做 SSO:宿主用户 ≠ 平台管理员,身份分离更真实)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { IA_ADMIN_CONSOLE_URL } from '@/api/ia'

defineOptions({ name: 'IaAdminEmbed' })

const { t } = useI18n()
const route = useRoute()

/**
 * [D4/D5 · P3 2026-09-27] 管理台深链(§D4 覆盖表「管理台 · ××」行直达):
 * `/ia/admin?page=tools|usage|…` 白名单映射到管理台路由,iframe 与
 * 「新窗口打开」同步落对应页;缺省/非法值回落定义页(既有口径不变)。
 */
const ADMIN_PAGE_ROUTES: Record<string, string> = {
  apps: '/apps',
  tools: '/tools',
  definitions: '/definitions',
  'mcp-servers': '/mcp-servers',
  skills: '/skills',
  kb: '/kb',
  audit: '/audit',
  models: '/models',
  usage: '/usage',
  feedbacks: '/feedbacks',
  circuit: '/circuit',
  webhooks: '/webhooks',
}

const adminPath = computed(() => {
  const page = String(route.query.page ?? '')
  return ADMIN_PAGE_ROUTES[page] ?? '/definitions'
})
const consoleUrl = computed(() => IA_ADMIN_CONSOLE_URL + adminPath.value)
</script>

<template>
  <div class="ia-admin-embed">
    <div class="ia-admin-embed__bar">
      <span class="ia-admin-embed__hint">{{ t('ia.adminEmbed.hint') }}</span>
      <a
        class="ia-admin-embed__new-tab"
        :href="consoleUrl"
        target="_blank"
        rel="noopener"
        data-testid="ia-admin-new-tab"
      >
        {{ t('ia.adminEmbed.new-tab') }}
      </a>
    </div>
    <iframe
      class="ia-admin-embed__frame"
      :src="consoleUrl"
      :title="t('ia.adminEmbed.frame-title')"
      data-testid="ia-admin-frame"
    />
  </div>
</template>

<style scoped lang="scss">
.ia-admin-embed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;

  &__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border-radius: 8px;
  }

  &__new-tab {
    flex-shrink: 0;
    color: var(--el-color-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &__frame {
    width: 100%;
    height: calc(100vh - 170px);
    min-height: 480px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: #fff;
  }
}
</style>
