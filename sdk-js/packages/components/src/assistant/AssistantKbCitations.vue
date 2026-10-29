<script setup lang="ts">
/**
 * [new] P4-W14 mini KB 引用溯源 — assistant 气泡下方「引用资料」折叠区。
 *
 * - 默认折叠, 折叠头「引用资料 · N」(i18n), aria-expanded 随点击切换;
 * - 每条 documentTitle, anchor 有则追加「 § anchor」, 缺省段省略;
 * - content 不进正文, 仅条目 title 属性 tooltip (截断由视图层负责);
 * - 0 条由父层 v-if 不渲染本组件; 异常形态由 messageKbCitations 安全回退兜底。
 */
import { ref } from 'vue'
import { useI18n } from '../i18n'
import type { AssistantKbCitationView } from './assistantKbCitations'

defineOptions({ name: 'AssistantKbCitations' })

defineProps<{ citations: AssistantKbCitationView[] }>()

const { t } = useI18n()
const expanded = ref(false)
</script>

<template>
  <div class="assistant-kb-citations" data-testid="assistant-kb-citations">
    <button
      type="button"
      class="assistant-kb-citations__toggle"
      data-testid="assistant-kb-citations-toggle"
      :aria-expanded="expanded ? 'true' : 'false'"
      @click="expanded = !expanded"
    >
      <i
        :class="expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
        aria-hidden="true"
      />
      {{ t('assistant.kb-citations-toggle', { n: citations.length }) }}
    </button>
    <ul
      v-if="expanded"
      class="assistant-kb-citations__list"
      data-testid="assistant-kb-citations-list"
    >
      <li
        v-for="(citation, index) in citations"
        :key="`assistant-kb-citation-${index}`"
        class="assistant-kb-citations__item"
        :data-testid="`assistant-kb-citation-${index}`"
        :title="citation.content"
      >
        <span class="assistant-kb-citations__doc">{{ citation.documentTitle }}</span>
        <span v-if="citation.anchor" class="assistant-kb-citations__anchor">§ {{ citation.anchor }}</span>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.assistant-kb-citations {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
}

.assistant-kb-citations__toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--app-text-secondary, var(--el-text-color-secondary));
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--app-sidebar-item-hover-bg, #f5f5f7);
  }
}

.assistant-kb-citations__list {
  margin: 0;
  padding: 4px 0 4px 10px;
  list-style: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border-left: 2px solid var(--app-separator, var(--el-border-color-lighter));
}

.assistant-kb-citations__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  color: var(--app-text, var(--el-text-color-primary));
  word-break: break-word;
}

.assistant-kb-citations__anchor {
  color: var(--app-text-secondary, var(--el-text-color-secondary));
}
</style>
