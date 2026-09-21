<script setup lang="ts">
/**
 * [new] 应用管理视图(视图清单 #2)。
 * ia_app 列表 / 创建 / 编辑 / embed 签发公钥登记与轮换。
 * P2-key 对齐:公钥登记/轮换 = PUT /apps/{id} {signPublicKey};响应回
 * signKeyFingerprint/signKeyRotatedAt;轮换走服务端 V9 双公钥宽限期语义
 * (旧公钥 72h 验签宽限,inneragent.auth.embed-key-grace 可配);
 * webhookSecret 为 write-only,仅创建时一次性可见,回显仅 webhookSecretMasked。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Key, EditPen, CopyDocument } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import { useAppsStore, apiErrorMessage, isValidPemPublicKey } from '@/stores/apps'
import type { IaApp } from '@/api/types'

const store = useAppsStore()

const statusText: Record<number, string> = { 1: '启用', 0: '停用' }
const statusTag: Record<number, 'success' | 'info'> = { 1: 'success', 0: 'info' }
const PEM_PLACEHOLDER = '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'

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
const editForm = reactive({
  appKey: '', name: '', signPublicKey: '', webhookUrl: '', webhookSecret: '', status: 1,
})

function openCreate() {
  editing.value = null
  Object.assign(editForm, { appKey: '', name: '', signPublicKey: '', webhookUrl: '', webhookSecret: '', status: 1 })
  editVisible.value = true
}

function openEdit(app: IaApp) {
  editing.value = app
  Object.assign(editForm, {
    appKey: app.appKey, name: app.name, signPublicKey: '', webhookUrl: app.webhookUrl ?? '',
    webhookSecret: '', status: app.status,
  })
  editVisible.value = true
}

async function saveEdit() {
  if (!editForm.name.trim() || (!editing.value && (!editForm.appKey.trim() || !editForm.signPublicKey.trim()))) {
    ElMessage.warning('请填写 appKey、名称与 RSA 公钥(注册必填)')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await store.update(editing.value.id, {
        name: editForm.name,
        webhookUrl: editForm.webhookUrl,
        webhookSecret: editForm.webhookSecret || undefined,
        status: editForm.status,
        // 公钥留空表示不修改;填写即轮换(服务端 PUT 同一端点)
        signPublicKey: editForm.signPublicKey.trim() || undefined,
      })
      ElMessage.success('已保存')
    } else {
      await store.create({
        appKey: editForm.appKey.trim(), name: editForm.name,
        signPublicKey: editForm.signPublicKey.trim(),
        webhookUrl: editForm.webhookUrl || undefined,
        webhookSecret: editForm.webhookSecret || undefined,
      })
      ElMessage.success('应用已注册')
    }
    editVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    saving.value = false
  }
}

// ===== 公钥登记 / 轮换(PUT signPublicKey 同一端点) =====
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

/** 复制公钥指纹(宿主侧比对锚点;优化建议 #10) */
async function copyFingerprint(fp: string) {
  try {
    await navigator.clipboard.writeText(fp)
    ElMessage.success('指纹已复制')
  } catch {
    ElMessage.warning('复制失败,请手动选择复制')
  }
}

