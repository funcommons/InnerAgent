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
import { useI18n } from 'vue-i18n'
import { IA_ADMIN_CONSOLE_URL } from '@/api/ia'

defineOptions({ name: 'IaAdminEmbed' })

const { t } = useI18n()
</script>

<template>
  <div class="ia-admin-embed">
    <div class="ia-admin-embed__bar">
      <span class="ia-admin-embed__hint">{{ t('ia.adminEmbed.hint') }}</span>
      <a
        class="ia-admin-embed__new-tab"
        :href="IA_ADMIN_CONSOLE_URL + '/definitions'"
        target="_blank"
        rel="noopener"
        data-testid="ia-admin-new-tab"
      >
        {{ t('ia.adminEmbed.new-tab') }}
      </a>
    </div>
    <iframe
      class="ia-admin-embed__frame"
      :src="IA_ADMIN_CONSOLE_URL + '/definitions'"
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
