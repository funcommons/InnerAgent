<script setup lang="ts">
/**
 * [new] 工具注册与授权视图(视图清单 #3)。
 * Tab1 ia_tool_registry:FQN / schema 指纹(schemaSha256)/ 风险等级 / MCP 注解 /
 *      管理员策略 / revalidateRequired 分诊态;注册(单条)/ 活刷新分诊
 *      (unchanged/compatible/breaking + confirm/reject)/ 停用启用 / 治理元数据。
 * Tab2 ia_tool_grant:授权列表(invalidated 原因)/ 授予(toolName+scope+会话)/ 撤销。
 * P2 对齐:注册为单条工具(非端点清单拉取);启用为 enabled 布尔;
 * 授予按 toolName(服务端解析 FQN)、conversation 作用域必填会话 ID。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, CircleCheck, CircleClose, Setting, Clock } from '@element-plus/icons-vue'
import {
  useToolsStore, RISK_LEVELS, ADMIN_POLICIES, GRANT_INVALID_REASONS, parseAnnotations,
} from '@/stores/tools'
import { useNarrowViewport } from '@/composables/useNarrowViewport'
import { apiErrorMessage } from '@/stores/apps'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import IaTime from '@/components/IaTime.vue'
import type { GrantScope, IaToolGrant, IaToolRegistry, IaToolSchemaHistory, ToolRiskLevel } from '@/api/types'

const store = useToolsStore()
const tab = ref<'registry' | 'grants'>('registry')
// #26 短期方案:窄屏收次要列,降低固定列克隆 DOM 使用面
const narrow = useNarrowViewport()

const riskMeta = (level: string) => RISK_LEVELS.find(r => r.value === level)
const policyLabel = (value: string | null) =>
  (value ? ADMIN_POLICIES.find(p => p.value === value)?.label : null) ?? '默认(不强制)'

onMounted(() => {
  void store.loadTools()
  void store.loadGrants()
})

// ===== 注册(单条工具,镜像 RegisterToolReqVO) =====
const registerVisible = ref(false)
const registering = ref(false)
const registerForm = reactive({
  serverKey: '',
  toolName: '',
  source: 'host_app' as 'host_app' | 'third_party',
  endpointUrl: '',
  description: '',
  parametersSchema: '',
})

function openRegister() {
  Object.assign(registerForm, { serverKey: '', toolName: '', source: 'host_app', endpointUrl: '', description: '', parametersSchema: '' })
  registerVisible.value = true
}

async function submitRegister() {
  if (!registerForm.serverKey.trim() || !registerForm.toolName.trim()) {
    ElMessage.warning('serverKey 与工具名必填;serverKey 仅字母/数字/连字符(避用下划线)')
    return
  }
  if (registerForm.parametersSchema.trim() && !isValidJson(registerForm.parametersSchema)) {
    ElMessage.warning('入参 Schema 须为合法 JSON(留空表示无入参)')
    return
  }
  registering.value = true
  try {
    const entry = await store.register({
      serverKey: registerForm.serverKey.trim(),
      toolName: registerForm.toolName.trim(),
      source: registerForm.source,
      endpointUrl: registerForm.endpointUrl.trim() || undefined,
      description: registerForm.description.trim() || undefined,
      parametersSchema: registerForm.parametersSchema.trim() || undefined,
    })
    ElMessage.success(`已注册 ${entry.fqn}(风险级 ${riskMeta(entry.riskLevel)?.label ?? entry.riskLevel},指纹已生成)`)
    registerVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '注册失败'))
  } finally {
    registering.value = false
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

// ===== 活刷新分诊(POST /tools/{id}/schema) =====
async function refreshTool(t: IaToolRegistry) {
  try {
    // 管理站触发:不重发 schema → 服务端按现库分诊(联调时由宿主重发)
    const resp = await store.refreshSchema(t.id)
    if (resp.verdict === 'unchanged') {
      ElMessage.info(`${resp.fqn}:无变更(静默刷新)`)
    } else if (resp.verdict === 'compatible') {
      ElMessage.success(`${resp.fqn}:${resp.reasons.join(';')}`)
    } else {
      ElMessageBox.alert(
        `${resp.reasons.join(';')}。存量授权已自动失效,可在下方「确认变更」应用新 schema 或「拒绝变更」保持旧 schema。`,
        `安全相关差异:${resp.fqn}`,
        { type: 'warning', confirmButtonText: '知道了' },
      ).catch(() => undefined)
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '刷新失败'))
  }
}

async function confirmSchema(t: IaToolRegistry) {
  const confirmed = await ElMessageBox.confirm(
    `确认应用 ${t.fqn} 的 BREAKING 暂存 schema?(存量授权已在分诊时失效,不复活)`,
    '重新确认变更',
    { type: 'warning', confirmButtonText: '确认应用', cancelButtonText: '取消' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  await store.confirmSchema(t.id)
  ElMessage.success('已应用暂存 schema')
}

async function rejectSchema(t: IaToolRegistry) {
  await store.rejectSchema(t.id)
  ElMessage.success('已拒绝暂存变更,保持旧 schema')
}

// ===== 停用 / 启用 =====
async function toggleEnabled(t: IaToolRegistry) {
  if (t.enabled) {
    const confirmed = await ElMessageBox.confirm(
      `停用后:${t.fqn} 从所有 Agent 白名单摘除;进行中的运行按内核快照继续;该工具全部用户授权将被级联失效。继续?`,
      '停用工具',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false)
    if (!confirmed) return
    await store.setEnabled(t.id, false)
    ElMessage.success('已停用;级联授权失效见「用户授权」页签')
  } else {
    await store.setEnabled(t.id, true)
    ElMessage.success('已启用')
  }
}

// ===== 治理元数据(PUT /tools/{id}) =====
const policyVisible = ref(false)
const policyTool = ref<IaToolRegistry | null>(null)
const policyForm = reactive({
  riskLevel: 'medium' as ToolRiskLevel,
  adminPolicy: null as IaToolRegistry['adminPolicy'],
  resumeSafe: false,
})
const policySaving = ref(false)

function openPolicy(t: IaToolRegistry) {
  policyTool.value = t
  Object.assign(policyForm, { riskLevel: t.riskLevel, adminPolicy: t.adminPolicy, resumeSafe: t.resumeSafe })
  policyVisible.value = true
}

async function savePolicy() {
  if (!policyTool.value) return
  policySaving.value = true
  try {
    await store.updateTool(policyTool.value.id, { ...policyForm })
    ElMessage.success('治理元数据已更新(风险升级会自动失效存量授权)')
    policyVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '更新失败'))
  } finally {
    policySaving.value = false
  }
}

// ===== 授权 =====
const grantVisible = ref(false)
const grantSaving = ref(false)
const grantForm = reactive({
  userId: '' as string | number,
  toolName: '',
  scope: 'permanent' as GrantScope,
  conversationId: '',
  decisionNote: '',
})

const grantableTools = computed(() => store.tools.filter(t => t.enabled))

function openGrant() {
  Object.assign(grantForm, { userId: '', toolName: '', scope: 'permanent', conversationId: '', decisionNote: '' })
  grantVisible.value = true
}

async function submitGrant() {
  const userId = Number(grantForm.userId)
  if (!grantForm.userId || Number.isNaN(userId)) {
    ElMessage.warning('请填写数字用户 ID 并选择工具')
    return
  }
  if (!grantForm.toolName) {
    ElMessage.warning('请选择工具')
    return
  }
  if (grantForm.scope === 'conversation' && !grantForm.conversationId.trim()) {
    ElMessage.warning('conversation 作用域必须携带会话 ID')
    return
  }
  grantSaving.value = true
  try {
    await store.grant({
      userId,
      toolName: grantForm.toolName,
      scope: grantForm.scope,
      conversationId: grantForm.scope === 'conversation' ? grantForm.conversationId.trim() : undefined,
      decisionNote: grantForm.decisionNote.trim() || undefined,
    })
    ElMessage.success('授权已授予(记录授予时风险级与 schema 指纹)')
    grantVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '授予失败'))
  } finally {
    grantSaving.value = false
  }
}

async function revokeGrant(g: IaToolGrant) {
  const confirmed = await ElMessageBox.confirm(`撤销 ${g.userId} 对 ${g.toolFqn} 的授权?`, '撤销授权', { type: 'warning' })
    .then(() => true).catch(() => false)
  if (!confirmed) return
  await store.revoke(g.id)
  ElMessage.success('已撤销')
}

function invalidatedTag(g: IaToolGrant): string {
  return g.invalidated
    ? (GRANT_INVALID_REASONS[g.invalidatedReason ?? 'tool_deleted'] ?? '已失效')
    : '有效'
}

// ===== schema 历史(优化建议 #11:仅 API 可达 → 行内「历史」抽屉时间线) =====
const historyVisible = ref(false)
const historyTool = ref<IaToolRegistry | null>(null)
const historyLoading = ref(false)
const historyEntries = ref<IaToolSchemaHistory[]>([])

/** outcome → 展示文案(ia_tool_schema_history.outcome 真实码值) */
const OUTCOME_META: Record<string, { label: string; type: 'primary' | 'warning' | 'danger' | 'info' }> = {
  applied: { label: '已应用', type: 'primary' },
  pending_review: { label: '待确认', type: 'warning' },
  rejected: { label: '已拒绝', type: 'danger' },
  silent_refresh: { label: '静默刷新', type: 'info' },
}
const TRIAGE_LABELS: Record<string, string> = {
  unchanged: '无变更',
  compatible: '兼容',
  breaking: 'BREAKING',
}

