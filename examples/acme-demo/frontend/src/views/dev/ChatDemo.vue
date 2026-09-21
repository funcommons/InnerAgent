<template>
  <div class="app-page chat-page">
    <FcSectionHeader title="AI 对话 (DEMO)" subtitle="会话列表 + 聊天气泡 + 输入框" :back="true" @back="router.back()" />

    <div class="chat-layout">
      <!-- 左侧会话列表 -->
      <aside class="chat-sidebar">
        <div class="sidebar-header">
          <FcButton type="primary" size="small" class="new-chat-btn" @click="newChat">
            <i class="ri-add-line" /> 新对话
          </FcButton>
        </div>
        <div class="chat-list">
          <div v-for="conv in conversations" :key="conv.id" class="chat-item" :class="{ active: activeConv === conv.id }" @click="activeConv = conv.id">
            <div class="chat-item-icon"><i class="ri-chat-3-line" /></div>
            <div class="chat-item-info">
              <span class="chat-item-title">{{ conv.title }}</span>
              <span class="chat-item-time">{{ conv.time }}</span>
            </div>
            <button class="chat-item-delete" @click.stop="deleteConv(conv.id)"><i class="ri-delete-bin-line" /></button>
          </div>
        </div>
      </aside>

      <!-- 右侧聊天区 -->
      <main class="chat-main">
        <!-- 消息流 -->
        <div class="message-flow" ref="flowRef">
          <div v-if="currentMessages.length === 0" class="chat-empty">
            <div class="empty-icon"><i class="ri-robot-2-line" /></div>
            <h3>开始新对话</h3>
            <p>向 AI 助手提问，获取创作灵感</p>
            <div class="quick-prompts">
              <button v-for="qp in quickPrompts" :key="qp" class="quick-prompt" @click="sendMessage(qp)">{{ qp }}</button>
            </div>
          </div>

          <div v-for="msg in currentMessages" :key="msg.id" class="message-row" :class="msg.role">
            <template v-if="msg.role === 'assistant'">
              <div class="msg-avatar assistant"><i class="ri-robot-2-line" /></div>
              <div class="msg-bubble assistant">
                <p>{{ msg.content }}</p>
                <div class="msg-actions">
                  <button @click="copyMsg(msg.content)"><i class="ri-file-copy-line" /></button>
                  <button><i class="ri-thumb-up-line" /></button>
                  <button><i class="ri-thumb-down-line" /></button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="msg-bubble user">
                <p>{{ msg.content }}</p>
              </div>
              <div class="msg-avatar user"><i class="ri-user-line" /></div>
            </template>
          </div>

          <div v-if="typing" class="message-row assistant">
            <div class="msg-avatar assistant"><i class="ri-robot-2-line" /></div>
            <div class="msg-bubble assistant typing">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </div>
          </div>
        </div>

        <div class="input-area">
          <div class="input-row">
            <button class="input-action"><i class="ri-attachment-line" /></button>
            <textarea
              v-model="inputText"
              class="chat-input"
              rows="1"
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
              @keydown.enter.exact.prevent="handleSend"
              @input="autoResize"
            />
            <button class="input-action" @click="handleSend"><i class="ri-send-plane-fill" /></button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevChatPage' })
