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
 *
 * 一键演示 URL 参数(2026-09-24 P0 A1,见 test-report/2026-09-24-01/99-优化建议.md §A1):
 * - ?agentType=X:已有,自动挂载到该场景
 * - ?demoMode=guided:一键演示模式——挂载后自动填输入框(per-agent prefillLine 或
 *   ?prefill= 覆盖)+ 自动点「发送」。SDK 加载 + 内部渲染需要时间,等 2s 后再
 *   找 textarea / 发送按钮
 * - ?prefill=<text>:预填模式——挂载后只填不送。prefill 优先级 > prefillLine。
 *   场景画陈列剧本步骤的「📋 预填到对话」按钮落的就是 prefill=
 *
 * 注意:本组件不修改 vendor SDK(<inneragent-chat> 黑盒),只能通过 DOM 查找
 * textarea / 按钮交互;SDK 未渲染出来则放弃并落日志(防御性)。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { FcButton, FcSection, FcSectionHeader, FcSelect } from '@/components/sdk'
import type { SelectOption } from '@/components/sdk'
import { demoApi, type DemoConfig } from '@/api/demo'
import { fetchIaEmbedToken } from '@/api/ia'
import { createEmbedTokenGetter, resolveInnerAgentAppKey } from '@/ia/innerAgentBridge'
import { buildIframeEmbedOptions, describeEmbedEvent, resolveFrameSrc } from '@/ia/iframeEmbed'
import { loadIframeEmbed, loadInnerAgentSdk, type IFrameEmbedHandle } from '@/ia/sdkLoader'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { DEMO_AGENTS, IA_EMBED_AGENT_TYPE_KEY, isDemoAgentType, type DemoAgentType } from '@/ia/demoAgents'
import { runChatAutoSequence, type ChatAutoSequenceResult } from '@/ia/chatAutoSequence'

defineOptions({ name: 'IaEmbedChat' })

const { t } = useI18n()
const router = useRouter()

const config = ref<DemoConfig | null>(null)
const mode = ref<'wc' | 'iframe'>('wc')
const mounted = ref(false)
const loading = ref(false)
const handshake = ref('')

/**
 * 演示场景选择('' = 跟随后端默认 agentType):
 * - localStorage 持久化(useLocalStorage,JSON 字符串);
 * - 画廊「开始对话」深链 ?agentType=… 优先(只认 5 场景白名单)并落持久化。
 * 注:此处直接读 window.location.search 而非 useRoute——本页不依赖路由响应式,
 * 且组件可脱离 router 上下文挂载(测试零改造)。
 */
const selectedAgentType = useLocalStorage<string>(IA_EMBED_AGENT_TYPE_KEY, '')
const deepLinkAgentType = new URLSearchParams(window.location.search).get('agentType')
const hasDeepLinkAgent = isDemoAgentType(deepLinkAgentType)
if (hasDeepLinkAgent) selectedAgentType.value = deepLinkAgentType

/**
 * 一键演示 URL 参数解析(2026-09-24 §A1):demoMode=guided 触发自动填+自动送;
 * prefill= 显式指定填入文本(优先于 per-agent prefillLine)。两者皆无 → 普通挂载。
 * URL 单次解析:此页 deep-link 仅在 onMounted 时读一次(同 agentType 深链一致),后续
 * 重挂载由用户在控件里改 agentType 触发,不再次解析 URL。
 */
const urlParams = new URLSearchParams(window.location.search)
const demoMode = urlParams.get('demoMode') === 'guided'
const hasPrefill = urlParams.has('prefill')
const prefillFromUrl = urlParams.get('prefill') ?? ''

/** 实际生效的 agentType:选中的演示场景优先,否则用后端公开配置的默认值 */
const effectiveAgentType = computed(() => {
  if (isDemoAgentType(selectedAgentType.value)) return selectedAgentType.value
  return config.value?.agentType ?? ''
})

/**
 * 一键演示「重置对话」链接 href:同 agentType + demoMode,但去 prefill。
 * 用原生 <a href> 触发硬刷新(而非 router.push),保证 vendor SDK 整体重挂载 + 自动序列重启。
 */
const resetHref = computed(() => {
  const params = new URLSearchParams()
  if (effectiveAgentType.value) params.set('agentType', effectiveAgentType.value)
  params.set('demoMode', 'guided')
  return `/ia/embed?${params.toString()}`
})

/** 仅预填模式(无 demoMode)下,挂载成功后给一行提示——demoMode 自带 banner 免重复 */
const showPrefilledHint = computed(() => hasPrefill && !demoMode && mounted.value)

