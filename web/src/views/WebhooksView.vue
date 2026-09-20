<script setup lang="ts">
/**
 * [new] Webhook 视图(视图清单 #6)。
 * 投递记录已接真实端点(任务 #18b:/admin/webhook-deliveries,支持手动重投);
 * 终态通知配置域(/webhooks/config)端点待服务端落地(跟踪:99-优化建议.md #2),
 * 加载失败显「服务端能力未开通」占位(衔接 #9),不渲染必败表单。
 */
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, RefreshRight } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import { useWebhooksStore, WEBHOOK_EVENTS, DELIVERY_STATUS } from '@/stores/webhooks'
import { apiErrorMessage } from '@/stores/apps'
import type { WebhookDelivery } from '@/api/types'

const store = useWebhooksStore()

const saving = ref(false)
const testing = ref(false)
const redeliveringId = ref<number | null>(null)

const eventLabel = (v: string) => WEBHOOK_EVENTS.find(e => e.value === v)?.label ?? v
const statusMeta = (v: string) => DELIVERY_STATUS[v]

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

/** 手动重投(#18b:重置回 PENDING,清空尝试历史;PENDING 重复重投服务端 409) */
async function redeliver(row: WebhookDelivery) {
  const confirmed = await ElMessageBox.confirm(
    `将 ${row.runId} 的投递记录重置回待投递队列(清空尝试历史,立即重新投递)。继续?`,
    '手动重投',
    { type: 'warning', confirmButtonText: '重投', cancelButtonText: '取消' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  redeliveringId.value = row.id
  try {
    await store.redeliver(row.id)
    ElMessage.success('已重置回待投递队列')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '重投失败'))
  } finally {
    redeliveringId.value = null
  }
}
</script>

<template>
  <div class="view">
    <el-row :gutter="12">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>终态通知配置</span></template>
          <!-- 配置端点待服务端落地 → 占位(优化建议 #2/#9) -->
          <IaEmpty
            v-if="store.configUnavailable"
            description="服务端能力未开通"
            hint="Webhook 配置管理端点尚未在当前服务端启用(能力跟踪:99-优化建议.md #2);现阶段配置可经应用管理域维护"
          >
            <template #action>
              <el-button :icon="Refresh" @click="store.loadConfig()">重新检测</el-button>
            </template>
          </IaEmpty>
          <el-form v-else label-width="110px">
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
              <el-button :icon="RefreshRight" :loading="testing" @click="sendTest">发送测试回调</el-button>
            </div>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt12">
          <p class="dim">
            重试策略:最多 5 次,指数退避;签名头 X-IA-Signature(HMAC-SHA256),宿主以同一密钥验签;
            重试耗尽(EXHAUSTED)的投递可经下方「重投」手动复活。
          </p>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>投递记录(任务 #18b 真实端点)</span></template>
          <div class="toolbar">
            <el-select v-model="store.filters.event" class="toolbar__event" placeholder="事件" clearable @change="search">
              <el-option v-for="e in WEBHOOK_EVENTS" :key="e.value" :label="e.label" :value="e.value" />
            </el-select>
            <el-select v-model="store.filters.success" class="toolbar__status" placeholder="投递结果" clearable @change="search">
              <el-option label="成功" :value="true" />
              <el-option label="失败" :value="false" />
            </el-select>
            <el-button :icon="Refresh" @click="store.loadDeliveries()">刷新</el-button>
          </div>
          <el-table v-loading="store.loading" :data="store.deliveries" row-key="id" class="mt12">
            <!-- 空态(#9) -->
            <template #empty>
              <IaEmpty description="还没有投递记录" hint="运行到达终态后这里会出现通知投递明细" />
            </template>
            <el-table-column label="时间" min-width="150">
              <template #default="{ row }">
                <span v-if="row.deliveredAt" class="mono">{{ row.deliveredAt }}</span>
                <span v-else class="dim">待投递</span>
              </template>
            </el-table-column>
            <el-table-column label="事件" min-width="150">
              <template #default="{ row }">{{ eventLabel(row.event) }}</template>
            </el-table-column>
            <el-table-column label="Run" min-width="100">
              <template #default="{ row }"><span class="mono">{{ row.runId }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusMeta(row.status)?.tag ?? (row.success ? 'success' : 'danger')" size="small">
                  {{ statusMeta(row.status)?.label ?? (row.success ? '成功' : '失败') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="尝试" width="60" align="center">
              <template #default="{ row }">{{ row.attempt }}/{{ row.maxAttempts }}</template>
            </el-table-column>
            <el-table-column label="HTTP" width="70" align="center">
              <template #default="{ row }">{{ row.httpStatus ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="下次重试" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.nextRetryAt" class="retry">{{ row.nextRetryAt }}</span>
                <span v-else class="dim">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button
                  text type="primary" size="small" :icon="RefreshRight"
                  :disabled="row.status === 'PENDING'"
                  :loading="redeliveringId === row.id"
                  @click="redeliver(row)"
                >
                  重投
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-model:current-page="store.filters.pageNo"
            v-model:page-size="store.filters.pageSize"
            class="pager" layout="total, sizes, prev, pager, next"
            :total="store.deliveriesTotal" :page-sizes="[10, 20, 50]"
            @current-change="store.loadDeliveries()" @size-change="store.loadDeliveries()"
          />
        </el-card>
      </el-col>
    </el-row>
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
.pager { margin-top: 12px; justify-content: flex-end; }
.retry { color: #e6a23c; font-size: 12px; }
</style>
