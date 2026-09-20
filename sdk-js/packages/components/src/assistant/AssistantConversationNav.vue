<script setup lang="ts">
/**
 * [adapt] AssistantConversationNav — 源: $SRC/src/components/assistant/AssistantConversationNav.vue。
 * 会话列表 (翻页/状态图标/删除确认) 1:1; 适配: import 重锚 + 内置 i18n;
 * FcButton/FcDialog → IaButton/IaDialog; notifyError (ElNotification) → console.error。
 */
defineOptions({ name: 'AssistantConversationNav' })
/**
 * AssistantConversationNav — 助手会话列表.
 *
 * 对齐旧 ai-fusion-video-web/components/dashboard/assistant/conversation-navigation.tsx:
 * - 新建对话 / 选中切换 / 滚动到底或点击"加载更多"翻页 (去重)
 * - 行内状态图标 (运行中/待确认/失败/已取消/未读/完成) + 相对时间
 * - 删除: 运行中禁用; FcDialog 二次确认; 乐观会话走 by-conversation-id
 */
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import { useAssistantStore } from '@inneragent/sdk-core'
import IaButton from '../ui/IaButton.vue'
import IaDialog from '../ui/IaDialog.vue'
import {
  conversationStatusKey,
  conversationStatusTone,
  relativeTimeParts,
} from './assistantDisplay'

const emit = defineEmits<{ selected: [] }>()

const { t } = useI18n()
const store = useAssistantStore()

const STATUS_ICON: Record<string, string> = {
  running: 'ri-loader-4-line',
  waiting: 'ri-error-warning-line',
  failed: 'ri-close-circle-line',
  cancelled: 'ri-ban-line',
  unread: 'ri-error-warning-line',
  done: 'ri-checkbox-circle-line',
}

function toneClass(status: string | undefined, unread: boolean): string {
  return `is-${conversationStatusTone(status, unread)}`
}

function isRunningStatus(status: string | undefined): boolean {
  return !!status && ['running', 'pending', 'RUNNING', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(status)
}

function onScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement
  if (store.hasMoreConversations && !store.conversationsLoading
    && element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
    store.loadMoreConversations()
  }
}

// ---- 删除确认 ----
interface DeleteTarget {
  conversationId: string
  id: number
  title: string
}
const deleteTarget = ref<DeleteTarget | null>(null)
const deleteError = ref<string | null>(null)
const deleting = ref(false)

const deleteOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (v: boolean) => { if (!v) deleteTarget.value = null },
})

function askDelete(conversationId: string, id: number, title: string): void {
  deleteError.value = null
  deleteTarget.value = { conversationId, id, title }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await store.deleteConversation(deleteTarget.value.conversationId, deleteTarget.value.id)
    deleteTarget.value = null
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('assistant.delete-failed')
  } finally {
    deleting.value = false
  }
}

function select(conversationId: string): void {
  try {
    store.selectConversation(conversationId)
    emit('selected')
  } catch (error) {
    console.error(`[inneragent-chat] ${t('assistant.delete-failed')}`, error)
  }
}
</script>

