<script setup lang="ts">
/**
 * InnerAgent 嵌入演示(接入指南 §2 步骤⑤ / iframe 模式 README)。
 *
 * - WC 直挂(推荐):动态加载 vendor 产物 inneragent-chat.js,
 *   sdk.init({appKey, tokenGetter, baseURL, agentType}) + registerInnerAgentChat();
 *   tokenGetter 指向宿主端点 /api/ia/embed-token(缓存 + exp 临期重签,
 *   401 时 SDK 重调一次)。启动失败落错误卡 + 重试,不白屏。
 * - iframe postMessage:public/ia/iframe-host.js 的 createIframeEmbed 挂载
 *   /ia/frame.html(mountIframeAgent);token 不入 URL,经握手后的消息桥下发。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSection, FcSectionHeader, FcSelect } from '@/components/sdk'
import type { SelectOption } from '@/components/sdk'
import { demoApi, type DemoConfig } from '@/api/demo'
import { fetchIaEmbedToken } from '@/api/ia'
import { createEmbedTokenGetter, resolveInnerAgentAppKey } from '@/ia/innerAgentBridge'
import { buildIframeEmbedOptions, describeEmbedEvent, resolveFrameSrc } from '@/ia/iframeEmbed'
import { loadIframeEmbed, loadInnerAgentSdk, type IFrameEmbedHandle } from '@/ia/sdkLoader'

defineOptions({ name: 'IaEmbedChat' })

const { t } = useI18n()

const config = ref<DemoConfig | null>(null)
const mode = ref<'wc' | 'iframe'>('wc')
const mounted = ref(false)
const loading = ref(false)
const handshake = ref('')

type BootStatus = 'idle' | 'loading' | 'ready' | 'error'
const status = ref<BootStatus>('idle')
const errorDetail = ref('')

interface LogItem {
  time: string
  type: string
  detail: string
}
const logs = ref<LogItem[]>([])

const containerRef = ref<HTMLDivElement | null>(null)
let embed: IFrameEmbedHandle | null = null

const modeOptions: SelectOption[] = [
  { label: t('ia.embed.mode-wc'), value: 'wc' },
  { label: t('ia.embed.mode-iframe'), value: 'iframe' },
]

const baseURL = computed(() =>
  config.value ? `${config.value.inneragentBaseUrl.replace(/\/$/, '')}/ia/api/v1` : '/ia/api/v1')

function addLog(type: string, detail: string) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  logs.value.unshift({
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    type,
    detail,
  })
  if (logs.value.length > 50) logs.value.pop()
}

async function onMount(): Promise<void> {
  if (!config.value || !containerRef.value || status.value === 'loading') return
  await onDestroy()
  status.value = 'loading'
  errorDetail.value = ''
  loading.value = true
  try {
    // 1. 预取 embed token:拿不到明确报错进错误卡,不白屏(null = 端点没给 token)
    const token = await fetchIaEmbedToken()
    if (!token) throw new Error('GET /api/ia/embed-token 未返回 token')
    addLog('IA_TOKEN', `${token.slice(0, 16)}…`)
    if (mode.value === 'wc') {
      // 2. 动态加载 vendor SDK 产物(vue/pinia 走宿主实例,无双框架)
      const sdk = await loadInnerAgentSdk()
      // 3. init + 注册 <inneragent-chat>(幂等);tokenGetter 带缓存与临期重签
      sdk.init({
        appKey: resolveInnerAgentAppKey(config.value.appKey),
        tokenGetter: createEmbedTokenGetter(fetchIaEmbedToken),
        baseURL: baseURL.value,
        agentType: config.value.agentType,
      })
      sdk.registerInnerAgentChat()
      handshake.value = t('ia.embed.wc-ready')
    } else {
      // 4. iframe 模式:src 只给页面地址,token 经 postMessage 消息桥下发
      const host = await loadIframeEmbed()
      embed = host.createIframeEmbed(buildIframeEmbedOptions({
        appKey: resolveInnerAgentAppKey(config.value.appKey),
        agentType: config.value.agentType,
        tokenGetter: createEmbedTokenGetter(fetchIaEmbedToken),
        container: containerRef.value,
        onEvent: (event) => addLog('IA_EVENT', describeEmbedEvent(event)),
      }))
      handshake.value = t('ia.embed.handshake-pending')
      embed.ready
        .then(() => {
          handshake.value = t('ia.embed.handshake-ok')
          addLog('IA_READY', resolveFrameSrc())
        })
        .catch((error: unknown) => {
          handshake.value = t('ia.embed.handshake-fail')
          addLog('IA_ERROR', error instanceof Error ? error.message : String(error))
        })
    }
    mounted.value = true
    status.value = 'ready'
  } catch (e) {
    embed = null
    status.value = 'error'
    errorDetail.value = e instanceof Error ? e.message : String(e)
    addLog('ERROR', errorDetail.value)
  } finally {
    loading.value = false
  }
}

async function onDestroy(): Promise<void> {
  if (embed) {
    embed.destroy()
    embed = null
  }
  mounted.value = false
  status.value = 'idle'
  handshake.value = ''
  if (containerRef.value && mode.value === 'iframe') containerRef.value.innerHTML = ''
}

function retry(): void {
  void onMount()
}

/** 测试挂载点:暴露当前接入模式(组件内其余状态经 DOM 断言) */
defineExpose({ mode })

