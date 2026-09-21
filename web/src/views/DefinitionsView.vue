<script setup lang="ts">
/**
 * [new] Agent 定义管理视图(P2-W5 定义管理域,视图清单 #7)。
 * 列表(agentType/kind/name/enabled,服务端分页形)+ 详情抽屉(提示词三槽
 * 编辑,旧值快照落审计)+ 导出(选行/全量,下载 bundle JSON)+ 导入(上传/
 * 粘贴 JSON + conflictPolicy + dryRun 预演 → 确认导入,结果表格化)。
 * 导入落审计:definition-imported(新建)/definition-updated(覆盖),source=admin。
 * 数据落 ia_agent_definition;运行内核仍读代码注册表(UI 文案如实说明)。
 */
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Upload, Download } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import DefinitionDetailDrawer from '@/components/DefinitionDetailDrawer.vue'
import DefinitionImportResult from '@/components/DefinitionImportResult.vue'
import { useNarrowViewport } from '@/composables/useNarrowViewport'
import { apiErrorMessage } from '@/stores/apps'
import { useDefinitionsStore, DEFINITION_KIND_META } from '@/stores/definitions'
import type {
  DefinitionConflictPolicy,
  DefinitionImportResult as DefinitionImportResultModel,
  IaAgentDefinition,
} from '@/api/types'

const store = useDefinitionsStore()
const narrow = useNarrowViewport()

onMounted(() => {
  void store.load()
})

// ===== 行选择与导出(选行 → ids;全量 → 无 ids) =====
const selection = ref<IaAgentDefinition[]>([])
const exporting = ref(false)

function handleSelectionChange(rows: IaAgentDefinition[]) {
  selection.value = rows
}

function downloadBundle(json: unknown) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ia-definitions-bundle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function exportSelected() {
  await exportRows(selection.value.map(d => d.id), `已导出选中 ${selection.value.length} 条定义`)
}

async function exportAll() {
  await exportRows(undefined, '已导出全部定义')
}

async function exportRows(ids: number[] | undefined, message: string) {
  exporting.value = true
  try {
    const bundle = await store.exportBundle(ids)
    downloadBundle(bundle)
    ElMessage.success(`${message}(bundle schemaVersion=${bundle.schemaVersion})`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '导出失败'))
  } finally {
    exporting.value = false
  }
}

// ===== 导入(上传/粘贴 JSON + conflictPolicy + dryRun 预演 → 确认导入) =====
const importVisible = ref(false)
const importText = ref('')
const conflictPolicy = ref<DefinitionConflictPolicy>('skip')
const importing = ref(false)
const preview = ref<DefinitionImportResultModel | null>(null)
const imported = ref<DefinitionImportResultModel | null>(null)

function openImport() {
  importText.value = ''
  conflictPolicy.value = 'skip'
  preview.value = null
  imported.value = null
  importVisible.value = true
}

function onFileChange(file: UploadFile) {
  file.raw?.text().then((text) => {
    importText.value = text
    ElMessage.info(`已读取文件 ${file.name}(${text.length} 字符),请先「预演检查」确认影响面`)
  }).catch(() => ElMessage.error('文件读取失败'))
}

function parseBundle(): unknown | null {
  const text = importText.value.trim()
  if (!text) {
    ElMessage.warning('请先粘贴 bundle JSON 或上传导出文件')
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    ElMessage.error('bundle JSON 解析失败:请检查粘贴内容是否完整')
    return null
  }
}

async function runPreview() {
  const bundle = parseBundle()
  if (bundle === null) return
  importing.value = true
  try {
    preview.value = await store.importBundle({ bundle, conflictPolicy: conflictPolicy.value, dryRun: true })
    ElMessage.success('预演完成(零副作用):请核对下方影响面后确认导入')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '预演失败(bundle 级校验不过,未产生任何变更)'))
  } finally {
    importing.value = false
  }
}

async function confirmImport() {
  const bundle = parseBundle()
  if (bundle === null) return
  const confirmed = await ElMessageBox.confirm(
    '按当前冲突策略正式导入?新建/覆盖将逐条落审计(definition-imported / definition-updated · source=admin);此操作不再有二次确认。',
    '确认导入',
    { type: 'warning', confirmButtonText: '正式导入', cancelButtonText: '再看看' },
  ).then(() => true).catch(() => false)
  if (!confirmed) return
  importing.value = true
  try {
    imported.value = await store.importBundle({ bundle, conflictPolicy: conflictPolicy.value, dryRun: false })
    ElMessage.success(`导入完成:新建 ${imported.value.created},覆盖 ${imported.value.updated},跳过 ${imported.value.skipped}`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '导入失败'))
  } finally {
    importing.value = false
  }
}

