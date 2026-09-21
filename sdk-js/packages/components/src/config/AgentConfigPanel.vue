<script setup lang="ts">
defineOptions({ name: 'AgentConfigPanel' })
/**
 * [new] P4/W15 配置视图面板 — <inneragent-chat view="config"> 的实现体。
 *
 * 依据 02-技术方案 §8.2 (「views/settings/agents.vue + skill 对话框 → SDK 配置
 * 视图(用户级)」) 与 §9.1 (「Skill/MCP 用户配置 → 迁至 SDK 配置视图」)。
 *
 * 形态决策 (WC 内嵌面板, 而非仅 headless API):
 * - WC 已有 init/tokenGetter/主题/i18n/Shadow DOM 隔离全套基建, 面板零额外接入;
 * - `view="config"` 是 §8.1 既定属性契约, 本面板填补该占位;
 * - headless 场景走 core 的 meApi/mcpUserServersApi (components 入口已 re-export)。
 *
 * 范围 (读模式为主):
 * - Skill: 只读列表 (来源 /me/reference-options; 用户面 Skill 管理端点 P4①
 *   未落, 见差距清单 —— 管理面在 inneragent-web 管理站);
 * - 三方 MCP: 列表 + 用户级启停 (POST /mcp-servers/{id}/enable|disable);
 * - credentials 仅服务端打码形 (credentialsMasked), 本组件不渲染任何原文。
 */
import { computed, onMounted, ref } from 'vue'
import {
  meApi,
  mcpUserServersApi,
  type McpUserServer,
  type AssistantReferenceOptions,
} from '@inneragent/sdk-core'
import { useI18n } from '../i18n'
import IaButton from '../ui/IaButton.vue'
import IaTag from '../ui/IaTag.vue'

const { t } = useI18n()

const loading = ref(false)
const loadError = ref('')
const referenceOptions = ref<AssistantReferenceOptions | null>(null)
const servers = ref<McpUserServer[]>([])
/** 行级启停进行中 (防重复提交) */
const busyIds = ref<Set<number>>(new Set())
/** 行级操作错误 (启停失败提示; id → 文案) */
const rowErrors = ref<Map<number, string>>(new Map())

const skills = computed(() => referenceOptions.value?.skills ?? [])

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  // 两段独立拉取: Skill 与 MCP 任一失败即整页错误态 (重试重新拉取两段)
  const [optionsResult, serversResult] = await Promise.allSettled([
    meApi.referenceOptions(),
    mcpUserServersApi.list(),
  ])
  if (optionsResult.status === 'fulfilled') referenceOptions.value = optionsResult.value
  if (serversResult.status === 'fulfilled') servers.value = serversResult.value
  if (optionsResult.status === 'rejected' || serversResult.status === 'rejected') {
    loadError.value = t('config.load-failed')
  }
  loading.value = false
}

function retry(): void {
  void load()
}

async function toggleServer(server: McpUserServer): Promise<void> {
  if (busyIds.value.has(server.id)) return
  rowErrors.value.delete(server.id)
  busyIds.value = new Set(busyIds.value).add(server.id)
  try {
    const updated = server.enabled
      ? await mcpUserServersApi.disable(server.id)
      : await mcpUserServersApi.enable(server.id)
    servers.value = servers.value.map((row) => (row.id === updated.id ? updated : row))
  } catch {
    // 行状态天然回滚 (未替换行), 仅提示
    rowErrors.value = new Map(rowErrors.value).set(server.id, t('config.update-failed'))
  } finally {
    const next = new Set(busyIds.value)
    next.delete(server.id)
    busyIds.value = next
  }
}

function authLabel(server: McpUserServer): string {
  return server.authType === 'OAUTH' ? t('config.auth-oauth') : t('config.auth-static-header')
}
</script>

