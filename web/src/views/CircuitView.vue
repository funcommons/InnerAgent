<script setup lang="ts">
/**
 * [new] 熔断与紧急停用视图(视图清单 #6;契约形状=《02-技术方案》§4.7)。
 * 应用级总开关(≤5s 生效,经 Redis 取消通道)+ 单运行终止 + 资源上限表单 + 事件流。
 * 管理端点待服务端落地(跟踪:99-优化建议.md #2):加载失败显「服务端能力未开通」
 * 占位,不渲染可交互但必败的表单(优化建议 #2/#9)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, VideoPause, VideoPlay, WarningFilled } from '@element-plus/icons-vue'
import { useCircuitStore, LIMIT_FIELDS, DEFAULT_LIMITS } from '@/stores/circuit'
import { apiErrorMessage } from '@/stores/apps'

const store = useCircuitStore()

const stopForm = reactive({ reason: '' })
const runForm = reactive({ runId: '', reason: '' })
const stopping = ref(false)
const savingLimits = ref(false)
const terminating = ref(false)

const EVENT_LABELS: Record<string, string> = {
  'limit-triggered': '上限触发',
  'emergency-stop': '紧急停用',
  'resume': '恢复运行',
  'run-terminated': '终止运行',
}

onMounted(() => {
  void store.load()
})

async function emergencyStop() {
  if (!stopForm.reason.trim()) {
    ElMessage.warning('请填写停用原因(将进入审计与事件流)')
    return
  }
  const confirmed = await ElMessageBox.confirm(
    '紧急停用后:该应用全部新运行拒绝接入、进行中运行收到取消信号(生效延迟 ≤5s)。确认执行?',
    '紧急停用',
    { type: 'error', confirmButtonText: '确认停用', cancelButtonText: '取消' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  stopping.value = true
  try {
    await store.emergencyStop(stopForm.reason.trim())
    ElMessage.success('已紧急停用(≤5s 生效)')
    stopForm.reason = ''
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '停用失败'))
  } finally {
    stopping.value = false
  }
}

async function resume() {
  await store.resume()
  ElMessage.success('已恢复运行接入')
}

async function saveLimits() {
  savingLimits.value = true
  try {
    await store.saveLimits()
    ElMessage.success('资源上限已更新(配置指纹使内核缓存失效)')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    savingLimits.value = false
  }
}

function resetLimits() {
  Object.assign(store.limitsForm, DEFAULT_LIMITS)
}

async function terminateRun() {
  if (!runForm.runId.trim() || !runForm.reason.trim()) {
    ElMessage.warning('runId 与原因必填')
    return
  }
  terminating.value = true
  try {
    await store.terminateRun(runForm.runId.trim(), runForm.reason.trim())
    ElMessage.success(`已发送终止信号:${runForm.runId}`)
    runForm.runId = ''
    runForm.reason = ''
    await store.load()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '终止失败'))
  } finally {
    terminating.value = false
  }
}
</script>

<template>
  <div class="view" v-loading="store.loading">
    <!-- 服务端能力未开通占位(优化建议 #2/#9):不给可交互但必败的表单 -->
    <el-card v-if="store.unavailable" shadow="never" class="unavailable-card">
      <el-empty description="服务端能力未开通">
        <div class="unavailable-hint">
          熔断与资源上限的管理端点尚未在当前服务端启用(能力跟踪:
          test-report/2026-09-21-02/99-优化建议.md #2)。
        </div>
        <el-button :icon="Refresh" @click="store.load()">重新检测</el-button>
      </el-empty>
    </el-card>

    <template v-else>
    <el-row :gutter="12">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>应用级 Agent 总开关</span>
              <el-tag :type="store.state?.emergencyStopped ? 'danger' : 'success'" size="small">
                {{ store.state?.emergencyStopped ? '已紧急停用' : '运行中' }}
              </el-tag>
            </div>
          </template>
          <template v-if="store.state?.emergencyStopped">
            <el-result icon="error" title="已紧急停用" :sub-title="`原因:${store.state.stopReason ?? '—'} · ${store.state.stoppedAt ?? ''}`">
              <template #extra>
                <el-button type="primary" :icon="VideoPlay" @click="resume">恢复运行接入</el-button>
              </template>
            </el-result>
          </template>
          <template v-else>
            <el-form label-width="80px">
              <el-form-item label="停用原因" required>
                <el-input v-model="stopForm.reason" placeholder="如:失控循环 / 成本异常" maxlength="120" />
              </el-form-item>
              <el-button type="danger" :icon="VideoPause" :loading="stopping" @click="emergencyStop">
                <el-icon v-if="!stopping"><WarningFilled /></el-icon>
                紧急停用
              </el-button>
            </el-form>
          </template>
        </el-card>

        <el-card shadow="never" class="mt12">
          <template #header><span>单运行终止</span></template>
          <el-form label-width="80px">
            <el-form-item label="Run ID" required>
              <el-input v-model="runForm.runId" placeholder="run-2042" class="mono" />
            </el-form-item>
            <el-form-item label="原因" required>
              <el-input v-model="runForm.reason" maxlength="120" />
            </el-form-item>
            <el-button type="warning" :loading="terminating" @click="terminateRun">终止该运行</el-button>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>资源上限(§4.7 默认值)</span>
              <el-button text size="small" @click="resetLimits">恢复默认</el-button>
            </div>
          </template>
          <el-form label-width="170px">
            <el-form-item v-for="f in LIMIT_FIELDS" :key="f.key" :label="f.label">
              <el-input-number v-model="store.limitsForm[f.key]" :min="f.min" :max="f.max" controls-position="right" />
              <div class="form-hint">{{ f.hint }}</div>
            </el-form-item>
            <el-button type="primary" :loading="savingLimits" @click="saveLimits">保存上限</el-button>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header><span>熔断事件流(最近 20 条)</span></template>
      <el-empty v-if="!store.state?.recentEvents.length" description="暂无事件" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="e in store.state.recentEvents"
          :key="e.id"
          :type="e.type === 'emergency-stop' ? 'danger' : e.type === 'limit-triggered' || e.type === 'run-terminated' ? 'warning' : 'success'"
          :timestamp="`${e.occurredAt} · ${e.operator}`"
        >
          <b>{{ EVENT_LABELS[e.type] ?? e.type }}</b>
          <span v-if="e.runId" class="mono ml8">{{ e.runId }}</span>
          <div class="dim">{{ e.reason }}</div>
        </el-timeline-item>
      </el-timeline>
    </el-card>
    </template>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 12px; }
.unavailable-card :deep(.el-empty) { padding: 40px 0; }
.unavailable-hint { color: #909399; font-size: 12px; margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.form-hint { color: #909399; font-size: 12px; width: 100%; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.mt12 { margin-top: 12px; }
.mb12 { margin-bottom: 12px; }
.ml8 { margin-left: 8px; }
</style>
