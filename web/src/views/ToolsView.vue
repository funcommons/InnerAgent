<script setup lang="ts">
/**
 * [new] 工具注册与授权视图(视图清单 #3)。
 * Tab1 ia_tool_registry:FQN / schema 指纹(sha256)/ 风险等级 / MCP 注解 /
 *      管理员策略 / resumeSafe / 健康状态;注册(录入 MCP 端点)/ 刷新分诊 / 停用启用 / 策略覆盖。
 * Tab2 ia_tool_grant:授权列表(含失效原因)/ 授予 / 撤销。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, CircleCheck, CircleClose, Setting } from '@element-plus/icons-vue'
import {
  useToolsStore, RISK_LEVELS, ADMIN_POLICIES, GRANT_INVALID_REASONS,
} from '@/stores/tools'
import { apiErrorMessage } from '@/stores/apps'
import type { GrantScope, IaToolGrant, IaToolRegistry, ToolRiskLevel } from '@/api/types'

const store = useToolsStore()
const tab = ref<'registry' | 'grants'>('registry')

const riskMeta = (level: string) => RISK_LEVELS.find(r => r.value === level)
const policyLabel = (value: string) => ADMIN_POLICIES.find(p => p.value === value)?.label ?? value

onMounted(() => {
  void store.loadTools()
  void store.loadGrants()
})

// ===== 注册 =====
const registerVisible = ref(false)
const registering = ref(false)
const registerForm = reactive({ serverKey: '', serverName: '', endpoint: '', transport: 'streamable_http' as 'streamable_http' | 'sse', credential: '' })

function openRegister() {
  Object.assign(registerForm, { serverKey: '', serverName: '', endpoint: '', transport: 'streamable_http', credential: '' })
  registerVisible.value = true
}

async function submitRegister() {
  if (!registerForm.serverKey.trim() || !registerForm.endpoint.trim()) {
    ElMessage.warning('serverKey 与端点必填;serverKey 请避免下划线(FQN 分隔符)')
    return
  }
  registering.value = true
  try {
    const resp = await store.register({
      serverKey: registerForm.serverKey.trim(), serverName: registerForm.serverName.trim() || registerForm.serverKey.trim(),
      endpoint: registerForm.endpoint.trim(), transport: registerForm.transport,
      credential: registerForm.credential || undefined,
    })
    ElMessage.success(`注册完成:拉取 ${resp.registered} 把工具,指纹与风险默认已生成`)
    registerVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '注册失败'))
  } finally {
    registering.value = false
  }
}

// ===== 刷新(活刷新分诊)=====
async function refreshTool(t: IaToolRegistry) {
  try {
    const resp = await store.refresh(t.id)
    if (resp.applied) {
      ElMessage.success(`${resp.fqn}:${resp.message}`)
    } else {
      ElMessageBox.alert(resp.message, `安全相关差异:${resp.fqn}`, { type: 'warning', confirmButtonText: '知道了' }).catch(() => undefined)
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '刷新失败'))
  }
}

// ===== 停用 / 启用 =====
async function toggleEnabled(t: IaToolRegistry) {
  if (t.status === 1) {
    const confirmed = await ElMessageBox.confirm(
      `停用后:${t.fqn} 从所有 Agent 白名单摘除;进行中的运行按内核快照继续;该工具全部用户授权将被级联清除。继续?`,
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

// ===== 策略覆盖 =====
const policyVisible = ref(false)
const policyTool = ref<IaToolRegistry | null>(null)
const policyForm = reactive({ riskLevel: 'medium' as ToolRiskLevel, adminPolicy: 'default' as IaToolRegistry['adminPolicy'], resumeSafe: false })
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
    await store.updatePolicy(policyTool.value.id, { ...policyForm })
    ElMessage.success('策略已更新(风险升级会自动失效存量授权)')
    policyVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '策略更新失败'))
  } finally {
    policySaving.value = false
  }
}

// ===== 授权 =====
const grantVisible = ref(false)
const grantSaving = ref(false)
const grantForm = reactive({ userId: '', toolFqn: '', scope: 'permanent' as GrantScope })

const grantableTools = computed(() => store.tools.filter(t => t.status === 1))

function openGrant() {
  Object.assign(grantForm, { userId: '', toolFqn: '', scope: 'permanent' })
  grantVisible.value = true
}

async function submitGrant() {
  if (!grantForm.userId.trim() || !grantForm.toolFqn) {
    ElMessage.warning('请填写用户 ID 并选择工具')
    return
  }
  grantSaving.value = true
  try {
    await store.grant({ userId: grantForm.userId.trim(), toolFqn: grantForm.toolFqn, scope: grantForm.scope })
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

function invalidTag(g: IaToolGrant): string {
  return g.invalid ? (GRANT_INVALID_REASONS[g.invalidReason ?? ''] ?? '已失效') : '有效'
}
</script>

<template>
  <div class="view">
    <el-tabs v-model="tab">
      <el-tab-pane label="工具注册表" name="registry">
        <el-card shadow="never" class="toolbar-card">
          <div class="toolbar">
            <el-input v-model="store.toolFilters.keyword" class="toolbar__search" placeholder="工具名 / FQN / 描述" clearable @keyup.enter="store.loadTools()" />
            <el-select v-model="store.toolFilters.riskLevel" class="toolbar__select" placeholder="风险等级" clearable @change="store.loadTools()">
              <el-option v-for="r in RISK_LEVELS" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
            <el-select v-model="store.toolFilters.status" class="toolbar__select-sm" placeholder="状态" clearable @change="store.loadTools()">
              <el-option label="启用" :value="1" />
              <el-option label="停用" :value="0" />
            </el-select>
            <el-button :icon="Refresh" @click="store.loadTools()">查询</el-button>
            <div class="toolbar__spacer" />
            <el-button type="primary" :icon="Plus" @click="openRegister">注册 MCP 端点</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table v-loading="store.toolsLoading" :data="store.tools" row-key="id">
            <el-table-column prop="fqn" label="FQN" min-width="230" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono">{{ row.fqn }}</span>
                <el-tag v-if="row.adminPolicy !== 'default'" size="small" type="warning" class="ml4">{{ policyLabel(row.adminPolicy) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
            <el-table-column label="风险" width="80">
              <template #default="{ row }">
                <el-tag :type="riskMeta(row.riskLevel)?.tag" size="small">{{ riskMeta(row.riskLevel)?.label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="写操作" width="70" align="center">
              <template #default="{ row }">
                <el-tag :type="row.writeOperation ? 'danger' : 'success'" size="small" effect="plain">{{ row.writeOperation ? '写' : '读' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="MCP 注解" width="150">
              <template #default="{ row }">
                <div class="hints">
                  <el-tooltip content="readOnlyHint(可信宿主采信,只读直通)" placement="top"><span class="hint" :class="{ on: row.annotations.readOnlyHint }">R</span></el-tooltip>
                  <el-tooltip content="destructiveHint(破坏性)" placement="top"><span class="hint" :class="{ on: row.annotations.destructiveHint }">D</span></el-tooltip>
                  <el-tooltip content="idempotentHint(幂等,自动重试门槛)" placement="top"><span class="hint" :class="{ on: row.annotations.idempotentHint }">I</span></el-tooltip>
                  <el-tooltip content="openWorldHint(开放世界,确认卡出口警示)" placement="top"><span class="hint" :class="{ on: row.annotations.openWorldHint }">W</span></el-tooltip>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="schema 指纹" min-width="150">
              <template #default="{ row }"><span class="mono fingerprint">{{ row.schemaFingerprint }}</span></template>
            </el-table-column>
            <el-table-column label="健康" width="90">
              <template #default="{ row }">
                <el-tooltip v-if="row.healthMessage" :content="row.healthMessage" placement="top">
                  <el-tag :type="row.healthStatus === 'healthy' ? 'success' : row.healthStatus === 'unhealthy' ? 'danger' : 'info'" size="small">
                    {{ row.healthStatus }}
                  </el-tag>
                </el-tooltip>
                <el-tag v-else :type="row.healthStatus === 'healthy' ? 'success' : 'info'" size="small">{{ row.healthStatus }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <el-button text type="primary" size="small" :icon="Refresh" @click="refreshTool(row)">刷新</el-button>
                <el-button text type="primary" size="small" :icon="Setting" @click="openPolicy(row)">策略</el-button>
                <el-button
                  text size="small" :type="row.status === 1 ? 'danger' : 'success'"
                  :icon="row.status === 1 ? CircleClose : CircleCheck"
                  @click="toggleEnabled(row)"
                >
                  {{ row.status === 1 ? '停用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-model:current-page="store.toolFilters.pageNo"
            v-model:page-size="store.toolFilters.pageSize"
            class="pager" layout="total, sizes, prev, pager, next"
            :total="store.toolsTotal" :page-sizes="[10, 20, 50]"
            @current-change="store.loadTools()" @size-change="store.loadTools()"
          />
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="`用户授权(${store.grantsTotal})`" name="grants">
        <el-card shadow="never" class="toolbar-card">
          <div class="toolbar">
            <el-input v-model="store.grantFilters.toolFqn" class="toolbar__search" placeholder="工具 FQN" clearable @keyup.enter="store.loadGrants()" />
            <el-input v-model="store.grantFilters.userId" class="toolbar__search" placeholder="用户 ID" clearable @keyup.enter="store.loadGrants()" />
            <el-select v-model="store.grantFilters.scope" class="toolbar__select-sm" placeholder="作用域" clearable @change="store.loadGrants()">
              <el-option label="本会话" value="session" />
              <el-option label="总是允许" value="permanent" />
            </el-select>
            <el-checkbox v-model="store.grantFilters.includeInvalid" @change="store.loadGrants()">含失效记录</el-checkbox>
            <el-button :icon="Refresh" @click="store.loadGrants()">查询</el-button>
            <div class="toolbar__spacer" />
            <el-button type="primary" :icon="Plus" @click="openGrant">代授</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table v-loading="store.grantsLoading" :data="store.grants" row-key="id">
            <el-table-column prop="userId" label="用户" width="130" />
            <el-table-column prop="toolFqn" label="工具 FQN" min-width="240" show-overflow-tooltip>
              <template #default="{ row }"><span class="mono">{{ row.toolFqn }}</span></template>
            </el-table-column>
            <el-table-column label="作用域" width="100">
              <template #default="{ row }">
                <el-tag :type="row.scope === 'permanent' ? 'warning' : 'info'" size="small">
                  {{ row.scope === 'permanent' ? '总是允许' : '本会话' }}
                </el-tag>
                <div v-if="row.conversationId" class="dim mono conv">{{ row.conversationId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="授予时风险" width="100">
              <template #default="{ row }">
                <el-tag :type="riskMeta(row.grantedRiskLevel)?.tag" size="small">{{ riskMeta(row.grantedRiskLevel)?.label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="schema 指纹" min-width="150">
              <template #default="{ row }"><span class="mono fingerprint">{{ row.schemaFingerprint }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="150">
              <template #default="{ row }">
                <el-tag v-if="!row.invalid" type="success" size="small">有效</el-tag>
                <el-tooltip v-else :content="`来源:${row.source}`" placement="top">
                  <el-tag type="danger" size="small" effect="plain">{{ invalidTag(row) }}</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column prop="grantedAt" label="授予时间" min-width="160" show-overflow-tooltip />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button text type="danger" size="small" :disabled="row.invalid" @click="revokeGrant(row)">撤销</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-model:current-page="store.grantFilters.pageNo"
            v-model:page-size="store.grantFilters.pageSize"
            class="pager" layout="total, sizes, prev, pager, next"
            :total="store.grantsTotal" :page-sizes="[10, 20, 50]"
            @current-change="store.loadGrants()" @size-change="store.loadGrants()"
          />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 注册 MCP 端点 -->
    <el-dialog v-model="registerVisible" title="注册宿主 MCP 端点" width="560px">
      <el-alert type="info" :closable="false" show-icon class="mb12"
        title="注册时服务端执行 list_tools 拉取工具清单,生成 FQN(mcp__<serverKey>__<tool>)与 schema sha256 指纹,风险等级由注解生成默认值。"
      />
      <el-form label-width="110px">
        <el-form-item label="serverKey" required>
          <el-input v-model="registerForm.serverKey" placeholder="FQN 前缀,避免下划线(如 demo-host)" maxlength="32" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="registerForm.serverName" maxlength="64" />
        </el-form-item>
        <el-form-item label="端点 URL" required>
          <el-input v-model="registerForm.endpoint" placeholder="https://host/ia-mcp" />
        </el-form-item>
        <el-form-item label="传输方式">
          <el-select v-model="registerForm.transport">
            <el-option label="Streamable HTTP(推荐)" value="streamable_http" />
            <el-option label="SSE(兼容)" value="sse" />
          </el-select>
        </el-form-item>
        <el-form-item label="凭证">
          <el-input v-model="registerForm.credential" type="password" show-password placeholder="Bearer Token 等,加密落库仅回显掩码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="registerVisible = false">取消</el-button>
        <el-button type="primary" :loading="registering" @click="submitRegister">注册并拉取清单</el-button>
      </template>
    </el-dialog>

    <!-- 策略覆盖 -->
    <el-dialog v-model="policyVisible" :title="`策略覆盖:${policyTool?.fqn}`" width="520px">
      <el-form label-width="120px">
        <el-form-item label="风险等级">
          <el-radio-group v-model="policyForm.riskLevel">
            <el-radio-button v-for="r in RISK_LEVELS" :key="r.value" :value="r.value">{{ r.label }}</el-radio-button>
          </el-radio-group>
          <div class="form-hint">注解生成默认值,此处人工覆盖;升级将自动失效存量授权并通知用户</div>
        </el-form-item>
        <el-form-item label="管理员策略">
          <el-select v-model="policyForm.adminPolicy">
            <el-option v-for="p in ADMIN_POLICIES" :key="p.value" :label="p.label" :value="p.value" />
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

    <!-- 代授 -->
    <el-dialog v-model="grantVisible" title="代授工具授权" width="520px">
      <el-form label-width="100px">
        <el-form-item label="用户 ID" required>
          <el-input v-model="grantForm.userId" placeholder="宿主应用侧用户标识" />
        </el-form-item>
        <el-form-item label="工具" required>
          <el-select v-model="grantForm.toolFqn" filterable placeholder="选择已启用的工具">
            <el-option v-for="t in grantableTools" :key="t.id" :label="t.fqn" :value="t.fqn" />
          </el-select>
        </el-form-item>
        <el-form-item label="作用域">
          <el-radio-group v-model="grantForm.scope">
            <el-radio value="permanent">总是允许(不过期)</el-radio>
            <el-radio value="session">本会话(随会话失效)</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantVisible = false">取消</el-button>
        <el-button type="primary" :loading="grantSaving" @click="submitGrant">授予</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar__search { width: 200px; }
.toolbar__select { width: 120px; }
.toolbar__select-sm { width: 100px; }
.toolbar__spacer { flex: 1; }
.pager { margin-top: 12px; justify-content: flex-end; }
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
.mb12 { margin-bottom: 12px; }
</style>