// ===== 详情抽屉 =====
const detailVisible = ref(false)
const detailId = ref<number | null>(null)

function openDetail(row: IaAgentDefinition) {
  detailId.value = row.id
  detailVisible.value = true
}
</script>

<template>
  <IaPageContainer subtitle="Agent 定义(ia_agent_definition):提示词三槽编辑与导入导出(编辑留痕审计)">
    <template #action>
      <el-button :disabled="!selection.length" :loading="exporting" :icon="Download" @click="exportSelected">
        导出选中{{ selection.length ? `(${selection.length})` : '' }}
      </el-button>
      <el-button :loading="exporting" :icon="Download" @click="exportAll">全量导出</el-button>
      <el-button type="primary" :icon="Upload" @click="openImport">导入</el-button>
    </template>

    <el-card shadow="never">
      <div class="list-toolbar">
        <el-button :icon="Refresh" @click="store.search()">刷新</el-button>
        <span class="dim">导入定位键为 (appId, agentType):跨环境定义 ID 不参与匹配;冲突按策略 skip=保留现库 / overwrite=覆盖。</span>
      </div>
      <el-table
        v-loading="store.loading"
        :data="store.list"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <template #empty>
          <IaEmpty description="还没有 Agent 定义" hint="服务端启动时会把代码注册表定义补种进 ia_agent_definition">
            <template #action>
              <el-button type="primary" :icon="Refresh" @click="store.load()">重新加载</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column type="selection" width="42" />
        <el-table-column prop="agentType" label="agentType" min-width="180" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.agentType }}</span></template>
        </el-table-column>
        <el-table-column prop="name" label="显示名" min-width="170" show-overflow-tooltip />
        <el-table-column label="kind" width="100">
          <template #default="{ row }">
            <el-tag :type="DEFINITION_KIND_META[row.kind]?.tag ?? 'info'" size="small">
              {{ DEFINITION_KIND_META[row.kind]?.label ?? row.kind }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="enabled" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!narrow" label="systemPrompt" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="dim">{{ row.prompts.systemPrompt || '(未配置)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="openDetail(row)">提示词</el-button>
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

    <!-- 详情抽屉:提示词三槽编辑(systemPrompt 只读展示+编辑入口按 slot 分) -->
    <DefinitionDetailDrawer v-model:visible="detailVisible" :definition-id="detailId" />

    <!-- 导入:上传/粘贴 JSON + conflictPolicy + dryRun 预演 → 确认导入 -->
    <el-dialog v-model="importVisible" title="导入定义 bundle" width="680px" top="6vh">
      <el-alert
        type="warning" :closable="false" show-icon class="mb12"
        title="导入将逐条落审计(definition-imported=新建 / definition-updated=覆盖,source=admin);bundle schemaVersion 必须为 1,未知提示词槽位按条目级错误处理。"
      />
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept=".json,application/json"
        :on-change="onFileChange"
        class="upload-hint"
      >
        <el-button :icon="Plus">选择导出文件(.json)</el-button>
      </el-upload>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="8"
        class="mono import-text"
        spellcheck="false"
        placeholder='粘贴 bundle JSON:{"schemaVersion":1,"exportedAt":"…","definitions":[{…}]}'
      />
      <div class="policy-row">
        <span class="policy-label">冲突策略</span>
        <el-radio-group v-model="conflictPolicy">
          <el-radio value="skip">skip(遇冲突保留现库)</el-radio>
          <el-radio value="overwrite">overwrite(按 bundle 覆盖,未出现的槽位/列不动)</el-radio>
        </el-radio-group>
      </div>

      <template v-if="preview">
        <div class="section-title">预演结果(dryRun,零副作用)</div>
        <DefinitionImportResult :result="preview" />
      </template>
      <template v-if="imported">
        <div class="section-title">导入结果</div>
        <DefinitionImportResult :result="imported" />
      </template>

      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button :loading="importing" :icon="Refresh" @click="runPreview">预演检查(dryRun)</el-button>
        <el-button type="primary" :loading="importing" :icon="Upload" @click="confirmImport">确认导入</el-button>
      </template>
    </el-dialog>
  </IaPageContainer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; font-size: 12px; }
.list-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.mb12 { margin-bottom: 12px; }
.upload-hint { margin-bottom: 8px; }
.import-text { margin-bottom: 12px; }
.policy-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.policy-label { font-size: 13px; font-weight: 600; }
.section-title { font-weight: 600; font-size: 13px; margin: 12px 0 8px; }
</style>
