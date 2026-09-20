<script setup lang="ts">
/**
 * [adapt] AssistantChatWindow — 源: $SRC/src/components/assistant/AssistantChatWindow.vue。
 * 聊天窗口编排 (会话导航 + 消息流 + 输入区) 1:1; 适配: vue-i18n → 内置 i18n;
 * FcButton → IaButton; useUserStore → init({ appKey }) 身份 (持久化命名空间)。
 */
defineOptions({ name: 'AssistantChatWindow' })
/**
 * AssistantChatWindow — 融光助手聊天窗口 (会话导航 + 消息流 + 输入区).
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/assistant-window.tsx
 * (功能性子集; 浮动/停靠/最大化几何状态机随新前端独立页挂载方式裁剪):
 * - 挂载: initializeForUser + open=true; 卸载: open=false (等价旧 collapsed,
 *   断开前端 SSE 并转后台状态轮询)
 * - 空态: 未选中会话时显示引导 + 起始提示词 (旧 AssistantEmptyState)
 * - 标题栏: 会话标题 + 状态
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n'
import { useAssistantStore, getSdkConfig } from '@inneragent/sdk-core'
import { conversationStatusKey } from './assistantDisplay'
import AssistantConversationNav from './AssistantConversationNav.vue'
import AssistantMessageList from './AssistantMessageList.vue'
import AssistantComposer from './AssistantComposer.vue'

const props = defineProps<{ projectId?: number | null }>()

const { t } = useI18n()
const store = useAssistantStore()

onMounted(() => {
  // [adapt] 源以 userStore.userInfo?.id 水合; SDK 无 user store,
  // 以 init({ appKey }) 的 appKey 作为持久化命名空间身份。
  try {
    store.initializeForUser(getSdkConfig().appKey)
  } catch {
    // 未 init (纯组件级测试) 时跳过水合, 不阻塞渲染
  }
  store.setOpen(true)
})

onUnmounted(() => {
  store.setOpen(false)
})

const selectedRuntime = computed(() => store.selectedConversationId
  ? store.conversationStates[store.selectedConversationId]
  : undefined)

const STARTER_PROMPTS = [
  '怎么把创意整理成视频脚本？',
  '能帮我设计一组连贯分镜吗？',
  '如何统一画面提示词的风格？',
  '有哪些适合短视频的创意方向？',
] as const

function selectPrompt(prompt: string): void {
  store.setDraft(null, prompt)
}
</script>

<template>
  <div class="assistant-window" data-testid="assistant-window">
    <header class="assistant-window__head">
      <IaButton
        class="assistant-window__menu"
        variant="text"
        size="sm"
        circle
        :title="t('assistant.conversations')"
        :aria-label="t('assistant.conversations')"
        data-testid="assistant-drawer-open"
        @click="store.setDrawerOpen(true)"
      >
        <i class="ri-menu-line" />
      </IaButton>
      <div class="assistant-window__brand">
        <span class="assistant-window__logo"><i class="ri-sparkling-2-line" /></span>
        <div class="assistant-window__titles">
          <h3>{{ t('assistant.title') }}</h3>
          <p v-if="!selectedRuntime">{{ t('assistant.subtitle') }}</p>
          <p v-else :class="`is-status`">
            {{ selectedRuntime.conversation.title }}
            · {{ t(conversationStatusKey(selectedRuntime.status)) }}
          </p>
        </div>
      </div>
    </header>

    <div class="assistant-window__body">
      <AssistantConversationNav />
      <section class="assistant-window__main">
        <AssistantMessageList
          v-if="store.selectedConversationId"
          :key="store.selectedConversationId"
          :conversation-id="store.selectedConversationId"
        />
        <div
          v-else
          class="assistant-window__empty"
          data-testid="assistant-welcome"
        >
          <span class="assistant-window__empty-logo"><i class="ri-sparkling-2-line" /></span>
          <h2>{{ t('assistant.empty-title') }}</h2>
          <p>{{ t('assistant.empty-desc') }}</p>
          <div class="assistant-window__starters">
            <button
              v-for="prompt in STARTER_PROMPTS"
              :key="prompt"
              type="button"
              class="assistant-window__starter fc-button-ghost"
              @click="selectPrompt(prompt)"
            >
              <i class="ri-lightbulb-line" />
              <span>{{ prompt }}</span>
            </button>
          </div>
        </div>
        <AssistantComposer :project-id="props.projectId" />
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.assistant-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.assistant-window__menu {
  display: none;

  @media (max-width: 768px) {
    display: inline-flex;
  }
}

.assistant-window__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));
}

.assistant-window__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.assistant-window__logo,
.assistant-window__empty-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
}

.assistant-window__logo {
  width: 32px;
  height: 32px;
  font-size: 17px;
}

.assistant-window__titles {
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text);
  }

  p {
    margin: 2px 0 0;
    font-size: 11px;
    color: var(--app-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.assistant-window__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.assistant-window__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.assistant-window__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

.assistant-window__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  overflow-y: auto;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text);
  }

  p {
    margin: 0;
    font-size: 12px;
    color: var(--app-text-secondary);
    max-width: 360px;
  }
}

.assistant-window__empty-logo {
  width: 56px;
  height: 56px;
  font-size: 28px;
}

.assistant-window__starters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 560px;
  margin-top: 14px;
}

.assistant-window__starter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--app-separator, var(--el-border-color-lighter));
  background: var(--app-bg, transparent);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  color: var(--app-text);
  transition: border-color 0.15s, background 0.15s;

  > i {
    color: var(--el-color-primary, #409eff);
    font-size: 15px;
  }

  &:hover {
    border-color: var(--el-color-primary-light-5, #a0cfff);
    background: var(--app-sidebar-item-hover-bg);
  }
}

.is-spinning {
  animation: assistant-window-spin 1s linear infinite;
}

@keyframes assistant-window-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
