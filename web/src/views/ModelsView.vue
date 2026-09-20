<script setup lang="ts">
/**
 * [adapt] 模型配置视图(视图清单 #5,ia_model_api_config)。
 * 蓝本: $SRC/frontend/src/views/admin/api-config-dialog.vue(522 行)+
 *        $SRC/frontend/src/views/admin/models.vue(列表骨架);
 * 拆除业务依赖: i18n 文案、Fc* 封装组件、图像/视频协议槽、ComfyUI/远程模型拉取对话框;
 * 改造: 密钥掩码显示(apiKeyMasked,编辑留空不改密钥)、五协议平台字典、
 *        连通性测试按钮(ModelConnectivityResult)。
 * 纯逻辑层复用 [adapt] utils/api-config.ts(平台字段/预设/代理校验/掩码)。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Connection, Delete, EditPen } from '@element-plus/icons-vue'
import { useModelsStore } from '@/stores/models'
import { apiErrorMessage } from '@/stores/apps'
import {
  PLATFORM_OPTIONS, API_PROVIDER_PRESETS, getPlatformFields,
  emptyApiConfigForm, apiConfigToForm, buildApiConfigSavePayload,
  isProxyFormInvalid, platformLabel, type ApiConfigFormState,
} from '@/utils/api-config'
import type { IaModelApiConfig } from '@/api/types'

const store = useModelsStore()

onMounted(() => {
  void store.load()
})

function search() {
  void store.search()
}

// ===== 表单 =====
const dialogVisible = ref(false)
const saving = ref(false)
const form = reactive<ApiConfigFormState>(emptyApiConfigForm())
const editingMaskedKey = ref('')

const platformFields = computed(() => getPlatformFields(form.platform))
const proxyInvalid = computed(() => isProxyFormInvalid(form))
const saveInvalid = computed(() => !form.name.trim() || proxyInvalid.value)

function openCreate() {
  Object.assign(form, emptyApiConfigForm())
  editingMaskedKey.value = ''
  dialogVisible.value = true
}

function openEdit(config: IaModelApiConfig) {
  Object.assign(form, apiConfigToForm(config))
  editingMaskedKey.value = config.apiKeyMasked
  dialogVisible.value = true
}

function applyPreset(id: string) {
  const preset = API_PROVIDER_PRESETS.find(p => p.id === id)
  if (!preset) return
  form.platform = preset.platform
  form.apiUrl = preset.url
  form.autoAppendV1Path = preset.platform === 'openai_compatible'
}

async function save() {
  if (saveInvalid.value) {
    ElMessage.warning(proxyInvalid.value ? '代理配置不完整' : '请填写名称')
    return
  }
  saving.value = true
  try {
    const saved = await store.save(buildApiConfigSavePayload(form))
    ElMessage.success(`已保存:${saved.name}(密钥 ${saved.apiKeyMasked || '未设置'})`)
    dialogVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function remove(config: IaModelApiConfig) {
  const confirmed = await ElMessageBox.confirm(
    `删除模型配置「${config.name}」?引用它的 Agent 实例将回退到默认配置。`,
    '删除确认',
    { type: 'warning' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  await store.remove(config.id)
  ElMessage.success('已删除')
}

// ===== 连通性测试 =====
const testingId = ref<number | null>(null)
async function testConnectivity(config: IaModelApiConfig) {
  testingId.value = config.id
  try {
    const result = await store.test(config.id)
    if (result.ok) {
      ElMessage.success(`${result.responseText}(耗时 ${result.durationMs}ms)`)
    } else {
      ElMessage.error(`连通失败:${result.responseText}`)
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '连通性测试失败'))
  } finally {
    testingId.value = null
  }
}

const statusTag: Record<number, 'success' | 'info'> = { 1: 'success', 0: 'info' }
</script>

<template>
  <div class="view">
    <el-card shadow="never" class="toolbar-card">
      <div class="toolbar">
        <el-input v-model="store.filters.name" class="toolbar__name" placeholder="配置名称" clearable @keyup.enter="search" />
        <el-select v-model="store.filters.platform" class="toolbar__platform" placeholder="协议平台" clearable @change="search">
          <el-option v-for="p in PLATFORM_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
        <el-select v-model="store.filters.status" class="toolbar__status" placeholder="状态" clearable @change="search">
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button :icon="Refresh" @click="search">查询</el-button>
        <div class="toolbar__spacer" />
        <el-button type="primary" :icon="Plus" @click="openCreate">新建 API 配置</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id">
        <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <el-table-column label="协议平台" min-width="150">
          <template #default="{ row }">{{ platformLabel(row.platform) }}</template>
        </el-table-column>
        <el-table-column prop="apiUrl" label="API 地址" min-width="220" show-overflow-tooltip />
        <el-table-column label="密钥" min-width="130">
          <template #default="{ row }">
            <span v-if="row.apiKeyMasked" class="mono">{{ row.apiKeyMasked }}</span>
            <span v-else class="dim">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status as number]" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" :icon="Connection" :loading="testingId === row.id" @click="testConnectivity(row)">测试</el-button>
            <el-button text type="primary" size="small" :icon="EditPen" @click="openEdit(row)">编辑</el-button>
            <el-button text type="danger" size="small" :icon="Delete" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="store.filters.pageNo"
        v-model:page-size="store.filters.pageSize"
        class="pager" layout="total, sizes, prev, pager, next"
        :total="store.total" :page-sizes="[10, 20, 50]"
        @current-change="store.load()" @size-change="search"
      />
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? `编辑 API 配置:${form.name}` : '新建 API 配置'"
      width="680px"
    >
      <el-form label-width="130px">
        <el-form-item label="配置名称" required>
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="协议平台">
          <el-select v-model="form.platform" @change="form.apiUrl = ''">
            <el-option v-for="p in PLATFORM_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
            <div class="platform-desc">{{ PLATFORM_OPTIONS.find(p => p.value === form.platform)?.description }}</div>
          </el-select>
        </el-form-item>
        <el-form-item label="常用提供商">
          <div class="presets">
            <el-tag
              v-for="p in API_PROVIDER_PRESETS" :key="p.id"
              class="preset" :type="form.apiUrl === p.url ? 'primary' : 'info'"
              effect="plain" @click="applyPreset(p.id)"
            >
              {{ p.label }}
            </el-tag>
          </div>
        </el-form-item>
        <!-- 平台动态字段(文本协议槽;图像/视频协议已随业务剥离) -->
        <el-form-item
          v-for="field in platformFields"
          :key="field.key"
          :label="field.label"
          :required="field.required"
        >
          <el-input
            v-if="field.key === 'apiKey'"
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="form.id && editingMaskedKey ? `已设置(${editingMaskedKey}),留空表示不修改` : field.placeholder"
            autocomplete="new-password"
          />
          <el-input
            v-else
            v-model="form.apiUrl"
            :placeholder="field.placeholder"
          />
          <div v-if="field.helper" class="form-hint">{{ field.helper }}</div>
        </el-form-item>
        <el-form-item v-if="form.platform === 'openai_compatible'" label="自动补充 /v1">
          <el-switch v-model="form.autoAppendV1Path" />
          <div class="form-hint">仅填到域名时自动补全 /v1/chat/completions 路径</div>
        </el-form-item>
        <el-form-item label="出站代理">
          <el-select v-model="form.proxyType" class="proxy-select">
            <el-option label="不使用代理" value="none" />
            <el-option label="HTTP 代理" value="http" />
            <el-option label="SOCKS5 代理" value="socks5" />
          </el-select>
          <div v-if="form.proxyType !== 'none'" class="proxy-grid">
            <el-input v-model="form.proxyHost" placeholder="代理主机" />
            <el-input-number v-model="form.proxyPort" :min="1" :max="65535" placeholder="端口" controls-position="right" />
            <el-input v-model="form.proxyUsername" placeholder="用户名(可选)" />
            <el-input v-model="form.proxyPassword" type="password" show-password placeholder="密码(可选)" />
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="saveInvalid" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.view { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar__name { width: 180px; }
.toolbar__platform { width: 200px; }
.toolbar__status { width: 100px; }
.toolbar__spacer { flex: 1; }
.pager { margin-top: 12px; justify-content: flex-end; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #c0c4cc; }
.presets { display: flex; gap: 8px; flex-wrap: wrap; }
.preset { cursor: pointer; }
.platform-desc { color: #909399; font-size: 12px; padding: 0 12px; }
.form-hint { color: #909399; font-size: 12px; margin-top: 4px; width: 100%; }
.proxy-select { width: 180px; }
.proxy-grid { display: grid; grid-template-columns: 1fr 130px; gap: 8px; margin-top: 8px; width: 100%; }
</style>
