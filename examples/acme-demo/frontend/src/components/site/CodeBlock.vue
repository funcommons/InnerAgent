<script setup lang="ts">
/**
 * CodeBlock — 文档代码块:语言徽标 + 简易 token 着色 + 一键复制。
 * 高亮走 src/site/highlight.ts(零依赖 tokenizer);复制走 copySilent + 本地态反馈。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { copySilent } from '@/composables/useClipboard'
import { tokenize } from '@/site/highlight'

defineOptions({ name: 'CodeBlock' })

const props = withDefaults(defineProps<{
  code: string
  /** 语言标识(徽标文本 + 高亮家族选择) */
  lang?: string
}>(), {
  lang: 'text',
})

const { t } = useI18n()

const tokens = computed(() => tokenize(props.code, props.lang))

// ---- 一键复制 ----
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

async function onCopy() {
  const ok = await copySilent(props.code)
  if (!ok) return
  copied.value = true
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="code-block" data-testid="code-block">
    <div class="code-block__bar">
      <span class="code-block__lang">{{ lang }}</span>
      <button
        type="button"
        class="code-block__copy"
        :class="{ 'is-copied': copied }"
        :data-testid="`code-copy${copied ? '-done' : ''}`"
        @click="onCopy"
      >
        <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'" aria-hidden="true" />
        {{ copied ? t('docs.copied') : t('docs.copy') }}
      </button>
    </div>
    <pre class="code-block__pre"><code><span
      v-for="(tok, i) in tokens"
      :key="i"
      :class="`tok-${tok.kind}`"
    >{{ tok.text }}</span></code></pre>
  </div>
</template>

<style lang="scss" scoped>
.code-block {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}

.code-block__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  background: var(--el-fill-color-light);
}

.code-block__lang {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}

.code-block__copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: var(--el-text-color-primary);
    background: var(--el-fill-color);
  }

  &.is-copied {
    color: var(--el-color-success);
  }
}

.code-block__pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.65;

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--el-text-color-primary);
  }
}

/* token 着色(主题变量适配亮暗) */
.tok-comment { color: var(--el-text-color-placeholder); font-style: italic; }
.tok-string { color: var(--el-color-success); }
.tok-keyword { color: var(--el-color-primary); font-weight: 600; }
.tok-number { color: var(--el-color-warning); }
.tok-annotation { color: #c026d3; }
.tok-tag { color: var(--el-color-danger); }
.tok-key { color: var(--el-color-primary-light-3, var(--el-color-primary)); font-weight: 600; }

html[data-theme='dark'] .tok-annotation { color: #e879f9; }
</style>
