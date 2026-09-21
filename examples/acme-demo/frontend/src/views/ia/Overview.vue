<script setup lang="ts">
/**
 * InnerAgent 接入总览(docs/接入指南.md 五步路径)。
 * 实时拉取后端公开配置与管理面开通状态,直观验证「开通没/可达没/公钥登记没」;
 * 并给出「接入指南章节 ↔ 本 DEMO 代码位置」映射表(范式沿用原 acme README)。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSection, FcSectionHeader, FcTag } from '@/components/sdk'
import { demoApi, type DemoConfig } from '@/api/demo'
import { fetchIaServerStatus, type IaServerStatus } from '@/api/ia'

defineOptions({ name: 'IaOverview' })

const { t } = useI18n()
const router = useRouter()

const config = ref<DemoConfig | null>(null)
const serverStatus = ref<IaServerStatus | null>(null)

const steps = computed(() => [
  { key: 'step-1', done: true },
  { key: 'step-2', done: !!config.value },
  { key: 'step-3', done: serverStatus.value?.state === 'registered' },
  { key: 'step-4', done: serverStatus.value?.state === 'registered' },
  { key: 'step-5', done: true },
])

const stateTagType = computed(() => {
  switch (serverStatus.value?.state) {
    case 'registered': return 'success'
    case 'not_registered': return 'warning'
    case 'admin_key_missing': return 'info'
    default: return 'danger'
  }
})

async function load() {
  try {
    config.value = await demoApi.config()
  } catch {
    return
  }
  serverStatus.value = await fetchIaServerStatus().catch(() => null)
}

onMounted(load)
</script>

<template>
  <div class="ia-overview">
    <FcSection>
      <FcSectionHeader :title="t('ia.overview.title')" :subtitle="t('ia.overview.subtitle')" />

      <div class="steps">
        <div v-for="s in steps" :key="s.key" class="step-card" data-testid="overview-step">
          <div class="step-head">
            <span class="step-title">{{ t(`ia.overview.${s.key}`) }}</span>
            <FcTag :type="s.done ? 'success' : 'info'">{{ s.done ? '✓' : '…' }}</FcTag>
          </div>
          <p class="step-desc">{{ t(`ia.overview.${s.key}-desc`) }}</p>
        </div>
      </div>

      <div class="actions">
        <FcButton type="primary" @click="router.push('/ia/embed')">
          {{ t('ia.overview.go-embed') }}
        </FcButton>
        <FcButton @click="router.push('/ia/tools')">
          {{ t('ia.overview.go-tools') }}
        </FcButton>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader :title="t('ia.overview.status-title')" :subtitle="config?.inneragentBaseUrl">
        <template #extra>
          <FcTag :type="stateTagType" data-testid="server-state">
            {{ t(`ia.overview.state-${serverStatus?.state ?? 'unreachable'}`) }}
          </FcTag>
        </template>
      </FcSectionHeader>
      <div class="status">
        <div class="status-row">
          <span class="k">appKey</span>
          <code>{{ config?.appKey || '—' }}</code>
        </div>
        <div class="status-row">
          <span class="k">agentType</span>
          <code>{{ config?.agentType || '—' }}</code>
        </div>
        <div class="status-row">
          <span class="k">{{ t('ia.overview.field-fingerprint') }}</span>
          <code>{{ serverStatus?.signKeyFingerprint || '—' }}</code>
        </div>
        <p class="status-hint">{{ t('ia.overview.state-hint') }}</p>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader :title="t('ia.overview.mapping-title')" :subtitle="t('ia.overview.mapping-subtitle')" />
      <table class="mapping" data-testid="mapping-table">
        <thead>
          <tr>
            <th>{{ t('ia.overview.col-guide') }}</th>
            <th>{{ t('ia.overview.col-code') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in [
            { guide: '§2-①/③ 引依赖 + yaml 桥配置', code: 'backend/pom.xml + backend/src/main/resources/application.yml(inneragent.bridge.*)' },
            { guide: '§2-② 写工具 @IaTool', code: 'backend/.../tool/AcmeTicketTools.java(create_ticket/list_tickets/resolve_scope)' },
            { guide: '§2-④ 管理面注册应用/工具', code: 'backend/.../ia/InnerAgentAdminClient.java(一次性开通封装+状态自检)' },
            { guide: '§2-⑤/§4.1 签发 embed token', code: 'backend/.../ia/EmbedTokenSigner.java + web/EmbedTokenController.java;frontend src/ia/innerAgentBridge.ts(tokenGetter 缓存+临期重签)' },
            { guide: '§4.2 act token(宿主桥内环)', code: 'starter 自动装配(X-IA-Act Filter + /ia-mcp);yaml act.audiences 对齐 endpointUrl' },
            { guide: '前端 SDK 嵌入(WC 直挂)', code: 'frontend/src/views/ia/EmbedChat.vue(mode=wc)+ src/vendor/inneragent/inneragent-chat.js' },
            { guide: 'iframe postMessage 模式(token 不入 URL)', code: 'frontend/src/vendor/inneragent/iframe-host.js + public/ia/{iframe-child.js,frame.html,frame.js};EmbedChat.vue(mode=iframe)' },
            { guide: '§6.3 Webhook 订阅与验签', code: 'backend/.../ia/IaWebhookVerifier.java + web/WebhookController.java;ToolsBoard.vue 事件流' },
          ]" :key="row.guide">
            <td>{{ row.guide }}</td>
            <td><code>{{ row.code }}</code></td>
          </tr>
        </tbody>
      </table>
    </FcSection>
  </div>
</template>

<style scoped lang="scss">
.ia-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.step-card {
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
}

.step-desc {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-row {
  display: flex;
  align-items: baseline;
  gap: 12px;

  .k {
    flex-shrink: 0;
    width: 150px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  code {
    font-size: 12px;
  }
}

.status-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.mapping {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    text-align: left;
    vertical-align: top;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 600;
  }

  td:first-child {
    width: 40%;
    white-space: pre-wrap;
  }
}
</style>
