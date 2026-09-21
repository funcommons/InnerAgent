<script setup lang="ts">
/**
 * [new] 工具详情抽屉(P2-V17 体检位落点):注册行全字段 + 体检三列回显
 * (healthStatus 徽标 / lastCheckedAt / healthDetailJson 明细 checks 表)+
 * 「立即体检」(POST /admin/tools/{id}/check 同步返回,结果即时刷新落库)。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick } from '@element-plus/icons-vue'
import IaTime from '@/components/IaTime.vue'
import IaToolHealthBadge from '@/components/IaToolHealthBadge.vue'
import { apiErrorMessage } from '@/stores/apps'
import {
  useToolsStore, parseAnnotations, parseHealthDetail, HEALTH_CHECK_LABELS,
  RISK_LEVELS, ADMIN_POLICIES,
} from '@/stores/tools'
import type { IaToolRegistry, ToolCheckResult } from '@/api/types'

const props = defineProps<{ toolId: number | null }>()
const visible = defineModel<boolean>('visible', { required: true })

const store = useToolsStore()
const tool = ref<IaToolRegistry | null>(null)
const loading = ref(false)
const checking = ref(false)
/** 最近一次体检响应(同步结果;落库后回读行亦可查) */
const lastResult = ref<ToolCheckResult | null>(null)

watch(visible, (open) => {
  if (open && props.toolId !== null) void load(props.toolId)
})

async function load(id: number) {
  loading.value = true
  lastResult.value = null
  try {
    tool.value = await store.getTool(id)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '详情加载失败'))
  } finally {
    loading.value = false
  }
}

/** 立即体检(单工具同步):结果即时展示并回读落库行 */
async function runCheck() {
  if (!tool.value) return
  checking.value = true
  try {
    const id = tool.value.id
    const result = await store.checkHealth(id)
    lastResult.value = result
    tool.value = await store.getTool(id)
    const label = result.status === 'ok' ? '健康' : result.status === 'degraded' ? '漂移' : '不可达'
    ElMessage.success(`体检完成:${result.fqn} → ${label}`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '体检失败'))
  } finally {
    checking.value = false
  }
}

const riskLabel = computed(() => RISK_LEVELS.find(r => r.value === tool.value?.riskLevel)?.label ?? tool.value?.riskLevel)
const policyLabel = computed(() =>
  (tool.value?.adminPolicy ? ADMIN_POLICIES.find(p => p.value === tool.value?.adminPolicy)?.label : null) ?? '默认(不强制)')
const annotations = computed(() => parseAnnotations(tool.value?.annotationsJson ?? null))

/** 明细 checks:优先同步体检响应,否则解析落库明细 JSON */
const checks = computed(() => {
  if (lastResult.value) return lastResult.value.checks
  return parseHealthDetail(tool.value?.healthDetailJson ?? null)?.checks ?? []
})
</script>

<template>
  <el-drawer v-model="visible" :title="`工具详情:${tool?.fqn ?? ''}`" size="560px">
    <div v-loading="loading">
      <template v-if="tool">
        <el-descriptions :column="1" border size="small" class="detail-desc">
          <el-descriptions-item label="FQN"><span class="mono">{{ tool.fqn }}</span></el-descriptions-item>
          <el-descriptions-item label="描述">{{ tool.description || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源 / 版本">{{ tool.source }}<span v-if="tool.toolVersion"> · v{{ tool.toolVersion }}</span></el-descriptions-item>
          <el-descriptions-item label="风险 / 管理策略">{{ riskLabel }} · {{ policyLabel }}</el-descriptions-item>
          <el-descriptions-item label="端点 URL">{{ tool.endpointUrl || '—(host_app 经宿主桥)' }}</el-descriptions-item>
          <el-descriptions-item label="schema 指纹"><span class="mono">{{ tool.schemaSha256 ?? '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="MCP 注解">
            <template v-if="annotations">
              readOnly={{ annotations.readOnlyHint }} destructive={{ annotations.destructiveHint }}
              idempotent={{ annotations.idempotentHint }} openWorld={{ annotations.openWorldHint }}
            </template>
            <template v-else>—</template>
          </el-descriptions-item>
          <el-descriptions-item label="启停">{{ tool.enabled ? '启用' : '停用' }}<el-tag v-if="tool.revalidateRequired" size="small" type="danger" class="ml8">待重新确认</el-tag></el-descriptions-item>
        </el-descriptions>

        <!-- 体检位(V17) -->
        <div class="health-head">
          <span class="health-title">工具体检</span>
          <IaToolHealthBadge :status="tool.healthStatus" />
          <span v-if="tool.lastCheckedAt" class="dim">最近体检:<IaTime :value="tool.lastCheckedAt" /></span>
          <el-button
            type="primary" size="small" :icon="MagicStick" :loading="checking" class="check-btn"
            @click="runCheck"
          >立即体检</el-button>
        </div>
        <p class="health-hint">
          体检为只读检查矩阵(端点可达 → 宿主清单 → schema 指纹 → 注解 diff),结论落库不改
          schema/注解生效内容;批量体检在列表页右上角发起(异步受理)。
        </p>
        <el-table v-if="checks.length" :data="checks" size="small" class="checks-table">
          <el-table-column label="检查项" width="110">
            <template #default="{ row }">{{ HEALTH_CHECK_LABELS[row.check] ?? row.check }}</template>
          </el-table-column>
          <el-table-column label="结论" width="70">
            <template #default="{ row }">
              <el-tag :type="row.status === 'pass' ? 'success' : 'warning'" size="small">
                {{ row.status === 'pass' ? '通过' : '漂移' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="明细" min-width="150">
            <template #default="{ row }">{{ row.detail || '—' }}</template>
          </el-table-column>
          <el-table-column label="整改建议" min-width="150">
            <template #default="{ row }">{{ row.advice || '—' }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无体检明细:点击「立即体检」生成结论" :image-size="72" />
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.ml8 { margin-left: 8px; }
.detail-desc { margin-bottom: 16px; }
.health-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.health-title { font-weight: 600; font-size: 13px; }
.check-btn { margin-left: auto; }
.health-hint { color: #909399; font-size: 12px; margin: 8px 0 12px; }
.checks-table { margin-bottom: 12px; }
</style>
