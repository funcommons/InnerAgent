<script setup lang="ts">
/**
 * [new] 应用管理视图(视图清单 #2)。
 * ia_app 列表 / 创建 / 编辑 / embed 签发密钥 RSA 公钥登记 / 密钥轮换 UI 占位。
 * 保留期字段对应 ADR-9(默认 180 天应用级可配)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Key, EditPen } from '@element-plus/icons-vue'
import { useAppsStore, apiErrorMessage, isValidPemPublicKey } from '@/stores/apps'
import type { IaApp } from '@/api/types'

const store = useAppsStore()

const statusText: Record<number, string> = { 1: '启用', 0: '停用' }
const statusTag: Record<number, 'success' | 'info'> = { 1: 'success', 0: 'info' }

onMounted(() => {
  void store.load()
})

function search() {
  store.filters.pageNo = 1
  void store.load()
}

// ===== 创建 / 编辑 =====
const editVisible = ref(false)
const editing = ref<IaApp | null>(null)
const saving = ref(false)
const editForm = reactive({ appKey: '', name: '', retentionDays: 180, remark: '' })

function openCreate() {
  editing.value = null
  Object.assign(editForm, { appKey: '', name: '', retentionDays: 180, remark: '' })
  editVisible.value = true
}

function openEdit(app: IaApp) {
  editing.value = app
  Object.assign(editForm, { appKey: app.appKey, name: app.name, retentionDays: app.retentionDays, remark: app.remark ?? '' })
  editVisible.value = true
}

async function saveEdit() {
  if (!editForm.name.trim() || (!editing.value && !editForm.appKey.trim())) {
    ElMessage.warning('请填写 appKey 与名称')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await store.update(editing.value.id, {
        name: editForm.name, retentionDays: editForm.retentionDays, remark: editForm.remark,
      })
      ElMessage.success('已保存')
    } else {
      await store.create({
        appKey: editForm.appKey.trim(), name: editForm.name,
        retentionDays: editForm.retentionDays, remark: editForm.remark,
      })
      ElMessage.success('应用已创建;下一步请登记 embed 签发公钥')
    }
    editVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    saving.value = false
  }
}

// ===== 公钥登记 / 轮换 =====
const keyVisible = ref(false)
const keyApp = ref<IaApp | null>(null)
const keyMode = ref<'register' | 'rotate'>('register')
const keyPem = ref('')
const keySaving = ref(false)

function openKey(app: IaApp, mode: 'register' | 'rotate') {
  keyApp.value = app
  keyMode.value = mode
  keyPem.value = ''
  keyVisible.value = true
}

async function saveKey() {
  if (!keyApp.value) return
  if (!isValidPemPublicKey(keyPem.value)) {
    ElMessage.warning('请粘贴完整的 RSA PEM 公钥(-----BEGIN PUBLIC KEY----- ... )')
    return
  }
  if (keyMode.value === 'rotate') {
    const confirmed = await ElMessageBox.confirm(
      '轮换后新 embed token 用新公钥签发;请确认宿主已部署双公钥宽限期(72h,自拟语义,P2 对齐)。继续?',
      '密钥轮换确认',
      { type: 'warning', confirmButtonText: '确认轮换', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false)
    if (!confirmed) return
  }
  keySaving.value = true
  try {
    const resp = keyMode.value === 'register'
      ? await store.registerPublicKey(keyApp.value.id, keyPem.value)
      : await store.rotateKey(keyApp.value.id, keyPem.value)
    ElMessage.success(`公钥已${keyMode.value === 'register' ? '登记' : '轮换'}:指纹 ${resp.fingerprint}`)
    keyVisible.value = false
    await store.load()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '公钥保存失败'))
  } finally {
    keySaving.value = false
  }
}
</script>

<template>
  <div class="view">
    <el-card shadow="never" class="toolbar-card">
      <div class="toolbar">
        <el-input
          v-model="store.filters.keyword"
          class="toolbar__search"
          placeholder="按名称 / appKey 搜索"
          clearable
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="store.filters.status" class="toolbar__status" placeholder="状态" clearable @change="search">
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button :icon="Refresh" @click="search">查询</el-button>
        <div class="toolbar__spacer" />
        <el-button type="primary" :icon="Plus" @click="openCreate">新建应用</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id">
        <el-table-column prop="appKey" label="appKey" min-width="140" show-overflow-tooltip />
        <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status as number]" size="small">{{ statusText[row.status as number] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="embed 公钥" min-width="180">
          <template #default="{ row }">
            <template v-if="row.signKeyFingerprint">
              <span class="mono fingerprint">{{ row.signKeyFingerprint }}</span>
            </template>
            <el-tag v-else type="warning" size="small">未登记</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="retentionDays" label="保留期(天)" width="100" align="right" />
        <el-table-column label="紧急停用" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.emergencyStopped" type="danger" size="small">已停用</el-tag>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="Webhook" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.webhookEnabled" type="success" size="small">已启用</el-tag>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" :icon="Key" @click="openKey(row, row.signKeyFingerprint ? 'rotate' : 'register')">
              {{ row.signKeyFingerprint ? '轮换密钥' : '登记公钥' }}
            </el-button>
            <el-button text type="primary" size="small" :icon="EditPen" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="store.filters.pageNo"
        v-model:page-size="store.filters.pageSize"
        class="pager"
        layout="total, sizes, prev, pager, next"
        :total="store.total"
        :page-sizes="[10, 20, 50]"
        @current-change="store.load()"
        @size-change="search"
      />
    </el-card>

    <!-- 创建 / 编辑 -->
    <el-dialog
      v-model="editVisible"
      :title="editing ? `编辑应用:${editing.name}` : '新建应用'"
      width="520px"
    >
      <el-form label-width="110px">
        <el-form-item label="appKey" required>
          <el-input v-model="editForm.appKey" :disabled="!!editing" placeholder="唯一键,创建后不可改" maxlength="64" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editForm.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="会话保留期">
          <el-input-number v-model="editForm.retentionDays" :min="1" :max="3650" />
          <span class="form-hint">天(ADR-9:默认 180,到期物理清理;审计不受影响)</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 公钥登记 / 轮换 -->
    <el-dialog
      v-model="keyVisible"
      :title="keyMode === 'register' ? `登记 embed 签发公钥:${keyApp?.name}` : `轮换 embed 签发公钥:${keyApp?.name}`"
      width="620px"
    >
      <el-alert
        v-if="keyMode === 'rotate' && keyApp?.signKeyFingerprint"
        type="warning"
        :closable="false"
        show-icon
        class="rotate-alert"
        title="轮换为占位流程:当前指纹与新指纹并存宽限期的服务端语义未定(P2 对齐),此处仅提交新公钥。"
        :description="`当前指纹:${keyApp.signKeyFingerprint}`"
      />
      <el-form label-width="90px">
        <el-form-item label="RSA 公钥" required>
          <el-input
            v-model="keyPem"
            type="textarea"
            :rows="7"
            class="mono"
            spellcheck="false"
            placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="keyVisible = false">取消</el-button>
        <el-button type="primary" :loading="keySaving" @click="saveKey">
          {{ keyMode === 'register' ? '登记' : '确认轮换' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.toolbar__search {
  width: 240px;
}
.toolbar__status {
  width: 110px;
}
.toolbar__spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.fingerprint {
  font-size: 12px;
}
.dim {
  color: #c0c4cc;
}
.form-hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.rotate-alert {
  margin-bottom: 12px;
}
</style>