async function saveKey() {
  if (!keyApp.value) return
  if (!isValidPemPublicKey(keyPem.value)) {
    ElMessage.warning('请粘贴完整的 RSA PEM 公钥(-----BEGIN PUBLIC KEY----- ... )')
    return
  }
  if (keyMode.value === 'rotate') {
    const confirmed = await ElMessageBox.confirm(
      // 宽限期语义与服务端 V9 迁移同源:ia_app.previous_sign_public_key +
      // sign_key_rotated_at;宽限期 inneragent.auth.embed-key-grace(默认 72h),
      // 验签链见服务端 DbAppSigningKeyProvider(双公钥并存,旧 token 宽限期内仍可用)
      '轮换后新公钥立即生效;旧公钥保留 72 小时验证宽限,期间双公钥并存,存量 embed token 在宽限期内仍可正常验签。请确认新公钥已在宿主侧就绪后再切换签发。继续?',
      '公钥轮换确认',
      { type: 'warning', confirmButtonText: '确认轮换', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false)
    if (!confirmed) return
  }
  keySaving.value = true
  try {
    await store.updateSignKey(keyApp.value.id, keyPem.value.trim())
    ElMessage.success(`公钥已${keyMode.value === 'register' ? '登记' : '轮换'}`)
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
  <IaPageContainer subtitle="宿主应用注册、embed 验签公钥轮换与 Webhook 配置">
    <template #action>
      <!-- 页级操作右置(#19),与行内操作分级 -->
      <el-button type="primary" :icon="Plus" @click="openCreate">注册应用</el-button>
    </template>

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
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id">
        <!-- 空态(#9) -->
        <template #empty>
          <IaEmpty description="还没有应用" hint="注册应用以登记 embed 验签公钥并接入宿主" />
        </template>
        <el-table-column prop="appKey" label="appKey" min-width="140" show-overflow-tooltip />
        <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status as number]" size="small">{{ statusText[row.status as number] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="embed 公钥" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.signPublicKey" type="success" size="small">已登记</el-tag>
            <el-tag v-else type="warning" size="small">未登记</el-tag>
          </template>
        </el-table-column>
        <!-- 密钥指纹(优化建议 #10):等宽前 12 位 + 复制完整指纹;宿主侧比对锚点 -->
        <el-table-column label="密钥指纹" min-width="150">
          <template #default="{ row }">
            <div v-if="row.signKeyFingerprint" class="fp-cell">
              <el-tooltip :content="`完整指纹:${row.signKeyFingerprint}`" placement="top">
                <span class="mono fp">{{ row.signKeyFingerprint.slice(0, 12) }}</span>
              </el-tooltip>
              <el-button text size="small" :icon="CopyDocument" class="fp-copy" @click="copyFingerprint(row.signKeyFingerprint)" />
            </div>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="conversationRetentionDays" label="保留期(天)" width="105" align="right" />
        <el-table-column label="Webhook" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.webhookUrl" class="mono">{{ row.webhookUrl }}</span>
            <span v-else class="dim">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" :icon="Key" @click="openKey(row, row.signPublicKey ? 'rotate' : 'register')">
              {{ row.signPublicKey ? '轮换公钥' : '登记公钥' }}
            </el-button>
            <el-button text type="primary" size="small" :icon="EditPen" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <IaPagination
        v-model:page="store.filters.pageNo"
        v-model:size="store.filters.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="search"
      />
    </el-card>

    <!-- 注册 / 编辑 -->
    <el-dialog
      v-model="editVisible"
      :title="editing ? `编辑应用:${editing.name}` : '注册应用'"
      width="620px"
    >
      <el-form label-width="110px">
        <el-form-item label="appKey" required>
          <el-input v-model="editForm.appKey" :disabled="!!editing" placeholder="唯一键,重复返回 409;创建后不可改" maxlength="64" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editForm.name" maxlength="64" />
        </el-form-item>
        <el-form-item
          label="RSA 公钥"
          :required="!editing"
        >
          <el-input
            v-model="editForm.signPublicKey"
            type="textarea"
            :rows="5"
            class="mono"
            spellcheck="false"
            :placeholder="editing ? '留空表示不修改;填写即轮换验签公钥' : PEM_PLACEHOLDER"
          />
          <div class="form-hint">embed token RS256 验签公钥(X509/PKCS#8 PEM);非法 PEM 服务端返回 400</div>
        </el-form-item>
        <el-form-item label="Webhook 地址">
          <el-input v-model="editForm.webhookUrl" placeholder="终态通知回调地址(可空)" />
        </el-form-item>
        <el-form-item label="Webhook 密钥">
          <el-input v-model="editForm.webhookSecret" type="password" show-password placeholder="HMAC 签名密钥(可空;留空不改)" />
        </el-form-item>
        <el-form-item v-if="editing" label="状态">
          <el-switch v-model="editForm.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
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
      <!-- 宽限期文案与服务端 V9 迁移/DbAppSigningKeyProvider 双公钥语义同源(embed-key-grace 默认 72h) -->
      <el-alert
        v-if="keyMode === 'rotate'"
        type="warning"
        :closable="false"
        show-icon
        class="rotate-alert"
        title="轮换后新公钥立即生效;旧公钥保留 72 小时验证宽限,期间双公钥并存,存量 embed token 在宽限期内仍可正常验签。"
      />
      <el-form label-width="90px">
        <el-form-item v-if="keyMode === 'rotate' && (keyApp?.signKeyFingerprint || keyApp?.signKeyRotatedAt)" label="当前指纹">
          <div class="fp-detail">
            <span class="mono">{{ keyApp?.signKeyFingerprint ?? '—' }}</span>
            <span class="form-hint">
              最近轮换:{{ keyApp?.signKeyRotatedAt ?? '从未轮换(登记后未更换)' }}
              · 轮换后旧公钥保留 72 小时验证宽限(V9 双公钥并存)
            </span>
          </div>
        </el-form-item>
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
  </IaPageContainer>
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
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
.fp-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}
.fp {
  color: #606266;
}
.fp-copy {
  padding: 4px;
}
.fp-detail {
  width: 100%;
}
.fp-detail .form-hint {
  margin-top: 2px;
}
.dim {
  color: #c0c4cc;
}
.form-hint {
  color: #909399;
  font-size: 12px;
  width: 100%;
  margin-top: 4px;
}
.rotate-alert {
  margin-bottom: 12px;
}
</style>