<template>
  <aside class="assistant-nav" :class="{ 'is-drawer': store.drawerOpen }" data-testid="assistant-nav">
    <div v-if="store.drawerOpen" class="assistant-nav__mask" @click="store.setDrawerOpen(false)" />
    <div class="assistant-nav__head">
      <div>
        <p class="assistant-nav__title">{{ t('assistant.conversations') }}</p>
        <p class="assistant-nav__sub">{{ t('assistant.conversations-only') }}</p>
      </div>
      <IaButton
        class="assistant-nav__close"
        variant="secondary"
        size="sm"
        circle
        :title="t('common.close')"
        :aria-label="t('common.close')"
        data-testid="assistant-drawer-close"
        @click="store.setDrawerOpen(false)"
      >
        <i class="ri-close-line" />
      </IaButton>
      <IaButton
        variant="secondary"
        size="sm"
        circle
        :title="t('assistant.new-conversation')"
        data-testid="assistant-new-conversation"
        @click="store.startNewConversation()"
      >
        <i class="ri-add-line" />
      </IaButton>
    </div>

    <div class="assistant-nav__list" @scroll="onScroll">
      <div
        v-if="store.conversations.length === 0 && !store.conversationsLoading"
        class="assistant-nav__empty"
        data-testid="assistant-nav-empty"
      >
        <i class="ri-chat-new-line" />
        <p>{{ t('assistant.empty-conversations') }}</p>
        <IaButton variant="secondary" size="sm" @click="store.startNewConversation()">
          {{ t('assistant.start-new') }}
        </IaButton>
      </div>

      <div
        v-for="conversation in store.conversations"
        :key="conversation.conversationId"
        role="button"
        tabindex="0"
        class="assistant-nav__item"
        :class="{ 'is-selected': conversation.conversationId === store.selectedConversationId }"
        :data-testid="`assistant-conversation-${conversation.conversationId}`"
        @click="select(conversation.conversationId)"
        @keydown.enter="select(conversation.conversationId)"
        @keydown.space.prevent="select(conversation.conversationId)"
      >
        <i
          class="assistant-nav__status"
          :class="[
            STATUS_ICON[conversationStatusTone(
              store.conversationStates[conversation.conversationId]?.status,
              store.conversationStates[conversation.conversationId]?.unread ?? false,
            )],
            toneClass(
              store.conversationStates[conversation.conversationId]?.status,
              store.conversationStates[conversation.conversationId]?.unread ?? false,
            ),
            { 'is-spinning': conversationStatusTone(
              store.conversationStates[conversation.conversationId]?.status,
              store.conversationStates[conversation.conversationId]?.unread ?? false,
            ) === 'running' },
          ]"
        />
        <span class="assistant-nav__main">
          <span class="assistant-nav__name" :title="conversation.title">
            {{ conversation.title || t('assistant.new-conversation') }}
          </span>
          <span class="assistant-nav__meta">
            <span>{{ t(conversationStatusKey(store.conversationStates[conversation.conversationId]?.status)) }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ t(relativeTimeParts(conversation.lastMessageTime ?? conversation.createTime).key, {
              n: relativeTimeParts(conversation.lastMessageTime ?? conversation.createTime).n ?? 0,
            }) }}</span>
            <span
              v-if="store.conversationStates[conversation.conversationId]?.unread"
              class="assistant-nav__unread"
              :title="t('assistant.unread')"
            />
          </span>
        </span>
        <button
          type="button"
          class="assistant-nav__delete fc-button-ghost"
          :title="isRunningStatus(store.conversationStates[conversation.conversationId]?.status)
            ? t('assistant.running-delete-disabled') : t('assistant.delete-conversation')"
          :disabled="isRunningStatus(store.conversationStates[conversation.conversationId]?.status)"
          :data-testid="`assistant-delete-${conversation.conversationId}`"
          @click.stop="askDelete(conversation.conversationId, conversation.id, conversation.title)"
        >
          <i class="ri-delete-bin-line" />
        </button>
      </div>

      <p v-if="store.conversationsLoading" class="assistant-nav__loading">
        <i class="ri-loader-4-line is-spinning" />
        {{ t('assistant.loading') }}
      </p>
      <button
        v-else-if="store.hasMoreConversations"
        type="button"
        class="assistant-nav__more fc-button-ghost"
        data-testid="assistant-load-more"
        @click="store.loadMoreConversations()"
      >
        {{ t('assistant.load-more') }}
      </button>
    </div>

    <IaDialog
      v-model:open="deleteOpen"
      :title="t('assistant.delete-title')"
      width="400px"
    >
      <p class="assistant-nav__delete-desc">
        {{ t('assistant.delete-desc', { title: deleteTarget?.title || t('assistant.new-conversation') }) }}
      </p>
      <p v-if="deleteError" class="assistant-nav__delete-error" data-testid="assistant-delete-error">
        {{ deleteError }}
      </p>
      <template #footer>
        <div class="assistant-nav__delete-actions">
          <IaButton variant="secondary" size="sm" @click="deleteOpen = false">
            {{ t('assistant.cancel') }}
          </IaButton>
          <IaButton variant="danger" size="sm" :loading="deleting" data-testid="assistant-delete-confirm" @click="confirmDelete">
            {{ t('assistant.delete-confirm') }}
          </IaButton>
        </div>
      </template>
    </IaDialog>
  </aside>
</template>

<style lang="scss" scoped>
.assistant-nav__mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(0, 0, 0, 0.4);
}

.assistant-nav__close {
  display: none;
}

.assistant-nav {
  width: 220px;
  position: relative;

  @media (max-width: 768px) {
    &:not(.is-drawer) {
      display: none;
    }

    &.is-drawer {
      position: fixed;
      inset: 0 auto 0 0;
      width: 260px;
      z-index: 60;
      background: var(--app-bg, var(--el-bg-color));
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);

      .assistant-nav__close {
        display: inline-flex;
      }
    }
  }

  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--app-separator, var(--el-border-color-lighter));
}

.assistant-nav__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));

  > div {
    min-width: 0;
  }
}

.assistant-nav__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
}

.assistant-nav__sub {
  margin: 2px 0 0;
  font-size: 10px;
  color: var(--app-text-tertiary, var(--app-text-secondary));
}

.assistant-nav__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.assistant-nav__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 12px;
  text-align: center;
  color: var(--app-text-secondary);
  font-size: 12px;

  i {
    font-size: 26px;
    opacity: 0.4;
  }

  p {
    margin: 0;
  }
}

.assistant-nav__item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 2px;
  border: none;
  border-radius: 10px;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;

  &:hover {
    background: var(--app-sidebar-item-hover-bg);

    .assistant-nav__delete {
      opacity: 1;
    }
  }

  &.is-selected {
    background: var(--el-color-primary-light-9, #ecf5ff);
  }
}

.assistant-nav__status {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 13px;

  &.is-running { color: var(--el-color-primary, #409eff); }
  &.is-waiting { color: var(--el-color-warning, #e6a23c); }
  &.is-failed { color: var(--el-color-danger, #f56c6c); }
  &.is-cancelled { color: var(--app-text-tertiary, #a8abb2); }
  &.is-unread { color: var(--el-color-warning, #e6a23c); }
  &.is-done { color: var(--el-color-success, #67c23a); }

  &.is-spinning { animation: assistant-nav-spin 1s linear infinite; }
}

@keyframes assistant-nav-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.assistant-nav__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.assistant-nav__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-nav__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 10px;
  color: var(--app-text-secondary);
}

.assistant-nav__unread {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary, #409eff);
}

.assistant-nav__delete {
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--app-text-tertiary, var(--app-text-secondary));
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;

  &:hover:not(:disabled) {
    color: var(--el-color-danger, #f56c6c);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
}

.assistant-nav__loading,
.assistant-nav__more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 0;
  font-size: 11px;
  color: var(--app-text-secondary);
  background: none;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--app-text);
  }
}

.is-spinning {
  animation: assistant-nav-spin 1s linear infinite;
}

.assistant-nav__delete-desc {
  margin: 0;
  font-size: 13px;
  color: var(--app-text);
  line-height: 1.6;
}

.assistant-nav__delete-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);
}

.assistant-nav__delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