onMounted(async () => {
  try {
    config.value = await demoApi.config()
  } catch {
    errorDetail.value = t('ia.embed.config-missing')
    status.value = 'error'
  }
})

onBeforeUnmount(() => {
  void onDestroy()
})
</script>

<template>
  <div class="ia-embed">
    <FcSection>
      <FcSectionHeader :title="t('ia.embed.title')" :subtitle="t('ia.embed.subtitle')" />

      <div class="controls">
        <div class="field">
          <span class="label">{{ t('ia.embed.server') }}</span>
          <code>{{ config?.inneragentBaseUrl || '—' }}</code>
        </div>
        <div class="field">
          <span class="label">appKey</span>
          <code>{{ config?.appKey || '—' }}</code>
        </div>
        <div class="field">
          <span class="label">agentType</span>
          <code>{{ config?.agentType || '—' }}</code>
        </div>
        <div class="field">
          <span class="label">{{ t('ia.embed.mode') }}</span>
          <FcSelect v-model="mode" :options="modeOptions" style="width: 240px" />
        </div>
        <div class="actions">
          <FcButton type="primary" :loading="loading" :disabled="!config" data-testid="embed-mount" @click="onMount">
            {{ t('ia.embed.mount') }}
          </FcButton>
          <FcButton :disabled="!mounted" data-testid="embed-destroy" @click="onDestroy">
            {{ t('ia.embed.destroy') }}
          </FcButton>
        </div>
      </div>

      <!-- 启动失败:错误卡 + 重试(不白屏) -->
      <div v-if="status === 'error'" class="error" data-testid="embed-error" role="alert">
        <i class="ri-error-warning-line" aria-hidden="true" />
        <div class="error-body">
          <p class="error-title">{{ t('ia.embed.boot-failed') }}</p>
          <p class="error-detail">{{ errorDetail }}</p>
        </div>
        <FcButton size="sm" variant="secondary" data-testid="embed-retry" @click="retry">
          {{ t('ia.embed.retry') }}
        </FcButton>
      </div>

      <!-- iframe 模式:src 地址与握手状态(token 不入 URL) -->
      <p v-if="mode === 'iframe'" class="iframe-note">
        {{ t('ia.embed.iframe-src') }}:<code data-testid="embed-frame-src">{{ resolveFrameSrc() }}</code>
        <span data-testid="embed-handshake">{{ handshake }}</span>
      </p>

      <!-- WC 模式:SDK 产物注册的自定义元素 -->
      <inneragent-chat v-if="mode === 'wc' && mounted" view="chat" class="ia-chat" data-testid="ia-chat" />

      <!-- iframe 模式:容器由 createIframeEmbed 接管 -->
      <div v-show="mode === 'iframe'" ref="containerRef" class="ia-frame-container" />

      <FcSection>
        <FcSectionHeader :title="t('ia.embed.handshake-log')" />
        <p v-if="logs.length === 0" class="log-empty">{{ t('ia.embed.log-empty') }}</p>
        <ul v-else class="log-list" data-testid="embed-log">
          <li v-for="(l, i) in logs" :key="i" class="log-item">
            <span class="log-time">{{ l.time }}</span>
            <b class="log-type">{{ l.type }}</b>
            <span class="log-detail">{{ l.detail }}</span>
          </li>
        </ul>
      </FcSection>
    </FcSection>
  </div>
</template>

<style scoped lang="scss">
.ia-embed {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  margin-bottom: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  code {
    font-size: 12px;
  }
}

.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 8px;

  > i {
    font-size: 20px;
  }
}

.error-body {
  flex: 1;

  .error-title {
    margin: 0;
    font-weight: 600;
  }

  .error-detail {
    margin: 2px 0 0;
    font-size: 12px;
    word-break: break-word;
  }
}

.iframe-note {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;

  span {
    margin-left: 8px;
    color: var(--el-color-primary);
  }
}

.ia-chat {
  display: block;
  width: 100%;
  height: 560px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.ia-frame-container {
  width: 100%;
  min-height: 560px;

  :deep(iframe) {
    width: 100%;
    min-height: 560px;
    border: 0;
    border-radius: 10px;
    background: #fff;
  }
}

.log-empty {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.log-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
}

.log-item {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--el-border-color-lighter);

  .log-time {
    color: var(--el-text-color-placeholder);
    font-family: monospace;
  }

  .log-type {
    flex-shrink: 0;
    width: 90px;
    color: var(--el-color-primary);
  }

  .log-detail {
    word-break: break-all;
  }
}
</style>
