<script setup lang="ts">
/**
 * [new] Webhook 视图(视图清单 #6,占位契约)。
 * 终态通知配置(HMAC 签名,5 次指数退避,方案 §7.1)+ 投递记录(可观测面,自拟)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Promotion } from '@element-plus/icons-vue'
import { useWebhooksStore, WEBHOOK_EVENTS } from '@/stores/webhooks'
import { apiErrorMessage } from '@/stores/apps'
import type { WebhookEvent } from '@/api/types'

const store = useWebhooksStore()

const saving = ref(false)
const testing = ref(false)
const simForm = reactive({ event: 'run.failed' as WebhookEvent, runId: '' })
const simulating = ref(false)

const eventLabel = (v: string) => WEBHOOK_EVENTS.find(e => e.value === v)?.label ?? v

onMounted(() => {
  void store.loadConfig()
  void store.loadDeliveries()
})

function search() {
  store.filters.pageNo = 1
  void store.loadDeliveries()
}

async function saveConfig() {
  if (!store.configForm.url.trim().startsWith('https://')) {
    ElMessage.warning('回调地址须为 HTTPS(全链路 HTTPS,S5)')
    return
  }
  if (store.configForm.events.length === 0) {
    ElMessage.warning('至少订阅一个事件')
    return
  }
  saving.value = true
  try {
    await store.saveConfig()
    ElMessage.success('Webhook 配置已保存(密钥加密落库,仅回显掩码)')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  testing.value = true
  try {
    const resp = await store.testConfig()
    ElMessage.success(resp.signatureValid ? '测试回调已发送,签名验证通过' : '签名验证失败')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '测试失败'))
  } finally {
    testing.value = false
  }
}

async function simulateFailure() {
  simulating.value = true
  try {
    await store.simulateFailure(simForm.event, simForm.runId.trim() || `run-${Date.now()}`)
    ElMessage.success('已模拟一次失败投递(503),进入指数退避重试')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '模拟失败'))
  } finally {
    simulating.value = false
  }
}
</script>

<template>
  <div class="view">
    <el-alert
      type="warning" :closable="false" show-icon class="mb12"
      title="占位视图:HMAC 签名与 5 次指数退避重试语义见《02-技术方案》§7.1;配置/投递记录字段为自拟契约,双密钥并存(Q5)未建模,待 P2 对齐。"
    />

    <el-row :gutter="12">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>终态通知配置</span></template>
          <el-form label-width="110px">
            <el-form-item label="回调地址">
              <el-input v-model="store.configForm.url" placeholder="https://host.example.com/ia/callback" />
            </el-form-item>
            <el-form-item label="签名密钥">
              <el-input
                v-model="store.configForm.secret"
                type="password"
                show-password
                :placeholder="store.config?.secretMasked ? `已设置(${store.config.secretMasked}),留空表示不修改` : 'whsec-...'"
                autocomplete="new-password"
              />
            </el-form-item>
            <el-form-item label="订阅事件">
              <el-checkbox-group v-model="store.configForm.events">
                <el-checkbox v-for="e in WEBHOOK_EVENTS" :key="e.value" :value="e.value">{{ e.label }}</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="store.configForm.enabled" />
            </el-form-item>
            <div class="actions">
              <el-button type="primary" :loading="saving" @click="saveConfig">保存</el-button>
              <el-button :icon="Promotion" :loading="testing" @click="sendTest">发送测试回调</el-button>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>投递演练(P2 联调用)</span></template>
          <el-form label-width="110px">
            <el-form-item label="事件">
              <el-select v-model="simForm.event">
                <el-option v-for="e in WEBHOOK_EVENTS" :key="e.value" :label="e.label" :value="e.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="Run ID">
              <el-input v-model="simForm.runId" placeholder="留空自动生成" class="mono" />
            </el-form-item>
            <el-button type="warning" :loading="simulating" @click="simulateFailure">模拟宿主 5xx(触发退避)</el-button>
          </el-form>
          <p class="dim mt12">
            重试策略:最多 5 次,指数退避;签名头 X-IA-Signature(HMAC-SHA256),宿主以同一密钥验签。
          </p>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <span>投递记录</span>
          <el-select v-model="store.filters.event" class="toolbar__event" placeholder="事件" clearable @change="search">
            <el-option v-for="e in WEBHOOK_EVENTS" :key="e.value" :label="e.label" :value="e.value" />
          </el-select>
          <el-select v-model="store.filters.success" class="toolbar__status" placeholder="投递结果" clearable @change="search">
            <el-option label="成功" :value="true" />
            <el-option label="失败" :value="false" />
          </el-select>
          <el-button :icon="Refresh" @click="store.loadDeliveries()">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="store.loading" :data="store.deliveries" row-key="id">
        <el-table-column prop="deliveredAt" label="时间" min-width="160" show-overflow-tooltip />
        <el-table-column label="事件" min-width="180">
          <template #default="{ row }">{{ eventLabel(row.event) }}</template>
        </el-table-column>
        <el-table-column label="Run" min-width="110">
          <template #default="{ row }"><span class="mono">{{ row.runId }}</span></template>
        </el-table-column>
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '成功' : '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="尝试" width="70" align="center">
          <template #default="{ row }">{{ row.attempt }}/{{ row.maxAttempts }}</template>
        </el-table-column>
        <el-table-column label="HTTP" width="80" align="center">
          <template #default="{ row }">{{ row.httpStatus ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="下次重试" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.nextRetryAt" class="retry">{{ row.nextRetryAt }}</span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="responseSummary" label="响应摘要" min-width="150" show-overflow-tooltip />
      </el-table>
      <el-pagination
        v-model:current-page="store.filters.pageNo"
        v-model:page-size="store.filters.pageSize"
        class="pager" layout="total, sizes, prev, pager, next"
        :total="store.deliveriesTotal" :page-sizes="[10, 20, 50]"
        @current-change="store.loadDeliveries()" @size-change="store.loadDeliveries()"
      />
    </el-card>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar__event { width: 220px; }
.toolbar__status { width: 110px; }
.actions { display: flex; gap: 8px; padding-left: 110px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.mt12 { margin-top: 12px; }
.mb12 { margin-bottom: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; }
.retry { color: #e6a23c; font-size: 12px; }
</style>
