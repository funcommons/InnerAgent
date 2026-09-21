<script setup lang="ts">
/**
 * ClaimsViewer — JWT claims 可视化(jwt.io 式)。
 *
 * 上半部:三段分色原文(header 蓝 / payload 绿 / signature 灰)。
 * 下半部:header/payload claims 表(值 + 逐字段说明;exp/iat 附本地时间)。
 * 只解码不验签(验签由 InnerAgent server 完成)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DecodedJwt } from '@/site/jwt'
import { formatEpoch } from '@/site/jwt'

defineOptions({ name: 'ClaimsViewer' })

const props = defineProps<{
  decoded: DecodedJwt
  /** 原始 token 三段(分色展示用);不传则不显示原文条 */
  parts?: string[]
}>()

const { t, te } = useI18n()

/** claim 展示值:epoch 秒附本地时间,对象/数组 JSON 化,其余 String 化 */
function displayValue(value: unknown): string {
  if (typeof value === 'number' && isEpochLike(value)) {
    return `${value}(${formatEpoch(value)})`
  }
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isEpochLike(n: number): boolean {
  // exp/iat 量级(2001-09 ~ 2286 年);不含嵌套 key 判断,只按值域兜底展示
  return n > 1_000_000_000 && n < 9_999_999_999
}

function isEpochClaim(key: string, value: unknown): value is number {
  return (key === 'exp' || key === 'iat' || key === 'nbf') && typeof value === 'number'
}

function displayClaim(key: string, value: unknown): string {
  return isEpochClaim(key, value) ? `${value}(${formatEpoch(value)})` : displayValue(value)
}

/** 字段说明(i18n playground.claim-desc.<key>;未知字段无说明) */
function descOf(key: string): string {
  const keyPath = `playground.claim-desc.${key}`
  return te(keyPath) ? t(keyPath) : ''
}

interface ClaimRow {
  key: string
  value: string
  desc: string
}

function toRows(obj: Record<string, unknown>): ClaimRow[] {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: displayClaim(key, value),
    desc: descOf(key),
  }))
}

const headerRows = computed(() => toRows(props.decoded.header))
const payloadRows = computed(() => toRows(props.decoded.payload))

const segments = computed(() => {
  if (!props.parts || props.parts.length !== 3) return null
  return [
    { label: t('playground.header'), text: props.parts[0]!, tone: 'header' as const },
    { label: t('playground.payload'), text: props.parts[1]!, tone: 'payload' as const },
    { label: t('playground.signature'), text: props.parts[2]!, tone: 'signature' as const },
  ]
})
</script>

<template>
  <div class="claims-viewer" data-testid="claims-viewer">
    <!-- 三段分色原文 -->
    <div v-if="segments" class="claims-raw" data-testid="claims-raw">
      <code
        v-for="seg in segments"
        :key="seg.tone"
        class="claims-raw__seg"
        :class="`is-${seg.tone}`"
        :aria-label="seg.label"
      >
        <b class="claims-raw__tag">{{ seg.label }}</b>
        <span class="claims-raw__text">{{ seg.text }}</span>
      </code>
    </div>

    <!-- claims 表 -->
    <div class="claims-tables">
      <section class="claims-table-sec" data-testid="claims-header">
        <h4>
          <span class="dot dot--header" aria-hidden="true" />
          {{ t('playground.claims-header') }}
        </h4>
        <table class="claims-table">
          <thead>
            <tr>
              <th>{{ t('playground.claim-value-header') }}</th>
              <th>{{ t('playground.claim-value-value') }}</th>
              <th>{{ t('playground.claim-value-desc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in headerRows" :key="row.key">
              <td class="claims-key">{{ row.key }}</td>
              <td class="claims-val">{{ row.value }}</td>
              <td class="claims-desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="claims-table-sec" data-testid="claims-payload">
        <h4>
          <span class="dot dot--payload" aria-hidden="true" />
          {{ t('playground.claims-payload') }}
        </h4>
        <table class="claims-table">
          <thead>
            <tr>
              <th>{{ t('playground.claim-value-header') }}</th>
              <th>{{ t('playground.claim-value-value') }}</th>
              <th>{{ t('playground.claim-value-desc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in payloadRows" :key="row.key">
              <td class="claims-key">{{ row.key }}</td>
              <td class="claims-val">{{ row.value }}</td>
              <td class="claims-desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.claims-viewer {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---- 三段分色原文 ---- */
.claims-raw {
  display: flex;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.claims-raw__seg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.claims-raw__seg.is-header {
  flex: 1;
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  .claims-raw__text { color: var(--el-color-primary); }
}

.claims-raw__seg.is-payload {
  flex: 2.2;
  background: color-mix(in srgb, var(--el-color-success) 10%, transparent);
  .claims-raw__text { color: var(--el-color-success); }
}

.claims-raw__seg.is-signature {
  flex: 1.4;
  background: var(--el-fill-color);
  .claims-raw__text { color: var(--el-text-color-placeholder); }
}

.claims-raw__tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}

.claims-raw__text {
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---- claims 表 ---- */
.claims-tables {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.claims-table-sec {
  min-width: 0;

  h4 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
}

.dot--header { background: var(--el-color-primary); }
.dot--payload { background: var(--el-color-success); }

.claims-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;

  th,
  td {
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 600;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }
}

.claims-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.claims-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--el-text-color-regular);
}

.claims-desc {
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .claims-tables { grid-template-columns: 1fr; }
  .claims-raw { flex-direction: column; }
}
</style>
