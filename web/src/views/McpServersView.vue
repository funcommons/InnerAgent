<script setup lang="ts">
/**
 * [new] 三方 MCP 服务器视图(P4-W13,视图清单 #8;AdminMcpServerController 应用级)。
 * 列表(serverKey/endpoint/auth_type/enabled/超时,含停用)+ 注册/编辑表单
 * (serverKey 字符集提示 [A-Za-z0-9-]、endpoint URL、静态头名/值——值打码
 * 不回显,编辑须重新输入)+ 启停 + 删除;OAUTH 选项置灰「暂未支持」(后端 501)。
 * 防遮蔽:serverKey 与宿主注册表工具冲突 → 409 友好呈现。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaTime from '@/components/IaTime.vue'
import { apiErrorMessage } from '@/stores/apps'
import { useMcpServersStore } from '@/stores/mcp-servers'
import type { IaMcpServer, McpServerSaveReq } from '@/api/types'

const store = useMcpServersStore()

onMounted(() => {
  void store.load()
})

/** serverKey 字符集(镜像 McpThirdPartyServerSupport.SERVER_KEY:[A-Za-z0-9-]{1,64}) */
const SERVER_KEY_PATTERN = /^[A-Za-z0-9-]{1,64}$/

// ===== 注册/编辑(全表单语义:PUT 与注册同一 normalize,credentials 必填) =====
const formVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({
  serverKey: '',
  name: '',
  endpointUrl: '',
  authType: 'STATIC_HEADER' as 'STATIC_HEADER' | 'OAUTH',
  headerName: '',
  credentials: '',
  timeoutSeconds: 30,
  enabled: true,
})

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    serverKey: '', name: '', endpointUrl: '', authType: 'STATIC_HEADER',
    headerName: '', credentials: '', timeoutSeconds: 30, enabled: true,
  })
  formVisible.value = true
}

function openEdit(row: IaMcpServer) {
  editingId.value = row.id
  Object.assign(form, {
    serverKey: row.serverKey,
    name: row.name ?? '',
    endpointUrl: row.endpointUrl,
    authType: row.authType,
    headerName: row.headerName ?? '',
    credentials: '', // 打码不回显:更新须重新输入(全表单语义)
    timeoutSeconds: row.timeoutSeconds,
    enabled: row.enabled,
  })
  formVisible.value = true
}

function validateForm(): string | null {
  if (!form.serverKey.trim()) return 'serverKey 不能为空'
  if (!SERVER_KEY_PATTERN.test(form.serverKey.trim())) {
    return 'serverKey 仅允许字母/数字/连字符(避用下划线,FQN 命名空间)'
  }
  if (!form.name.trim()) return '名称不能为空'
  if (!form.endpointUrl.trim()) return 'endpoint URL 不能为空'
  if (!/^https?:\/\//.test(form.endpointUrl.trim())) return 'endpoint URL 须为 http(s):// 地址'
  if (form.authType === 'OAUTH') return 'OAuth 暂未支持:当前仅支持 STATIC_HEADER 静态头鉴权'
  if (!form.headerName.trim()) return '静态头名不能为空'
  if (!form.credentials.trim()) return '静态头值不能为空(打码不回显,编辑须重新输入)'
  if (form.timeoutSeconds < 1 || form.timeoutSeconds > 600) return '超时须在 1-600 秒之间'
  return null
}

async function submitForm() {
  const problem = validateForm()
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  saving.value = true
  try {
    const req: McpServerSaveReq = {
      serverKey: form.serverKey.trim(),
      name: form.name.trim(),
      endpointUrl: form.endpointUrl.trim(),
      authType: form.authType,
      headerName: form.headerName.trim(),
      credentials: form.credentials.trim(),
      timeoutSeconds: form.timeoutSeconds,
      enabled: form.enabled,
    }
    if (editingId.value === null) {
      await store.create(req)
      ElMessage.success(`已注册 ${req.serverKey}(目录将拉取其三方工具清单)`)
    } else {
      await store.update(editingId.value, req)
      ElMessage.success('已更新(工具清单缓存已失效,下次调用重新拉取)')
    }
    formVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, editingId.value === null ? '注册失败' : '更新失败'))
  } finally {
    saving.value = false
  }
}

// ===== 启停 =====
async function toggleEnabled(row: IaMcpServer) {
  if (row.enabled) {
    const confirmed = await ElMessageBox.confirm(
      `停用后:${row.serverKey} 的全部三方工具将从目录摘除,进行中的运行按内核快照继续。继续?`,
      '停用三方 MCP 服务器',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false)
    if (!confirmed) return
  }
  try {
    await store.setEnabled(row.id, !row.enabled)
    ElMessage.success(row.enabled ? '已停用(目录摘除其全部三方工具)' : '已启用(目录恢复其三方工具)')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '操作失败'))
  }
}

