<script setup lang="ts">
/**
 * API 体验台(公开):输入用户名 → 调 demo 后端 /api/demo/login(公开端点)
 * → /api/ia/embed-token(RS256 签发)→ claims 可视化 + exp 倒计时
 * → 「在控制台使用」跳控制台(未登录由守卫接管)。
 *
 * 失败态:503(未配置 IA_SIGN_PRIVATE_KEY)给配置指引;网络不通给启动提示。
 * 用独立 fetch 客户端(src/api/playground.ts),与控制台登录态互不影响。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/site/CodeBlock.vue'
import ClaimsViewer from '@/components/site/ClaimsViewer.vue'
import { playgroundApi, PlaygroundApiError, type PlaygroundSession, type PlaygroundEmbedToken } from '@/api/playground'
import { decodeJwt, formatCountdown, remainingSeconds, type DecodedJwt } from '@/site/jwt'

defineOptions({ name: 'SitePlayground' })

const { t } = useI18n()

type Phase = 'idle' | 'loading' | 'done' | 'error'
type ErrorKind = 'unconfigured' | 'unauthorized' | 'network' | 'other'

const FIX_COMMAND = 'openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out host.key\nopenssl pkey -in host.key -pubout -out host.pub'

// ---- 表单与流程状态 ----
const username = ref('')
const phase = ref<Phase>('idle')
const errorKind = ref<ErrorKind>('other')
const errorDetail = ref('')

const session = ref<PlaygroundSession | null>(null)
const embed = ref<PlaygroundEmbedToken | null>(null)
const decoded = ref<DecodedJwt | null>(null)

const canSubmit = computed(() => username.value.trim().length > 0 && phase.value !== 'loading')

// ---- 过期倒计时(1s tick) ----
const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

const expSec = computed(() => {
  const v = decoded.value?.payload.exp
  return typeof v === 'number' ? v : null
})

const remaining = computed(() => (expSec.value === null ? null : remainingSeconds(expSec.value, nowMs.value)))
const countdownText = computed(() => (remaining.value === null ? '—' : formatCountdown(remaining.value)))
const isExpired = computed(() => remaining.value !== null && remaining.value <= 0)

function startTicker() {
  stopTicker()
  nowMs.value = Date.now()
  ticker = setInterval(() => { nowMs.value = Date.now() }, 1000)
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function mapError(e: unknown): void {
  errorKind.value = 'other'
  errorDetail.value = e instanceof Error ? e.message : String(e)
  if (e instanceof PlaygroundApiError) {
    if (e.status === 503) errorKind.value = 'unconfigured'
    else if (e.status === 401) errorKind.value = 'unauthorized'
    else if (e.status === 0) errorKind.value = 'network'
  }
}

async function issueToken() {
  if (!session.value) {
    phase.value = 'idle'
    return
  }
  phase.value = 'loading'
  try {
    embed.value = await playgroundApi.embedToken(session.value.token)
    decoded.value = decodeJwt(embed.value.token)
    phase.value = 'done'
    startTicker()
  } catch (e) {
    mapError(e)
    phase.value = 'error'
  }
}

async function submit() {
  const name = username.value.trim()
  if (!name || phase.value === 'loading') return
  phase.value = 'loading'
  try {
    session.value = await playgroundApi.login(name)
  } catch (e) {
    mapError(e)
    phase.value = 'error'
    return
  }
  await issueToken()
}

onMounted(() => {
  if (phase.value === 'done') startTicker()
})

onBeforeUnmount(stopTicker)
</script>

<template>
  <div class="playground">
    <header class="pg-head">
      <h1 data-testid="pg-title">{{ t('playground.title') }}</h1>
      <p>{{ t('playground.subtitle') }}</p>
    </header>

    <div class="pg-grid">
      <!-- ===== 左:流程表单 ===== -->
      <section class="pg-card" data-testid="pg-form">
        <ol class="pg-steps">
          <li :class="{ 'is-on': true }">{{ t('playground.step-1') }}</li>
          <li :class="{ 'is-on': phase === 'loading' || phase === 'done' }">{{ t('playground.step-2') }}</li>
          <li :class="{ 'is-on': phase === 'done' }">{{ t('playground.step-3') }}</li>
        </ol>

        <label class="pg-label" for="pg-username">{{ t('playground.username-label') }}</label>
        <div class="pg-row">
          <input
            id="pg-username"
            v-model="username"
            class="pg-input"
            type="text"
            :placeholder="t('playground.username-placeholder')"
            :disabled="phase === 'loading'"
            data-testid="pg-username"
            @keyup.enter="submit"
          >
          <button
            type="button"
            class="pg-btn"
            :disabled="!canSubmit"
            data-testid="pg-submit"
            @click="submit"
          >
            <i v-if="phase === 'loading'" class="ri-loader-4-line pg-spin" aria-hidden="true" />
            {{ phase === 'loading' ? t('playground.issuing') : t('playground.submit') }}
          </button>
        </div>
        <p class="pg-note">
          <i class="ri-information-line" aria-hidden="true" />
          {{ t('playground.demo-note') }}
        </p>

        <!-- 成功态:会话/token 元信息 -->
        <template v-if="phase === 'done' && embed && session">
          <div class="pg-meta" data-testid="pg-meta">
            <div class="pg-meta__row">
              <span>{{ t('playground.username-label') }}</span>
              <code data-testid="pg-username-value">{{ session.username }}</code>
            </div>
            <div class="pg-meta__row">
              <span>sub</span>
              <code data-testid="pg-sub">{{ String(decoded?.payload.sub ?? session.userId) }}</code>
            </div>
            <div class="pg-meta__row">
              <span>{{ t('playground.appkey-label') }}</span>
              <code data-testid="pg-appkey">{{ embed.appKey }}</code>
            </div>
          </div>

          <div
            class="pg-countdown"
            :class="{ 'is-expired': isExpired }"
            data-testid="pg-countdown"
            role="timer"
            :aria-label="t('playground.countdown')"
          >
            <template v-if="!isExpired">
              <i class="ri-timer-line" aria-hidden="true" />
              <span class="pg-countdown__cap">{{ t('playground.countdown') }}</span>
              <b class="pg-countdown__time">{{ countdownText }}</b>
            </template>
            <template v-else>
              <i class="ri-error-warning-line" aria-hidden="true" />
              <b>{{ t('playground.expired') }}</b>
              <span class="pg-countdown__hint">{{ t('playground.expired-hint') }}</span>
            </template>
          </div>

          <button type="button" class="pg-btn pg-btn--ghost" data-testid="pg-reissue" @click="issueToken">
            <i class="ri-refresh-line" aria-hidden="true" />
            {{ t('playground.reissue') }}
          </button>

          <router-link to="/ia/overview" class="pg-btn pg-btn--primary" data-testid="pg-console">
            {{ t('playground.use-console') }}
            <i class="ri-arrow-right-line" aria-hidden="true" />
          </router-link>
        </template>
      </section>

      <!-- ===== 右:claims 可视化 / 失败态 ===== -->
      <section class="pg-card pg-card--wide">
        <template v-if="phase === 'done' && decoded && embed">
          <div class="pg-signed" data-testid="pg-signed-ok">
            <i class="ri-checkbox-circle-line" aria-hidden="true" />
            {{ t('playground.signed-ok') }}
          </div>
          <ClaimsViewer :decoded="decoded" :parts="embed.token.split('.')" />

          <div class="pg-raw">
            <p class="pg-raw__cap">{{ t('playground.raw-token') }}</p>
            <CodeBlock :code="embed.token" lang="text" />
          </div>
        </template>

        <!-- 失败态(503 / 401 / 网络 / 其他) -->
        <div v-else-if="phase === 'error'" class="pg-error" data-testid="pg-error" role="alert">
          <div class="pg-error__head">
            <i class="ri-error-warning-line" aria-hidden="true" />
            <b>{{ t('playground.error.title') }}</b>
          </div>
          <p class="pg-error__msg" data-testid="pg-error-msg">{{ t(`playground.error.${errorKind}`) }}</p>
          <p v-if="errorDetail" class="pg-error__detail" data-testid="pg-error-detail">{{ errorDetail }}</p>

          <template v-if="errorKind === 'unconfigured'">
            <div class="pg-fix">
              <h4 data-testid="pg-fix-title">{{ t('playground.fix-title') }}</h4>
              <p>{{ t('playground.fix-desc') }}</p>
              <p class="pg-fix__cap">{{ t('playground.fix-cmd') }}</p>
              <CodeBlock :code="FIX_COMMAND" lang="bash" />
            </div>
          </template>

          <button v-if="errorKind !== 'unconfigured'" type="button" class="pg-btn pg-btn--ghost" data-testid="pg-retry" @click="submit">
            <i class="ri-refresh-line" aria-hidden="true" />
            {{ t('playground.submit') }}
          </button>
        </div>

        <!-- 空态 -->
        <div v-else class="pg-empty" data-testid="pg-empty">
          <i class="ri-terminal-box-line" aria-hidden="true" />
          <p>{{ t('playground.step-1') }} → {{ t('playground.step-2') }} → {{ t('playground.step-3') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.playground {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px 72px;
}

.pg-head {
  margin-bottom: 26px;

  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 10px 0 0;
    font-size: 15px;
    color: var(--el-text-color-secondary);
  }
}

.pg-grid {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.pg-card {
  padding: 22px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 12px;
  background: var(--el-bg-color);

  &--wide { min-width: 0; }
}

/* 步骤条 */
.pg-steps {
  display: flex;
  gap: 8px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
  counter-reset: pgstep;

  li {
    flex: 1;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    text-align: center;

    &::before {
      counter-increment: pgstep;
      content: counter(pgstep) ' ';
      font-weight: 700;
      color: var(--el-text-color-placeholder);
    }

    &.is-on {
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);

      &::before { color: var(--el-color-primary); }
    }
  }
}