async function openHistory(t: IaToolRegistry) {
  historyTool.value = t
  historyVisible.value = true
  historyLoading.value = true
  try {
    historyEntries.value = await store.schemaHistory(t.id)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '历史加载失败'))
  } finally {
    historyLoading.value = false
  }
}

function historyReasons(detail: string | null): string[] {
  if (!detail) return []
  try {
    const parsed = JSON.parse(detail)
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
  } catch {
    return [detail]
  }
}

/** 指纹短形(时间线 diff 展示;完整值见详情) */
function shortSha(sha: string): string {
  return sha.length > 18 ? `${sha.slice(0, 14)}…` : sha
}
</script>

<template>
  <IaPageContainer subtitle="MCP 工具注册表、活刷新分诊与用户授权">
    <template #action>
      <!-- 页级操作右置(#19):随页签切换「注册工具/代授」 -->
      <el-button v-if="tab === 'registry'" type="primary" :icon="Plus" @click="openRegister">注册工具</el-button>
      <el-button v-else type="primary" :icon="Plus" @click="openGrant">代授</el-button>
    </template>
    <el-tabs v-model="tab">
      <el-tab-pane label="工具注册表" name="registry">
        <el-card shadow="never" class="toolbar-card">
          <div class="toolbar">
            <el-input v-model="store.toolFilters.keyword" class="toolbar__search" placeholder="工具名 / FQN / 描述" clearable @keyup.enter="store.loadTools()" />
            <el-select v-model="store.toolFilters.riskLevel" class="toolbar__select" placeholder="风险等级" clearable @change="store.loadTools()">
              <el-option v-for="r in RISK_LEVELS" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
            <el-select v-model="store.toolFilters.enabled" class="toolbar__select-sm" placeholder="状态" clearable @change="store.loadTools()">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
            <el-button :icon="Refresh" @click="store.loadTools()">查询</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table v-loading="store.toolsLoading" :data="store.tools" row-key="id">
            <!-- 空态(#9):0 行给明确下一步,不再像「页面坏了」 -->
            <template #empty>
              <IaEmpty description="还没有注册任何工具" hint="注册后生成 FQN 与 schema 指纹,供 Agent 分诊调用">
                <template #action>
                  <el-button type="primary" :icon="Plus" @click="openRegister">注册第一个工具</el-button>
                </template>
              </IaEmpty>
            </template>
            <el-table-column prop="fqn" label="FQN" min-width="230" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono">{{ row.fqn }}</span>
                <el-tag v-if="row.adminPolicy" size="small" type="warning" class="ml4">{{ policyLabel(row.adminPolicy) }}</el-tag>
                <el-tag v-if="row.revalidateRequired" size="small" type="danger" class="ml4">待重新确认</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="!narrow" prop="description" label="描述" min-width="160" show-overflow-tooltip />
            <el-table-column label="风险" width="80">
              <template #default="{ row }">
                <el-tag :type="riskMeta(row.riskLevel)?.tag" size="small">{{ riskMeta(row.riskLevel)?.label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="!narrow" label="MCP 注解" width="150">
              <template #default="{ row }">
                <div class="hints">
                  <el-tooltip content="readOnlyHint(可信宿主采信,只读直通)" placement="top"><span class="hint" :class="{ on: parseAnnotations(row.annotationsJson)?.readOnlyHint }">R</span></el-tooltip>
                  <el-tooltip content="destructiveHint(破坏性)" placement="top"><span class="hint" :class="{ on: parseAnnotations(row.annotationsJson)?.destructiveHint }">D</span></el-tooltip>
                  <el-tooltip content="idempotentHint(幂等,自动重试门槛)" placement="top"><span class="hint" :class="{ on: parseAnnotations(row.annotationsJson)?.idempotentHint }">I</span></el-tooltip>
                  <el-tooltip content="openWorldHint(开放世界,确认卡出口警示)" placement="top"><span class="hint" :class="{ on: parseAnnotations(row.annotationsJson)?.openWorldHint }">W</span></el-tooltip>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="schema 指纹" min-width="150">
              <template #default="{ row }"><span class="mono fingerprint">{{ row.schemaSha256 }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="360" fixed="right">
              <template #default="{ row }">
                <el-button text type="primary" size="small" :icon="Refresh" @click="refreshTool(row)">刷新</el-button>
                <el-button text type="primary" size="small" :icon="Clock" @click="openHistory(row)">历史</el-button>
                <el-button v-if="row.revalidateRequired" text type="success" size="small" :icon="CircleCheck" @click="confirmSchema(row)">确认</el-button>
                <el-button v-if="row.revalidateRequired" text type="warning" size="small" :icon="CircleClose" @click="rejectSchema(row)">拒绝</el-button>
                <el-button text type="primary" size="small" :icon="Setting" @click="openPolicy(row)">策略</el-button>
                <el-button
                  text size="small" :type="row.enabled ? 'danger' : 'success'"
                  @click="toggleEnabled(row)"
                >
                  {{ row.enabled ? '停用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <IaPagination
            v-model:page="store.toolFilters.pageNo"
            v-model:size="store.toolFilters.pageSize"
            :total="store.toolsTotal"
            @page-change="store.loadTools()"
            @size-change="store.loadTools()"
          />
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="`用户授权(${store.grantsTotal})`" name="grants">
        <el-card shadow="never" class="toolbar-card">
          <div class="toolbar">
            <el-input v-model="store.grantFilters.toolName" class="toolbar__search" placeholder="工具名(精确)" clearable @keyup.enter="store.loadGrants()" />
            <el-input v-model="store.grantFilters.userId" class="toolbar__search" placeholder="用户 ID(数字)" clearable @keyup.enter="store.loadGrants()" />
            <el-select v-model="store.grantFilters.scope" class="toolbar__select-sm" placeholder="作用域" clearable @change="store.loadGrants()">
              <el-option label="本会话(conversation)" value="conversation" />
              <el-option label="总是允许(permanent)" value="permanent" />
            </el-select>
            <el-checkbox v-model="store.grantFilters.includeInvalid" @change="store.loadGrants()">含失效记录</el-checkbox>
            <el-button :icon="Refresh" @click="store.loadGrants()">查询</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table v-loading="store.grantsLoading" :data="store.grants" row-key="id">
            <!-- 空态(#9):授权 0 行 → 明确下一步 -->
            <template #empty>
              <IaEmpty description="还没有工具授权记录" hint="可为宿主用户代授工具(本会话/总是允许)">
                <template #action>
                  <el-button type="primary" :icon="Plus" @click="openGrant">代授工具授权</el-button>
                </template>
              </IaEmpty>
            </template>
            <el-table-column prop="userId" label="用户" width="100" />
            <el-table-column prop="toolFqn" label="工具 FQN" min-width="230" show-overflow-tooltip>
              <template #default="{ row }"><span class="mono">{{ row.toolFqn }}</span></template>
            </el-table-column>
            <el-table-column label="作用域" width="110">
              <template #default="{ row }">
                <el-tag :type="row.scope === 'permanent' ? 'warning' : 'info'" size="small">
                  {{ row.scope === 'permanent' ? '总是允许' : '本会话' }}
                </el-tag>
                <div v-if="row.conversationId" class="dim mono conv">{{ row.conversationId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="授予时风险" width="100">
              <template #default="{ row }">
                <el-tag :type="riskMeta(row.riskAtGrant)?.tag" size="small">{{ riskMeta(row.riskAtGrant)?.label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="!narrow" label="schema 指纹" min-width="140">
              <template #default="{ row }"><span class="mono fingerprint">{{ row.schemaSha256 }}</span></template>
            </el-table-column>
            <el-table-column label="来源" width="100">
              <template #default="{ row }">
                <el-tag :type="row.source === 'admin' ? 'info' : 'success'" size="small" effect="plain">
                  {{ row.source === 'admin' ? '管理员代授' : '确认流' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="150">
              <template #default="{ row }">
                <el-tag v-if="!row.invalidated" type="success" size="small">有效</el-tag>
                <el-tooltip v-else :content="`decisionNote:${row.decisionNote ?? '—'}`" placement="top">
                  <el-tag type="danger" size="small" effect="plain">{{ invalidatedTag(row) }}</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="授予时间" min-width="120">
              <template #default="{ row }"><IaTime :value="row.createTime" /></template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button text type="danger" size="small" :disabled="row.invalidated" @click="revokeGrant(row)">撤销</el-button>
              </template>
            </el-table-column>
          </el-table>
          <IaPagination
            v-model:page="store.grantFilters.pageNo"
            v-model:size="store.grantFilters.pageSize"
            :total="store.grantsTotal"
            @page-change="store.loadGrants()"
            @size-change="store.loadGrants()"
          />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 注册工具(单条,镜像 RegisterToolReqVO) -->
    <el-dialog v-model="registerVisible" title="注册工具" width="600px">
      <el-alert type="info" :closable="false" show-icon class="mb12"
        title="注册时生成 FQN(mcp__<serverKey>__<toolName>)与 schema sha256 指纹;风险等级由注解生成默认值,删除/资金/凭据类关键词强制高危。"
      />
      <el-form label-width="120px">
        <el-form-item label="serverKey" required>
          <el-input v-model="registerForm.serverKey" placeholder="FQN 前缀,仅字母/数字/连字符(如 demo-host)" maxlength="64" />
        </el-form-item>
        <el-form-item label="工具名" required>
          <el-input v-model="registerForm.toolName" placeholder="MCP tools/list 返回的 name(应用内唯一)" maxlength="128" />
        </el-form-item>
        <el-form-item label="来源" required>
          <el-radio-group v-model="registerForm.source">
            <el-radio value="host_app">host_app(宿主应用)</el-radio>
            <el-radio value="third_party">third_party(三方 MCP)</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="registerForm.source === 'third_party'" label="端点 URL">
          <el-input v-model="registerForm.endpointUrl" placeholder="https://mcp.example.com/mcp" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="registerForm.description" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
        <el-form-item label="入参 Schema">
          <el-input
            v-model="registerForm.parametersSchema"
            type="textarea"
            :rows="4"
            class="mono"
            spellcheck="false"
            placeholder='{"type":"object","properties":{}}(JSON Schema,留空表示无入参)'
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="registerVisible = false">取消</el-button>
        <el-button type="primary" :loading="registering" @click="submitRegister">注册</el-button>
      </template>
    </el-dialog>

    <!-- 治理元数据(PUT /tools/{id}) -->
    <el-dialog v-model="policyVisible" :title="`治理元数据:${policyTool?.fqn}`" width="540px">
      <el-form label-width="120px">
        <el-form-item label="风险等级">
          <el-radio-group v-model="policyForm.riskLevel">
            <el-radio-button v-for="r in RISK_LEVELS" :key="r.value" :value="r.value">{{ r.label }}</el-radio-button>
          </el-radio-group>
          <div class="form-hint">注解生成默认值,此处人工覆盖;升级将自动失效存量授权并通知用户。删除/资金/凭据类工具强制高危且不可下调(服务端 400)。</div>
        </el-form-item>
        <el-form-item label="管理员策略">
          <el-select v-model="policyForm.adminPolicy" clearable placeholder="不强制(NULL)">
            <el-option v-for="p in ADMIN_POLICIES" :key="p.label" :label="p.label" :value="p.value ?? undefined" />
          </el-select>
          <div class="form-hint">{{ ADMIN_POLICIES.find(p => p.value === policyForm.adminPolicy)?.desc }};优先级高于用户授权</div>
        </el-form-item>
        <el-form-item label="resumeSafe">
          <el-switch v-model="policyForm.resumeSafe" />
          <div class="form-hint">可被 continue 重执行(默认取 MCP idempotentHint)</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="policyVisible = false">取消</el-button>
        <el-button type="primary" :loading="policySaving" @click="savePolicy">保存</el-button>
      </template>
    </el-dialog>

    <!-- schema 历史(优化建议 #11:applied/pending_review/rejected/silent_refresh + 指纹 diff) -->
    <el-drawer
      v-model="historyVisible"
      :title="`schema 历史:${historyTool?.fqn ?? ''}`"
      size="520px"
    >
      <div v-if="historyTool" class="history-meta">
        <span>当前指纹</span>
        <span class="mono fingerprint">{{ historyTool.schemaSha256 ?? '—' }}</span>
      </div>
      <el-empty v-if="!historyLoading && historyEntries.length === 0" description="暂无变更历史(注册后未发生过 schema 分诊)" />
      <el-timeline v-else v-loading="historyLoading" class="history-timeline">
        <el-timeline-item
          v-for="h in historyEntries"
          :key="h.id"
          :type="OUTCOME_META[h.outcome]?.type"
          :timestamp="`${h.createTime ?? '—'} · 操作者:${h.actor ?? 'system'}`"
        >
          <div class="history-head">
            <el-tag size="small" :type="OUTCOME_META[h.outcome]?.type">{{ OUTCOME_META[h.outcome]?.label ?? h.outcome }}</el-tag>
            <el-tag size="small" type="info" effect="plain">{{ TRIAGE_LABELS[h.triage] ?? h.triage }}</el-tag>
          </div>
          <div class="mono fp-diff">
            <span class="dim">{{ h.previousSha256 ? shortSha(h.previousSha256) : '(初始)' }}</span>
            <span class="arrow">→</span>
            <span>{{ h.newSha256 ? shortSha(h.newSha256) : '(清除)' }}</span>
          </div>
          <ul v-if="historyReasons(h.detail).length" class="history-reasons">
            <li v-for="(r, i) in historyReasons(h.detail)" :key="i">{{ r }}</li>
          </ul>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>

    <!-- 代授 -->
    <el-dialog v-model="grantVisible" title="代授工具授权" width="540px">
      <el-form label-width="110px">
        <el-form-item label="用户 ID" required>
          <el-input v-model="grantForm.userId" placeholder="宿主应用侧数字用户 ID" />
        </el-form-item>
        <el-form-item label="工具" required>
          <el-select v-model="grantForm.toolName" filterable placeholder="选择已启用的工具(按工具名)">
            <el-option v-for="t in grantableTools" :key="t.id" :label="`${t.toolName}(${t.fqn})`" :value="t.toolName" />
          </el-select>
        </el-form-item>
        <el-form-item label="作用域">
          <el-radio-group v-model="grantForm.scope">
            <el-radio value="permanent">总是允许(不过期)</el-radio>
            <el-radio value="conversation">本会话(随会话失效)</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="grantForm.scope === 'conversation'" label="会话 ID" required>
          <el-input v-model="grantForm.conversationId" placeholder="ia_agent_conversation.conversation_id(UUID)" />
        </el-form-item>
        <el-form-item label="决策记录">
          <el-input v-model="grantForm.decisionNote" type="textarea" :rows="2" maxlength="200" placeholder="授予说明(落 decision_note 与审计)" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantVisible = false">取消</el-button>
        <el-button type="primary" :loading="grantSaving" @click="submitGrant">授予</el-button>
      </template>
    </el-dialog>
  </IaPageContainer>
</template>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar__search { width: 190px; }
.toolbar__select { width: 120px; }
.toolbar__select-sm { width: 100px; }
.toolbar__spacer { flex: 1; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.fingerprint { font-size: 12px; color: #909399; }
.dim { color: #c0c4cc; }
.ml4 { margin-left: 4px; }
.conv { font-size: 11px; }
.hints { display: flex; gap: 4px; }
.hint {
  display: inline-flex; width: 18px; height: 18px;
  align-items: center; justify-content: center;
  border-radius: 3px; background: #f0f2f5; color: #c0c4cc;
  font-size: 11px; font-weight: 600;
}
.hint.on { background: #fde2e2; color: #c45656; }
.form-hint { color: #909399; font-size: 12px; margin-top: 4px; width: 100%; }
.history-meta { display: flex; flex-direction: column; gap: 2px; margin-bottom: 16px; color: #606266; font-size: 13px; }
.history-head { display: flex; gap: 6px; margin-bottom: 4px; }
.history-timeline { padding-left: 4px; }
.fp-diff { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.fp-diff .arrow { color: #c0c4cc; }
.history-reasons { margin: 0; padding-left: 18px; color: #909399; font-size: 12px; }
.mb12 { margin-bottom: 12px; }
</style>