<template>
  <div class="ia-config" data-testid="ia-config-panel">
    <header class="ia-config__header">
      <h2 class="ia-config__title">{{ t('config.title') }}</h2>
      <IaButton
        variant="text"
        size="sm"
        :loading="loading"
        data-testid="ia-config-refresh"
        @click="retry"
      >
        {{ t('config.action-refresh') }}
      </IaButton>
    </header>

    <div v-if="loadError" class="ia-config__error" data-testid="ia-config-error">
      <span>{{ loadError }}</span>
      <IaButton variant="secondary" size="sm" data-testid="ia-config-retry" @click="retry">
        {{ t('config.action-refresh') }}
      </IaButton>
    </div>

    <!-- ---- Skill 只读区 ---- -->
    <section class="ia-config__section">
      <h3 class="ia-config__section-title">{{ t('config.skills') }}</h3>
      <p class="ia-config__section-desc">{{ t('config.skills-desc') }}</p>
      <p v-if="!loading && skills.length === 0" class="ia-config__empty" data-testid="ia-config-skills-empty">
        {{ t('config.skills-empty') }}
      </p>
      <ul v-else class="ia-config__list">
        <li
          v-for="skill in skills"
          :key="skill.id"
          class="ia-config__item"
          data-testid="ia-config-skill-item"
        >
          <div class="ia-config__item-main">
            <span class="ia-config__item-name">{{ skill.displayName || skill.name }}</span>
            <IaTag v-if="skill.source" size="sm">{{ skill.source }}</IaTag>
          </div>
          <p v-if="skill.description" class="ia-config__item-desc">{{ skill.description }}</p>
        </li>
      </ul>
    </section>

    <!-- ---- 三方 MCP (用户级启停) ---- -->
    <section class="ia-config__section">
      <h3 class="ia-config__section-title">{{ t('config.mcp') }}</h3>
      <p class="ia-config__section-desc">{{ t('config.mcp-desc') }}</p>
      <p v-if="!loading && servers.length === 0" class="ia-config__empty" data-testid="ia-config-mcp-empty">
        {{ t('config.mcp-empty') }}
      </p>
      <ul v-else class="ia-config__list">
        <li
          v-for="server in servers"
          :key="server.id"
          class="ia-config__item"
          data-testid="ia-config-mcp-item"
        >
          <div class="ia-config__item-main">
            <span class="ia-config__item-name">{{ server.name }}</span>
            <IaTag size="sm">{{ server.serverKey }}</IaTag>
            <IaTag size="sm" :color="server.enabled ? 'success' : 'gray'">
              {{ server.enabled ? t('config.mcp-enabled') : t('config.mcp-disabled') }}
            </IaTag>
          </div>
          <p class="ia-config__item-desc">{{ server.endpointUrl }}</p>
          <p class="ia-config__item-meta">
            {{ authLabel(server) }}
            <template v-if="server.credentialsMasked"> · {{ server.credentialsMasked }}</template>
          </p>
          <p
            v-if="rowErrors.get(server.id)"
            class="ia-config__row-error"
            data-testid="ia-config-mcp-error"
          >
            {{ rowErrors.get(server.id) }}
          </p>
          <div class="ia-config__item-actions">
            <IaButton
              :variant="server.enabled ? 'secondary' : 'primary'"
              size="sm"
              :loading="busyIds.has(server.id)"
              :data-testid="`ia-config-mcp-toggle-${server.id}`"
              @click="toggleServer(server)"
            >
              {{ server.enabled ? t('config.action-disable') : t('config.action-enable') }}
            </IaButton>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.ia-config {
  height: 100%;
  overflow-y: auto;
  padding: 16px 18px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ia-config__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ia-config__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.ia-config__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--app-color-danger);
  border-radius: 8px;
  color: var(--app-color-danger);
  font-size: 13px;
  background: var(--app-bg-card);
}

.ia-config__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ia-config__section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.ia-config__section-desc {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-tertiary);
}

.ia-config__empty {
  margin: 4px 0;
  font-size: 13px;
  color: var(--app-text-secondary);
}

.ia-config__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ia-config__item {
  border: 1px solid var(--app-separator);
  border-radius: 10px;
  background: var(--app-bg-card);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ia-config__item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ia-config__item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
}

.ia-config__item-desc {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-secondary);
  word-break: break-all;
}

.ia-config__item-meta {
  margin: 0;
  font-size: 11px;
  color: var(--app-text-tertiary);
}

.ia-config__row-error {
  margin: 0;
  font-size: 12px;
  color: var(--app-color-danger);
}

.ia-config__item-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
</style>