import { ref, computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import { FcButton } from '@/components/sdk'

const router = useRouter()
const activeConv = ref('c1')
const inputText = ref('')
const typing = ref(false)
const flowRef = ref<HTMLElement | null>(null)

interface Message { id: string; role: 'user' | 'assistant'; content: string }
interface Conversation { id: string; title: string; time: string; messages: Message[] }

const conversations = ref<Conversation[]>([
  { id: 'c1', title: '赛博朋克风格创作', time: '刚刚', messages: [
    { id: 'm1', role: 'user', content: '帮我写一段赛博朋克风格的提示词，用于生成城市夜景' },
    { id: 'm2', role: 'assistant', content: '好的！这是一个精心设计的赛博朋克城市夜景提示词：\n\nCyberpunk cityscape at night, neon signs reflecting on wet streets, towering skyscrapers with holographic advertisements, flying cars streaking through rain, dense urban canyon, volumetric fog, cinematic lighting, ultra-detailed, 8K resolution, blade runner aesthetic\n\n建议参数：CFG 7.5, 步数 30, 尺寸 16:9。如果需要调整风格或添加特定元素，告诉我！' },
    { id: 'm3', role: 'user', content: '能不能加入一些东方元素？' },
    { id: 'm4', role: 'assistant', content: '当然！加入东方元素的版本：\n\nCyberpunk cityscape at night, neon signs reflecting on wet streets, Chinese lanterns hanging between buildings, traditional temple rooftop with holographic dragon, cherry blossom petals floating in neon light, calligraphy signs alongside digital billboards, rain-soaked streets, volumetric fog, cinematic lighting, ultra-detailed, 8K\n\n东方元素与赛博朋克的碰撞会产生非常独特的视觉效果！' },
  ]},
  { id: 'c2', title: '产品摄影技巧', time: '2小时前', messages: [
    { id: 'm5', role: 'user', content: '如何用 AI 生成高质量的产品白底图？' },
    { id: 'm6', role: 'assistant', content: '生成高质量产品白底图的关键：\n\n1. 提示词要明确指定纯白背景\n2. 添加柔和阴影描述\n3. 使用高 CFG 值 (8-12) 确保遵循提示\n4. 推荐模板：Product photography, clean white background, soft studio lighting, subtle shadow, professional commercial shot' },
  ]},
  { id: 'c3', title: '视频脚本创作', time: '昨天', messages: [] },
])

const quickPrompts = ['帮我写一段提示词', '如何生成高质量人像？', '推荐适合电商的模板', '视频创作技巧']

const currentMessages = computed(() => conversations.value.find(c => c.id === activeConv.value)?.messages ?? [])

function newChat() {
  const id = `c${Date.now()}`
  conversations.value.unshift({ id, title: '新对话', time: '刚刚', messages: [] })
  activeConv.value = id
}

function deleteConv(id: string) {
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (activeConv.value === id && conversations.value.length > 0) activeConv.value = conversations.value[0]?.id ?? ''
}

function handleSend() {
  const text = inputText.value.trim()
  if (!text) return
  sendMessage(text)
}

async function sendMessage(text: string) {
  const conv = conversations.value.find(c => c.id === activeConv.value)
  if (!conv) return
  conv.messages.push({ id: `m${Date.now()}`, role: 'user', content: text })
  if (conv.title === '新对话') conv.title = text.slice(0, 20)
  inputText.value = ''
  typing.value = true
  await nextTick()
  scrollToBottom()
  await new Promise(r => setTimeout(r, 1200))
  const replies = [
    '这是一个很好的问题！让我为你详细分析一下...',
    '根据你的需求，我建议尝试以下方案：\n\n1. 首先确定你想要的风格方向\n2. 选择合适的模型和参数\n3. 逐步迭代优化结果\n\n需要我展开说明某个步骤吗？',
    '我理解你的想法。在 AIGC 创作中，提示词的精确度直接影响生成质量。建议你：\n- 使用具体的描述而非抽象概念\n- 添加风格参考词\n- 设置合适的负面提示词',
  ]
  conv.messages.push({ id: `m${Date.now()}`, role: 'assistant', content: replies[Math.floor(Math.random() * replies.length)] ?? '' })
  typing.value = false
  await nextTick()
  scrollToBottom()
}

function copyMsg(content: string) {
  navigator.clipboard.writeText(content)
  ElMessage.success('已复制')
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function scrollToBottom() {
  if (flowRef.value) flowRef.value.scrollTop = flowRef.value.scrollHeight
}

watch(activeConv, () => nextTick(scrollToBottom))
</script>

<style scoped lang="scss">
.chat-page { display: flex; flex-direction: column; gap: 16px; height: calc(100vh - 120px); }
.chat-layout { display: grid; grid-template-columns: 280px 1fr; gap: 0; flex: 1; min-height: 0; border: 1px solid var(--app-section-border-color); border-radius: var(--app-radius-lg, 16px); overflow: hidden; background: var(--el-bg-color, #fff); @media (max-width: 768px) { grid-template-columns: 1fr; } }

// 左侧
.chat-sidebar { display: flex; flex-direction: column; border-right: 1px solid var(--app-border-light); background: var(--app-bg-muted, #f5f5f7); }
.sidebar-header { padding: 16px; }
.new-chat-btn { width: 100%; }
.chat-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.chat-item {
  display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: var(--app-radius-md, 12px);
  cursor: pointer; transition: background 0.15s; position: relative;
  &:hover { background: var(--app-section-border-color); }
  &.active { background: var(--el-bg-color, #fff); box-shadow: var(--app-shadow-sm); }
}
.chat-item-icon { width: 32px; height: 32px; border-radius: 8px; background: var(--app-primary-lightest, rgba(255,107,0,0.08)); color: var(--app-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px; }
.chat-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.chat-item-title { font-size: 13px; font-weight: 500; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-item-time { font-size: 11px; color: var(--app-text-tertiary); }
.chat-item-delete { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); opacity: 0; background: none; border: none; cursor: pointer; color: var(--app-text-tertiary); font-size: 14px; padding: 4px; transition: opacity 0.15s;
  .chat-item:hover & { opacity: 1; }
  &:hover { color: var(--el-color-danger); }
}

// 右侧
.chat-main { display: flex; flex-direction: column; min-height: 0; }

.message-flow { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 20px; }

.chat-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--app-text-tertiary);
  .empty-icon { font-size: 48px; color: var(--app-border-light); }
  h3 { font-size: 18px; font-weight: 600; color: var(--app-text-secondary); margin: 0; }
  p { font-size: 14px; margin: 0; }
}
.quick-prompts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.quick-prompt { padding: 8px 16px; border: 1px solid var(--app-section-border-color); border-radius: 20px; font-size: 13px; color: var(--app-text-secondary); background: var(--el-bg-color, #fff); cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--app-primary); color: var(--app-primary); }
}

.message-row { display: flex; gap: 10px; align-items: flex-start; width: 100%;
  &.user { justify-content: flex-end; }
}
.msg-avatar {
  width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 16px;
  &.assistant { background: var(--app-primary-lightest, rgba(255,107,0,0.08)); color: var(--app-primary); }
  &.user { background: var(--app-bg-muted, #f5f5f7); color: var(--app-text-secondary); }
}
.msg-bubble {
  max-width: 90%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; position: relative;
  &.assistant {
    background: var(--app-bg-muted, #f5f5f7); color: var(--app-text);
    &::before {
      content: ''; position: absolute; top: 12px; left: -8px;
      border: 8px solid transparent; border-right-color: var(--app-bg-muted, #f5f5f7); border-left: 0;
    }
  }
  &.user {
    background: var(--app-primary); color: #fff;
    &::before {
      content: ''; position: absolute; top: 12px; right: -8px;
      border: 8px solid transparent; border-left-color: var(--app-primary); border-right: 0;
    }
  }
  p { margin: 0; white-space: pre-wrap; }
}
.msg-actions { display: flex; gap: 4px; margin-top: 8px; opacity: 0; transition: opacity 0.15s;
  .message-row:hover & { opacity: 1; }
  button { background: none; border: none; cursor: pointer; color: var(--app-text-tertiary); font-size: 14px; padding: 4px; &:hover { color: var(--app-text); } }
}

.typing { display: flex; gap: 4px; padding: 16px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--app-text-tertiary); animation: bounce 1.4s infinite both;
  &:nth-child(2) { animation-delay: 0.2s; }
  &:nth-child(3) { animation-delay: 0.4s; }
}
@keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

// 输入区
.input-area { border-top: 1px solid var(--app-border-light); padding: 16px; }
.input-row { display: flex; align-items: flex-end; gap: 8px; }
.chat-input {
  flex: 1; padding: 10px 14px; border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-md, 12px); font-size: 14px; color: var(--app-text);
  background: var(--app-bg-muted, #f5f5f7); outline: none; resize: none; max-height: 120px;
  &:focus { border-color: var(--app-primary); background: var(--el-bg-color, #fff); }
}
.input-action {
  width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--app-text-tertiary); font-size: 18px; transition: all 0.15s; flex-shrink: 0;
  &:hover { color: var(--app-primary); background: var(--app-primary-lightest, rgba(255,107,0,0.08)); }
}
</style>
