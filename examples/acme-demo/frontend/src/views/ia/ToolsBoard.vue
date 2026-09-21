<script setup lang="ts">
/**
 * 工具调用演示(接入指南步骤②/③):宿主业务能力经 @IaTool 暴露给 InnerAgent。
 *
 * 两条建单通道共用宿主内存存储,轮询 /api/tickets 即可实时混排:
 * - direct:本页表单直建(宿主 REST);
 * - agent:在「嵌入演示」页对助手说「帮我建一张工单:…」→ 命中 create_ticket
 *   (WRITE)→ 确认卡批准 → InnerAgent 经 /ia-mcp 桥调用(附 60s X-IA-Act)→
 *   createdBy 来自 act token,channel=agent。
 * 底部为 InnerAgent webhook 事件流(运行终态回调,X-IA-Delivery 幂等)。
 */
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSection, FcSectionHeader, FcSelect, FcTag, toast } from '@/components/sdk'
import type { SelectOption } from '@/components/sdk'
import { demoApi, type Ticket, type WebhookEvent } from '@/api/demo'

defineOptions({ name: 'IaToolsBoard' })

const { t } = useI18n()

const form = reactive({
  title: '',
  description: '',
  priority: 'normal',
})
const submitting = ref(false)

const PRIORITY_OPTIONS: SelectOption[] = ['low', 'normal', 'high'].map((v) => ({ label: v, value: v }))

const tickets = ref<Ticket[]>([])
const events = ref<WebhookEvent[]>([])
let timer: ReturnType<typeof setInterval> | null = null

async function submit() {
  if (!form.title.trim()) return
  submitting.value = true
  try {
    const resp = await demoApi.createTicket({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
    })
    toast.success(t('ia.tools.submit-ok', { id: resp.ticketId }))
    form.title = ''
    form.description = ''
    await refresh()
  } catch {
    // 错误弹窗由 request.ts 拦截器统一处理
  } finally {
    submitting.value = false
  }
}

async function refresh() {
  try {
    tickets.value = await demoApi.listTickets()
  } catch {
    /* 后端未启动时静默 */
  }
  try {
    events.value = await demoApi.webhookEvents()
  } catch {
    /* webhook 未接线时保持静默 */
  }
}

function startPolling() {
  if (timer) return
  timer = setInterval(refresh, 5_000)
}

onMounted(() => {
  refresh().catch(() => { /* 后端未启动时静默 */ })
  startPolling()
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

function priorityTagType(priority: string): 'info' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'low') return 'info'
  return 'warning'
}
</script>

<template>
  <div class="ia-tools">
    <FcSection>
      <FcSectionHeader :title="t('ia.tools.title')" :subtitle="t('ia.tools.subtitle')" />

      <div class="howto" data-testid="tools-howto">
        <i class="ri-lightbulb-line" aria-hidden="true" />
        <span>{{ t('ia.tools.howto') }}</span>
      </div>

      <div class="submit-row">
        <div class="submit-main">
          <el-input
            v-model="form.title"
            class="fc-input"
            maxlength="200"
            :placeholder="t('ia.tools.title-placeholder')"
          />
          <el-input
            v-model="form.description"
            class="fc-input"
            type="textarea"
            :rows="2"
            maxlength="2000"
            :placeholder="t('ia.tools.desc-placeholder')"
          />
        </div>
        <div class="submit-side">
          <div class="field">
            <span class="label">{{ t('ia.tools.priority') }}</span>
            <FcSelect v-model="form.priority" :options="PRIORITY_OPTIONS" style="width: 110px" />
          </div>
          <FcButton type="primary" :loading="submitting" class="fc-button" data-testid="ticket-submit" @click="submit">
            {{ t('ia.tools.submit') }}
          </FcButton>
        </div>
      </div>

      <div class="ticket-list" data-testid="ticket-list">
        <p v-if="tickets.length === 0" class="empty">{{ t('ia.tools.list-empty') }}</p>
        <div v-for="row in tickets" :key="row.ticketId" class="ticket-row">
          <div class="ticket-head">
            <code class="ticket-id">{{ row.ticketId }}</code>
            <FcTag :type="priorityTagType(row.priority)">{{ row.priority }}</FcTag>
            <FcTag :type="row.channel === 'agent' ? 'success' : 'info'">
              {{ t(row.channel === 'agent' ? 'ia.tools.channel-agent' : 'ia.tools.channel-direct') }}
            </FcTag>
            <span class="ticket-meta">{{ t('ia.tools.created-by') }} {{ row.createdBy }}</span>
          </div>
          <p class="ticket-title">{{ row.title }}</p>
          <p v-if="row.description" class="ticket-desc">{{ row.description }}</p>
        </div>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader :title="t('ia.tools.webhook-title')" :subtitle="t('ia.tools.webhook-subtitle')" />
      <p v-if="events.length === 0" class="empty" data-testid="webhook-empty">
        {{ t('ia.tools.webhook-empty') }}
      </p>
      <ul v-else class="event-list" data-testid="webhook-list">
        <li v-for="(e, i) in events" :key="i" class="event-item">
          <span class="event-time">{{ new Date(e.receivedAt).toLocaleString() }}</span>
          <FcTag :type="e.known ? 'success' : 'info'">{{ e.event }}</FcTag>
          <code class="event-run">{{ e.runId }}</code>
          <span v-if="e.status" class="event-status">{{ e.status }}</span>
        </li>
      </ul>
    </FcSection>
  </div>
</template>

<style scoped lang="scss">
.ia-tools {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.howto {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
  padding: 8px 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-color-primary);
}

.submit-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.submit-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.submit-side {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  margin: 0;
  padding: 14px 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

.ticket-row {
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.ticket-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ticket-id {
  font-size: 12px;
}

.ticket-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ticket-title {
  margin: 8px 0 0;
  font-size: 13px;
  font-weight: 600;
}

.ticket-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.event-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.event-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--el-border-color-lighter);

  .event-time {
    color: var(--el-text-color-placeholder);
    font-family: monospace;
  }

  .event-run {
    word-break: break-all;
  }

  .event-status {
    color: var(--el-text-color-secondary);
  }
}
</style>
