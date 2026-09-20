<script setup lang="ts">
/**
 * [port] AssistantMarkdown — 源: $SRC/src/components/assistant/AssistantMarkdown.vue。1:1 复制。
 */
defineOptions({ name: 'AssistantMarkdown' })
/**
 * AssistantMarkdown — 助手 Markdown 渲染挂点.
 *
 * 对应旧 ai-fusion-video-web/components/dashboard/stream-markdown.tsx (StreamMarkdown)
 * 的轻量对应物: content 经 assistantMarkdown.renderMarkdown 产出安全 HTML
 * (入口全量转义 + 仅 http(s) 链接), v-html 注入; compact 档用于工具结果 /
 * 子 Agent 内容 / reasoning 等次级区域 (旧 compact/tone=muted 口径)。
 */
import { computed } from 'vue'
import { renderMarkdown } from './assistantMarkdown'

const props = withDefaults(
  defineProps<{
    /** Markdown 原文 (流式增量, 每次重渲) */
    content: string
    /** 紧凑档 (工具结果/嵌套区域, 旧 compact 口径) */
    compact?: boolean
  }>(),
  { compact: false },
)

const html = computed(() => renderMarkdown(props.content))
</script>

<template>
  <div class="assistant-markdown" :class="{ 'is-compact': compact }" data-testid="assistant-markdown" v-html="html" />
</template>

<style lang="scss" scoped>
.assistant-markdown {
  min-width: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--app-text);
  word-break: break-word;

  :deep(.md-p) {
    margin: 0 0 8px;
    white-space: pre-wrap;

    &:last-child { margin-bottom: 0; }
  }

  :deep(.md-heading) {
    margin: 10px 0 6px;
    font-weight: 600;
    line-height: 1.4;

    &:first-child { margin-top: 0; }
  }

  :deep(h1.md-heading) { font-size: 17px; }
  :deep(h2.md-heading) { font-size: 16px; }
  :deep(h3.md-heading) { font-size: 15px; }
  :deep(h4.md-heading) { font-size: 14px; }
  :deep(h5.md-heading), :deep(h6.md-heading) { font-size: 13px; }

  :deep(.md-list) {
    margin: 0 0 8px;
    padding-left: 20px;

    &:last-child { margin-bottom: 0; }

    li { margin: 2px 0; }
  }

  :deep(.md-quote) {
    margin: 0 0 8px;
    padding: 4px 10px;
    border-left: 3px solid var(--app-separator, var(--el-border-color, #dcdfe6));
    color: var(--app-text-secondary);

    &:last-child { margin-bottom: 0; }
  }

  :deep(.md-hr) {
    margin: 10px 0;
    border: none;
    border-top: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));
  }

  :deep(.md-table) {
    display: block;
    width: 100%;
    margin: 0 0 8px;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 12px;
    border: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));
    border-radius: 6px;

    &:last-child { margin-bottom: 0; }

    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));
    }

    th {
      font-weight: 600;
      white-space: nowrap;
      background: var(--app-bg-muted, #f5f5f7);
    }

    tbody tr:last-child td { border-bottom: none; }
  }

  :deep(.md-codeblock) {
    margin: 0 0 8px;
    overflow: hidden;
    border: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));
    border-radius: 8px;

    &:last-child { margin-bottom: 0; }
  }

  :deep(.md-codeblock__head) {
    display: flex;
    align-items: center;
    padding: 4px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-secondary);
    background: var(--app-bg-muted, #f5f5f7);
  }

  :deep(.md-pre) {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.6;
    background: var(--app-bg-muted, #f5f5f7);
  }

  :deep(.md-code) {
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86em;
    border-radius: 4px;
    background: var(--app-bg-muted, #f5f5f7);
  }

  :deep(.md-pre .md-code) {
    padding: 0;
    background: transparent;
  }

  :deep(a) {
    color: var(--el-color-primary, #409eff);
    text-decoration: none;

    &:hover { text-decoration: underline; }
  }

  :deep(.md-img) {
    max-width: 100%;
    border-radius: 8px;
  }

  &.is-compact {
    font-size: 12px;
    line-height: 1.6;
    color: var(--app-text-secondary);

    :deep(.md-heading) { font-size: 12px; }
  }
}
</style>