/** 选择器选项:后端默认 + 5 场景(名称走 ia.demo.agents.<agentType>.name) */
const agentTypeOptions = computed<SelectOption[]>(() => [
  { label: t('ia.embed.agent-type-default', { type: config.value?.agentType ?? '—' }), value: '' },
  ...DEMO_AGENTS.map((a) => ({ label: t(`ia.demo.agents.${a.agentType}.name`), value: a.agentType })),
])

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
        agentType: effectiveAgentType.value,
      })
      sdk.registerInnerAgentChat()
      handshake.value = t('ia.embed.wc-ready')
    } else {
      // 4. iframe 模式:src 只给页面地址,token 经 postMessage 消息桥下发
      //    agentType 进 createIframeEmbed options → 握手 ready 载荷 → child init
      const host = await loadIframeEmbed()
      embed = host.createIframeEmbed(buildIframeEmbedOptions({
        appKey: resolveInnerAgentAppKey(config.value.appKey),
        agentType: effectiveAgentType.value,
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
    // 一键演示序列(2026-09-24 §A1):仅在 deep-link 进 demoMode/prefill 时触发;
    // 手动「挂载」按钮不走自动序列(避免越权)。WC 模式才需要,iframe 子页独立
    // 自管理 SDK,不在 host 侧操控。失败降级为日志(不破主流程)。
    if (mode.value === 'wc' && (demoMode || hasPrefill)) {
      void runAutoSequence()
    }
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

/** 切换演示场景:已处于挂载态(挂载中/已就绪)则销毁并以新 agentType 重建 */
function onSelectAgentType(): void {
  if (status.value === 'ready' || status.value === 'loading') void onMount()
}

/** 测试挂载点:暴露当前接入模式(组件内其余状态经 DOM 断言) */
defineExpose({ mode })

/**
 * 一键演示自动序列(2026-09-24 §A1):
 * - 解析要填的文本:URL ?prefill= 优先,否则读 per-agent prefillLine,空则降级放弃
 * - 调 chatAutoSequence 在 SDK 内部 textarea 上 set value + dispatch input +
 *   (demoMode) 找「发送」按钮 click
 * - 结果仅落 addLog,不抛错——vendor SDK 不可控,失败不能让主流程(挂载态)翻车
 *
 * 「剧本第一条」的语义:per-agent prefillLine 是各场景最适合一键演示的用户提示
 * (脚本[0] 多为元说明:「先在工具演示页直建一张…」,直接发给模型反而不合适)。
 */
async function runAutoSequence(): Promise<void> {
  const explicitPrefill = hasPrefill ? prefillFromUrl : ''
  const prefillLineText = effectiveAgentType.value
    ? (t(`ia.demo.agents.${effectiveAgentType.value}.prefillLine`) as unknown as string)
    : ''
  // vue-i18n 缺键时 t() 返回 key 路径字符串(以 'ia.demo.agents.' 开头),视为缺值
  const text =
    explicitPrefill ||
    (prefillLineText && !prefillLineText.startsWith('ia.demo.agents.') ? prefillLineText : '')
  if (!text) {
    addLog('PREFILL', '未提供预填文本(无 prefill= 且该场景无 prefillLine),跳过')
    return
  }
  const result: ChatAutoSequenceResult = await runChatAutoSequence({
    text,
    autoSend: demoMode,
    chatSelector: '[data-testid="ia-chat"]',
    // SDK vendor 产物「发送」按钮文本按 locale 切换(zh-CN「发送」/en-US「Send」);
    // helper 默认「发送」,en-US 由 chatAutoSequence 内 i18n 单独走——此处先固定 zh
    sendButtonText: '发送',
  })
  addLog(result.filled ? 'PREFILL' : 'PREFILL_SKIP', result.detail)
  if (result.sent) addLog('AUTO_SEND', result.detail)
}

/**
 * 空态引导 chip(2026-09-23 UX 优化 §A1):未挂载态时,演示员常问"我该说什么"。
 * SDK 内部空态由 vendor 产物控制不可侵入;在容器下方给一个 5 场景 chip 区,
 * 点击 → 跳到场景画陈列并展开该场景的剧本折叠(便于复制话术)。
 * chip 用 agentType 自身作为语义锚,文案走 ia.demo.agents.*.tagline。
 */
function jumpToScript(agentType: DemoAgentType): void {
  router.push({ path: '/ia/agents', query: { expand: agentType } })
}

onMounted(async () => {
  try {
    config.value = await demoApi.config()
  } catch {
    errorDetail.value = t('ia.embed.config-missing')
    status.value = 'error'
    return
  }
  // 画廊「开始对话」深链(?agentType=…):自动挂载直达对话;普通进入仍由用户点「挂载」
  if (hasDeepLinkAgent) void onMount()
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
          <code data-testid="embed-agent-type-current">{{ effectiveAgentType || '—' }}</code>
        </div>
        <div class="field">
          <span class="label">{{ t('ia.embed.agent-type') }}</span>
          <FcSelect
            v-model="selectedAgentType"
            :options="agentTypeOptions"
            style="width: 240px"
            data-testid="embed-agent-type"
            @change="onSelectAgentType"
          />
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

      <!-- 演示模式 chip(2026-09-24 §A1):挂在 chat 顶部,「重置对话」链接硬刷新同 URL(去 prefill)重演 -->
      <div
        v-if="mode === 'wc' && demoMode && mounted"
        class="demo-mode-banner"
        data-testid="demo-mode-banner"
        role="status"
      >
        <i class="ri-script-line" aria-hidden="true" />
        <span class="demo-mode-banner__text">
          {{ t('ia.embed.demo-mode-banner', { type: effectiveAgentType }) }}
        </span>
        <a
          class="demo-mode-banner__reset"
          data-testid="demo-mode-reset"
          :href="resetHref"
        >
          {{ t('ia.embed.demo-mode-reset') }}
        </a>
      </div>

      <!-- 已挂载态:发送口径提示(2026-09-23 §D2),消除 placeholder 文案歧义 -->
      <p v-if="mounted" class="send-hint" data-testid="send-hint">
        <i class="ri-keyboard-line" aria-hidden="true" />
        {{ t('ia.embed.send-hint') }}
      </p>

      <!-- 预填模式提示(2026-09-24 §A1):仅 prefill= 单独(demoMode 自带一行免冗余) -->
      <p v-if="showPrefilledHint" class="prefilled-hint" data-testid="prefilled-hint">
        <i class="ri-chat-upload-line" aria-hidden="true" />
        {{ t('ia.embed.prefilled-hint') }}
      </p>

      <!-- 空态引导(2026-09-23 §A1):未挂载态给出 5 场景"可一句话试"快捷 chip。
           SDK 内部空态由 vendor 产物控制不可侵入,此处给 host 侧兜底。
           点击 chip → 跳场景画陈列并展开该 agentType 剧本,便于复制话术。 -->
      <div v-if="!mounted" class="quick-prompts" data-testid="quick-prompts">
        <p class="quick-prompts__title">{{ t('ia.embed.quick-prompt-title') }}</p>
        <p class="quick-prompts__hint">{{ t('ia.embed.quick-prompt-hint') }}</p>
        <div class="quick-prompts__chips">
          <button
            v-for="a in DEMO_AGENTS"
            :key="a.agentType"
            type="button"
            class="quick-chip"
            :data-testid="`quick-chip-${a.agentType}`"
            @click="jumpToScript(a.agentType)"
          >
            <span class="quick-chip__name">{{ t(`ia.demo.agents.${a.agentType}.name`) }}</span>
            <span class="quick-chip__type">{{ a.agentType }}</span>
          </button>
        </div>
      </div>

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

.send-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);

  i { font-size: 14px; }
}

.ia-chat {
  display: block;
  width: 100%;
  height: 560px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

/**
 * 演示模式 chip(2026-09-24 §A1):挂在 chat 顶部高亮一行,
 * 「点此重置对话」链接硬刷新同 URL(去 prefill)重演脚本第一条。
 */
.demo-mode-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 0;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 8px;

  > i {
    font-size: 16px;
  }
}

.demo-mode-banner__text {
  flex: 1;
  min-width: 200px;
}

.demo-mode-banner__reset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-color-primary);
  text-decoration: underline;
  text-underline-offset: 3px;

  &:hover {
    color: var(--el-color-primary-light-3);
  }
}

/** 预填模式提示(prefill= 单独,无 demoMode):免抢用为 chip,克制一行小提示 */
.prefilled-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--el-color-info);
  background: var(--el-color-info-light-9);
  border-radius: 6px;

  i { font-size: 14px; }
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

.quick-prompts {
  margin: 12px 0 16px;
  padding: 14px 16px;
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 10px;
  background: var(--el-color-primary-light-9);
}

.quick-prompts__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.quick-prompts__hint {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.quick-prompts__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;

  &:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
  }
}

.quick-chip__name {
  font-weight: 600;
}

.quick-chip__type {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
