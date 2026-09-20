<script setup lang="ts">
defineOptions({ name: 'InnerAgentChat' })
/**
 * [new] <inneragent-chat> 根组件 (defineCustomElement + Shadow DOM)。
 *
 * 编排: AssistantChatWindow (会话导航 + 消息流 + 输入区)。
 * - view 属性: 'chat' (默认, 当前唯一实现); 'history' / 'config' 为占位
 *   (P2/W13 配置视图), 渲染提示文案。
 * - project-id 属性: 页面上下文 project 引用 (源 assistantPage ?projectId= 语义)。
 * - Shadow DOM 隔离: 主题令牌 --ia-* 经 :host 默认值 + --app-* 映射注入,
 *   宿主样式不会污染组件, 组件样式不会泄漏到宿主。
 * - remixicon 图标样式经 <style src="./styles/remixicon-ce.css"> 注入
 *   (woff2-only 生成子集, 见该文件头), 使 <i class="ri-*"> 在 Shadow DOM 内可用。
 */
import { computed } from 'vue'
import AssistantChatWindow from './assistant/AssistantChatWindow.vue'
import { useI18n } from './i18n'

const props = withDefaults(defineProps<{
  view?: 'chat' | 'history' | 'config'
  projectId?: number | string | null
}>(), {
  view: 'chat',
  projectId: null,
})

const { t } = useI18n()

const projectIdNumber = computed<number | null>(() => {
  const parsed = Number(props.projectId)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})

const isPlaceholderView = computed(() => props.view !== 'chat')
</script>

<template>
  <div class="ia-chat-root">
    <div v-if="isPlaceholderView" class="ia-chat-root__placeholder" data-testid="ia-view-placeholder">
      <p>{{ t('assistant.title') }} · view="{{ view }}"</p>
      <p class="ia-chat-root__placeholder-desc">
        history / config 视图为占位 (P2/W13); 当前实现: view="chat"。
      </p>
    </div>
    <AssistantChatWindow v-else :project-id="projectIdNumber" />
  </div>
</template>

<style src="./styles/remixicon-ce.css"></style>

<style>
/* ---- :host 主题令牌 (02-技术方案 §8.1: --ia-* 12 令牌) 与 --app-* 映射 ----
 * 宿主可在元素或 document root 上覆写 --ia-*; init({ theme }) 亦可全局注入。 */
:host {
  /* 默认令牌 */
  --ia-primary: #409eff;
  --ia-primary-contrast: #ffffff;
  --ia-bg: #ffffff;
  --ia-bg-card: #ffffff;
  --ia-bg-muted: #f5f5f7;
  --ia-text: #303133;
  --ia-text-secondary: #606266;
  --ia-text-tertiary: #a8abb2;
  --ia-separator: #e4e7ed;
  --ia-danger: #f56c6c;
  --ia-warning: #e6a23c;
  --ia-success: #67c23a;

  /* 组件消费的 --app-* 映射 (源组件沿用宿主 --app-* 变量名) */
  --app-primary: var(--ia-primary);
  --app-on-primary: var(--ia-primary-contrast);
  --app-bg: var(--ia-bg);
  --app-bg-card: var(--ia-bg-card);
  --app-bg-muted: var(--ia-bg-muted);
  --app-text: var(--ia-text);
  --app-text-secondary: var(--ia-text-secondary);
  --app-text-tertiary: var(--ia-text-tertiary);
  --app-separator: var(--ia-separator);
  --app-color-danger: var(--ia-danger);
  --app-color-warning: var(--ia-warning);
  --app-color-success: var(--ia-success);

  display: block;
  height: 100%;
  min-height: 320px;
  background: var(--ia-bg);
  color: var(--ia-text);
  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.ia-chat-root {
  height: 100%;
  min-height: 0;
}

.ia-chat-root__placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
  color: var(--ia-text-secondary);
  font-size: 13px;
}

.ia-chat-root__placeholder-desc {
  margin: 0;
  font-size: 11px;
  color: var(--ia-text-tertiary);
}
</style>
