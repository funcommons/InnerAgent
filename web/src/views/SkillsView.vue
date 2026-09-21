<script setup lang="ts">
/**
 * [new] Skill 管理视图(P4-W13,视图清单 #9;AdminSkillController)。
 * 列表(清单 name/displayName/描述/激活态)+ zip 上传导入(先预览 dryRun 展示
 * 校验清单/警告/错误,确认后入库,overwrite 覆盖同名活跃行)+ 激活/停用
 * (应用内同时上限 8,超限 409 友好呈现)+ 删除(逻辑删,同名再导入复活)。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Upload, View } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import SkillPreviewPanel from '@/components/SkillPreviewPanel.vue'
import SkillDetailDrawer from '@/components/SkillDetailDrawer.vue'
import { apiErrorMessage } from '@/stores/apps'
import { useSkillsStore } from '@/stores/skills'
import type { SkillPreviewView } from '@/api/types'

const store = useSkillsStore()

onMounted(() => {
  void store.load()
})

const STATUS_META: Record<string, { label: string; tag: 'success' | 'info' }> = {
  active: { label: '已激活', tag: 'success' },
  inactive: { label: '未激活', tag: 'info' },
}

// ===== 导入:上传 zip → 预览(dryRun)→ 确认入库 =====
const importVisible = ref(false)
const importFile = ref<File | null>(null)
const importFileName = ref('')
const overwrite = ref(false)
const displayName = ref('')
const preview = ref<SkillPreviewView | null>(null)
const importing = ref(false)

/** 预览通过后才可确认;失败清单直接挡住确认按钮 */
const canConfirm = computed(() => Boolean(preview.value?.valid))

function openImport() {
  importFile.value = null
  importFileName.value = ''
  overwrite.value = false
  displayName.value = ''
  preview.value = null
  importVisible.value = true
}

function onFileChange(file: UploadFile) {
  if (!file.raw) return
  importFile.value = file.raw
  importFileName.value = file.name
  preview.value = null
  ElMessage.info(`已选择 ${file.name},请先「预览校验」再确认导入`)
}

async function runPreview() {
  if (!importFile.value) {
    ElMessage.warning('请先选择 Skill zip 包')
    return
  }
  importing.value = true
  try {
    preview.value = await store.preview(importFile.value, importFileName.value)
    if (preview.value.valid) {
      ElMessage.success('预览校验通过(零落库):请核对清单与警告后确认导入')
    } else {
      ElMessage.error(`包校验未通过(${preview.value.errors.length} 项):请修复后重新上传`)
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '预览失败'))
  } finally {
    importing.value = false
  }
}

async function confirmImport() {
  if (!importFile.value || !preview.value?.valid) return
  importing.value = true
  try {
    const row = await store.importSkill({
      file: importFile.value,
      fileName: importFileName.value,
      displayName: displayName.value.trim() || undefined,
      overwrite: overwrite.value,
    })
    ElMessage.success(`已导入 ${row.displayName ?? row.name}(默认未激活,可手动激活进上下文)`)
    importVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '导入失败(服务端已重新校验)'))
  } finally {
    importing.value = false
  }
}

// ===== 激活/停用(上限 8 的 409 由 apiErrorMessage 原样透出服务端文案) =====
async function activate(row: { id: number; name: string; displayName: string | null }) {
  try {
    await store.activate(row.id)
    ElMessage.success(`已激活 ${row.displayName ?? row.name}(激活清单随运行快照固化)`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '激活失败'))
  }
}

async function deactivate(row: { id: number; name: string; displayName: string | null }) {
  try {
    await store.deactivate(row.id)
    ElMessage.success(`已停用 ${row.displayName ?? row.name}(未激活不进上下文)`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '停用失败'))
  }
}

// ===== 删除(逻辑删除;同名再导入按复活处理) =====
async function remove(row: { id: number; name: string; displayName: string | null }) {
  const confirmed = await ElMessageBox.confirm(
    `删除 ${row.displayName ?? row.name}?删除后同名包再导入会按复活处理(历史激活位不复原)。`,
    '删除 Skill',
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

// ===== 详情抽屉(含全部文件内容) =====
const detailVisible = ref(false)
const detailId = ref<number | null>(null)

function openDetail(row: { id: number }) {
  detailId.value = row.id
  detailVisible.value = true
}
</script>

<template>
  <IaPageContainer subtitle="应用 Skill 目录:zip 两段式导入(预览校验 → 确认入库),激活上限 8(超出需先停用)">
    <template #action>
      <el-button :icon="Refresh" @click="store.load()">刷新</el-button>
      <el-button type="primary" :icon="Upload" @click="openImport">导入 Skill</el-button>
    </template>

    <el-card shadow="never">
      <el-table v-loading="store.loading" :data="store.list" row-key="id">
        <template #empty>
          <IaEmpty description="还没有任何 Skill" hint="导入平台包(zip:skill.json 清单 + SKILL.md 正文),激活后进入 Agent 上下文">
            <template #action>
              <el-button type="primary" :icon="Upload" @click="openImport">导入第一个 Skill</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column prop="name" label="清单 name" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.displayName ?? row.name }}</template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="90">
          <template #default="{ row }"><span class="mono dim">{{ row.version ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="激活态" width="96">
          <template #default="{ row }">
            <el-tag :type="STATUS_META[row.status]?.tag ?? 'info'" size="small">
              {{ STATUS_META[row.status]?.label ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容指纹" min-width="140">
          <template #default="{ row }"><span class="mono dim fingerprint">{{ row.contentSha256 }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" :icon="View" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status !== 'active'" text type="success" size="small" @click="activate(row)">激活</el-button>
            <el-button v-else text type="warning" size="small" @click="deactivate(row)">停用</el-button>
            <el-button text type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <IaPagination
        v-model:page="store.pageNo"
        v-model:size="store.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="store.load()"
      />
    </el-card>

    <!-- 导入:上传 → 预览(dryRun)→ 确认 -->
    <el-dialog v-model="importVisible" title="导入 Skill(zip)" width="680px">
      <el-alert type="info" :closable="false" show-icon class="mb12"
        title="两段式:先「预览校验」(dryRun 零落库,返回清单/文件/警告/错误),通过后「确认导入」;服务端入库时会重新校验。"
      />
      <el-form label-width="100px">
        <el-form-item label="Skill 包" required>
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".zip"
            :on-change="onFileChange"
            :on-remove="() => { importFile = null; preview = null }"
          >
            <el-button :icon="Plus">选择 zip 文件</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="显示名覆盖">
          <el-input v-model="displayName" placeholder="留空=使用清单 displayName(≤64 字符)" maxlength="64" />
        </el-form-item>
        <el-form-item label="冲突策略">
          <el-checkbox v-model="overwrite">同名激活行覆盖导入(不勾选则同名激活 409)</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button :loading="importing" :disabled="!importFile" @click="runPreview">预览校验(dryRun)</el-button>
        </el-form-item>
      </el-form>
      <SkillPreviewPanel v-if="preview" :preview="preview" />
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!canConfirm" @click="confirmImport">
          确认导入
        </el-button>
      </template>
    </el-dialog>

    <SkillDetailDrawer v-model:visible="detailVisible" :skill-id="detailId" />
  </IaPageContainer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; }
.fingerprint { font-size: 12px; color: #909399; }
.mb12 { margin-bottom: 12px; }
</style>