// ===== 删除 =====
async function remove(row: IaMcpServer) {
  const confirmed = await ElMessageBox.confirm(
    `删除 ${row.serverKey}(${row.name ?? '未命名'})?删除后其三方工具注册关系一并清理,不可恢复。`,
    '删除三方 MCP 服务器',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  try {
    await store.remove(row.id)
    ElMessage.success('已删除')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '删除失败'))
  }
}
</script>

<template>
  <IaPageContainer subtitle="应用级三方 MCP 服务器:注册后目录自动挂载其工具(credentials 打码不回显)">
    <template #action>
      <el-button :icon="Refresh" @click="store.load()">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreate">注册服务器</el-button>
    </template>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id">
        <template #empty>
          <IaEmpty description="还没有注册任何三方 MCP 服务器" hint="注册后经 Streamable HTTP 端点拉取工具清单(serverKey 不与宿主注册表遮蔽)">
            <template #action>
              <el-button type="primary" :icon="Plus" @click="openCreate">注册第一个服务器</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column prop="serverKey" label="serverKey" min-width="140" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.serverKey }}</span></template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="endpointUrl" label="端点" min-width="210" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono dim">{{ row.endpointUrl }}</span></template>
        </el-table-column>
        <el-table-column label="鉴权" width="150">
          <template #default="{ row }">
            <el-tag :type="row.authType === 'STATIC_HEADER' ? 'info' : 'warning'" size="small" effect="plain">
              {{ row.authType === 'STATIC_HEADER' ? '静态头' : 'OAuth' }}
            </el-tag>
            <div v-if="row.headerName" class="mono dim header-name">{{ row.headerName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="头值" width="110">
          <template #default="{ row }">
            <span v-if="row.credentialsMasked" class="mono masked">{{ row.credentialsMasked }}</span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="timeoutSeconds" label="超时" width="76">
          <template #default="{ row }">{{ row.timeoutSeconds }}s</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="120">
          <template #default="{ row }"><IaTime :value="row.updateTime" /></template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button text size="small" :type="row.enabled ? 'danger' : 'success'" @click="toggleEnabled(row)">
              {{ row.enabled ? '停用' : '启用' }}
            </el-button>
            <el-button text type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 注册/编辑(全表单语义:credentials 打码不回显,编辑须重新输入) -->
    <el-dialog v-model="formVisible" :title="editingId === null ? '注册三方 MCP 服务器' : `编辑:${form.serverKey}`" width="620px">
      <el-alert type="info" :closable="false" show-icon class="mb12"
        title="serverKey 是工具 FQN 命名空间(mcp__<serverKey>__<tool>),仅字母/数字/连字符且不得与宿主注册表冲突(防遮蔽)。"
      />
      <el-form label-width="110px">
        <el-form-item label="serverKey" required>
          <el-input v-model="form.serverKey" :disabled="editingId !== null" placeholder="如 crm-mcp(仅字母/数字/连字符)" maxlength="64" />
          <div class="form-hint">字符集 [A-Za-z0-9-]:下划线会被拒绝;编辑时不可更改。</div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="展示名(≤128 字符)" maxlength="128" />
        </el-form-item>
        <el-form-item label="端点 URL" required>
          <el-input v-model="form.endpointUrl" placeholder="https://mcp.example.com/mcp(Streamable HTTP)" />
        </el-form-item>
        <el-form-item label="鉴权方式" required>
          <el-radio-group v-model="form.authType">
            <el-radio value="STATIC_HEADER">静态头(STATIC_HEADER)</el-radio>
            <el-tooltip content="OAuth(CIMD/DCR)暂未实现:配置即 501,当前仅支持静态头鉴权" placement="top">
              <el-radio value="OAUTH" disabled>OAuth(暂未支持)</el-radio>
            </el-tooltip>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="静态头名" required>
          <el-input v-model="form.headerName" placeholder="如 X-Api-Key / Authorization" maxlength="128" />
        </el-form-item>
        <el-form-item label="静态头值" required>
          <el-input
            v-model="form.credentials"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="editingId === null ? '头值(只写,响应中永为打码形)' : '已打码不回显,更新须重新输入'"
          />
          <div class="form-hint">值不进审计/日志;列表仅显示前 2 字符掩码。</div>
        </el-form-item>
        <el-form-item label="超时(秒)">
          <el-input-number v-model="form.timeoutSeconds" :min="1" :max="600" />
          <span class="form-hint form-hint--inline">tools/call 超时,1-600,缺省 30</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ editingId === null ? '注册' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </IaPageContainer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; }
.masked { color: #b88230; }
.header-name { font-size: 11px; margin-top: 2px; }
.form-hint { color: #909399; font-size: 12px; margin-top: 4px; width: 100%; }
.form-hint--inline { margin: 0 0 0 8px; width: auto; }
.mb12 { margin-bottom: 12px; }
</style>