.pg-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pg-row {
  display: flex;
  gap: 10px;
}

.pg-input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
  }

  &::placeholder { color: var(--el-text-color-placeholder); }
}

.pg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &--primary {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);

    &:hover { filter: brightness(1.06); }
  }

  &--ghost {
    width: 100%;
    margin-top: 12px;

    &:hover { border-color: var(--el-color-primary-light-5); }
  }
}

.pg-spin {
  animation: pg-rotate 0.9s linear infinite;
}

@keyframes pg-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.pg-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);

  i { flex-shrink: 0; margin-top: 2px; color: var(--el-color-primary); }
}

/* 元信息 */
.pg-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 9px;
}

.pg-meta__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;

  span { color: var(--el-text-color-secondary); white-space: nowrap; }
  code { color: var(--el-text-color-primary); word-break: break-all; text-align: right; }
}

/* 倒计时 */
.pg-countdown {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 9px;
  background: var(--el-color-success-light-9, #f0f9eb);
  color: var(--el-color-success);

  &.is-expired {
    background: var(--el-color-danger-light-9, #fef0f0);
    color: var(--el-color-danger);
    flex-wrap: wrap;
  }

  i { font-size: 18px; }
}

.pg-countdown__cap {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.pg-countdown__time {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.pg-countdown__hint {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 签发成功徽标 */
.pg-signed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-success);
  background: var(--el-color-success-light-9, #f0f9eb);
}

/* 原始 token */
.pg-raw {
  margin-top: 16px;

  .pg-raw__cap {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

/* 失败态 */
.pg-error {
  .pg-error__head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    color: var(--el-color-danger);

    i { font-size: 19px; }
  }

  .pg-error__msg {
    margin: 12px 0 0;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--el-text-color-regular);
  }

  .pg-error__detail {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--el-text-color-placeholder);
    word-break: break-all;
  }
}

.pg-fix {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px dashed var(--el-color-warning);
  border-radius: 10px;

  h4 {
    margin: 0 0 6px;
    font-size: 14px;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }

  .pg-fix__cap {
    margin-bottom: 6px;
    font-weight: 600;
  }
}

/* 空态 */
.pg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 16px;
  color: var(--el-text-color-placeholder);
  text-align: center;

  i { font-size: 40px; }
  p { margin: 0; font-size: 13px; }
}

@media (max-width: 960px) {
  .pg-grid { grid-template-columns: 1fr; }
}
</style>
