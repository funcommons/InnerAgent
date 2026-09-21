<script setup lang="ts">
/**
 * [new] 知识库管理视图(P4-W14,视图清单 #10;AdminKbController)。
 * 文档列表(title/source/status/chunk_count)+ 文本导入(标题+内容+分块参数,
 * 服务端分块)+ 状态门控(active/inactive,失效不参与检索)+ rebuild-index +
 * 检索调试小工具(输入查询 → top-k 命中与来源,含检索配置/降级标记)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import IaListPage from '@/components/IaListPage.vue'
import { apiErrorMessage } from '@/stores/apps'
import { useKbStore } from '@/stores/kb'
import type { IaKbDocument } from '@/api/types'

const store = useKbStore()

onMounted(() => {
  void store.load()
})

// ===== 文本导入(标题+内容+分块参数;上限 1000 超限 409 提示拆库) =====
const importVisible = ref(false)
const importing = ref(false)
const importForm = reactive({
  title: '',
  source: '',
  content: '',
  metadata: '',
  useCustomChunk: false,
  chunkSize: 500,
  chunkOverlap: 50,
})

function openImport() {
  Object.assign(importForm, {
    title: '', source: '', content: '', metadata: '', useCustomChunk: false, chunkSize: 500, chunkOverlap: 50,
  })
  importVisible.value = true
}

async function submitImport() {
  if (!importForm.title.trim()) {
    ElMessage.warning('文档标题不能为空(检索命中来源展示)')
    return
  }
  if (!importForm.content.trim()) {
    ElMessage.warning('文档内容不能为空')
    return
  }
  if (importForm.metadata.trim()) {
    try {
      const parsed: unknown = JSON.parse(importForm.metadata)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ElMessage.warning('metadata 须为 JSON 对象(如 {"version":"v1"})')
        return
      }
    } catch {
      ElMessage.warning('metadata 不是合法 JSON')
      return
    }
  }
  importing.value = true
  try {
    const doc = await store.importDocument({
      title: importForm.title.trim(),
      source: importForm.source.trim() || undefined,
      content: importForm.content,
      metadata: importForm.metadata.trim() || undefined,
      chunkSize: importForm.useCustomChunk ? importForm.chunkSize : undefined,
      chunkOverlap: importForm.useCustomChunk ? importForm.chunkOverlap : undefined,
    })
    ElMessage.success(`已导入《${doc.title}》:服务端分块 ${doc.chunkCount} 段,已参与检索`)
    importVisible.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '导入失败'))
  } finally {
    importing.value = false
  }
}

// ===== 状态门控 =====
async function setStatus(row: IaKbDocument, active: boolean) {
  if (!active) {
    const confirmed = await ElMessageBox.confirm(
      `失效《${row.title}》?失效文档标黄保留、不参与检索,可随时恢复。`,
      '失效文档',
      { type: 'warning', confirmButtonText: '失效', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false)
    if (!confirmed) return
  }
  try {
    await store.setStatus(row.id, active)
    ElMessage.success(active ? '已恢复参与检索' : '已失效(不参与检索)')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '状态变更失败'))
  }
}

// ===== 重建索引 =====
async function rebuild(row: IaKbDocument) {
  try {
    await store.rebuildIndex(row.id)
    ElMessage.success(`《${row.title}》已按当前检索配置重算索引`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '重建索引失败'))
  }
}

// ===== 删除 =====
async function remove(row: IaKbDocument) {
  const confirmed = await ElMessageBox.confirm(
    `删除《${row.title}》?软删主行并清理全部分段,不可恢复。`,
    '删除文档',
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

// ===== 检索调试小工具 =====
const searchVisible = ref(false)
const searchQuery = ref('')
const searchTopK = ref(5)
const searching = ref(false)

function openSearch() {
  searchVisible.value = true
}

async function runSearch() {
  if (!searchQuery.value.trim()) {
    ElMessage.warning('请输入检索查询')
    return
  }
  searching.value = true
  try {
    const result = await store.searchDebug(searchQuery.value.trim(), searchTopK.value)
    if (result.degraded) {
      ElMessage.warning(`检索配置不可用,已降级 ${result.searchConfig} 兜底(命中 ${result.hits.length} 条)`)
    } else {
      ElMessage.success(`命中 ${result.hits.length} 条(配置 ${result.searchConfig})`)
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '检索调试失败'))
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <IaPageContainer subtitle="mini 知识库:文本导入→服务端分块→tsvector 检索;失效文档不参与检索">
    <template #action>
      <el-button :icon="Search" @click="openSearch">检索调试</el-button>
      <el-button type="primary" :icon="Plus" @click="openImport">导入文档</el-button>
    </template>

    <IaListPage :loading="store.loading">
      <template #filters>
        <div class="toolbar">
          <el-input v-model="store.filters.keyword" class="toolbar__search" placeholder="标题 / 来源" clearable @keyup.enter="store.search()" />
          <el-select v-model="store.filters.status" class="toolbar__select" placeholder="状态" @change="store.search()">
            <el-option label="全部" value="all" />
            <el-option label="生效(active)" value="active" />
            <el-option label="失效(inactive)" value="inactive" />
          </el-select>
          <el-button :icon="Refresh" @click="store.search()">查询</el-button>
          <span class="dim">状态过滤为客户端过滤(服务端无 status 参数)</span>
        </div>
      </template>

      <el-table :data="store.list" row-key="id">
        <template #empty>
          <IaEmpty description="知识库还没有文档" hint="导入文本(如员工手册/FAQ)后即可被 Agent 检索引用">
            <template #action>
              <el-button type="primary" :icon="Plus" @click="openImport">导入第一个文档</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="110">
          <template #default="{ row }">{{ row.source ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.active ? 'success' : 'warning'" size="small">
              {{ row.active ? '生效' : '失效' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="chunkCount" label="分段数" width="90" />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="rebuild(row)">重建索引</el-button>
            <el-button v-if="row.active" text type="warning" size="small" @click="setStatus(row, false)">失效</el-button>
            <el-button v-else text type="success" size="small" @click="setStatus(row, true)">恢复</el-button>
            <el-button text type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <IaPagination
        v-model:page="store.filters.pageNo"
        v-model:size="store.filters.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="store.load()"
      />
    </IaListPage>

    <!-- 文本导入 -->
    <el-dialog v-model="importVisible" title="导入文档(文本)" width="680px">
      <el-alert type="info" :closable="false" show-icon class="mb12"
        title="服务端分块(tsvector 落列):单文档 ≤5MB;单应用文档数上限 1000,超限 409 提示拆库。"
      />
      <el-form label-width="90px">
        <el-form-item label="标题" required>
          <el-input v-model="importForm.title" placeholder="文档名(检索命中来源展示,≤256 字符)" maxlength="256" />
        </el-form-item>
        <el-form-item label="来源标识">
          <el-input v-model="importForm.source" placeholder="upload/api/外部系统等,可空(≤256 字符)" maxlength="256" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input v-model="importForm.content" type="textarea" :rows="8" placeholder="文档文本内容(服务端分块)" />
        </el-form-item>
        <el-form-item label="元数据">
          <el-input v-model="importForm.metadata" class="mono" placeholder='JSON 对象,可空(如 {"version":"v1"})' />
        </el-form-item>
        <el-form-item label="分块参数">
          <el-checkbox v-model="importForm.useCustomChunk">自定义(缺省 500/50)</el-checkbox>
          <div v-if="importForm.useCustomChunk" class="chunk-inputs">
            <el-input-number v-model="importForm.chunkSize" :min="50" :max="4000" />
            <span class="dim">最大长度 /</span>
            <el-input-number v-model="importForm.chunkOverlap" :min="0" :max="1000" />
            <span class="dim">重叠(须小于最大长度)</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">导入</el-button>
      </template>
    </el-dialog>

    <!-- 检索调试小工具 -->
    <el-drawer v-model="searchVisible" title="检索调试" size="620px">
      <div class="search-bar">
        <el-input v-model="searchQuery" placeholder="输入检索查询(Enter 执行)" clearable @keyup.enter="runSearch" />
        <el-input-number v-model="searchTopK" :min="1" :max="50" />
        <el-button type="primary" :loading="searching" :icon="Search" @click="runSearch">检索</el-button>
      </div>
      <el-alert
        v-if="store.lastSearch?.degraded"
        type="warning" :closable="false" show-icon class="mt12"
        :title="`检索配置不可用,当前 ${store.lastSearch.searchConfig} 兜底;恢复后可对文档执行「重建索引」`"
      />
      <el-alert
        v-else-if="store.lastSearch"
        type="info" :closable="false" class="mt12"
        :title="`检索配置:${store.lastSearch.searchConfig} · 命中 ${store.lastSearch.hits.length} 条`"
      />
      <template v-if="store.lastSearch">
        <el-empty v-if="!store.lastSearch.hits.length" description="没有命中(空查询/无生效文档)" />
        <el-card v-for="(hit, i) in store.lastSearch.hits" :key="hit.chunkId" shadow="never" class="hit">
          <div class="hit__head">
            <el-tag size="small" type="primary">TOP {{ i + 1 }}</el-tag>
            <span class="hit__title">{{ hit.documentTitle }}</span>
            <span class="mono dim">#{{ hit.chunkId }} · {{ hit.anchor ?? `seq ${hit.seq}` }}</span>
          </div>
          <p class="hit__content">{{ hit.content }}</p>
        </el-card>
      </template>
      <el-empty v-else description="输入查询后执行检索(不落库,仅调试)" />
    </el-drawer>
  </IaPageContainer>
</template>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar__search { width: 200px; }
.toolbar__select { width: 150px; }
.dim { color: #909399; font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.mb12 { margin-bottom: 12px; }
.mt12 { margin: 12px 0; }
.chunk-inputs { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.search-bar { display: flex; gap: 8px; align-items: center; }
.hit { margin-bottom: 10px; }
.hit__head { display: flex; gap: 8px; align-items: center; }
.hit__title { font-weight: 600; font-size: 13px; }
.hit__content { margin: 8px 0 0; color: #606266; font-size: 13px; line-height: 1.6; }
</style>
