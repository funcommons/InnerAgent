<script setup lang="ts">
/**
 * [new] 定义详情抽屉(P2-W5 提示词编辑落点):规格 spec 摘要 + 提示词三槽
 * (systemPrompt/instructionTemplate/greeting)只读展示、按 slot 分「编辑」
 * 入口(单槽 PUT /{id}/prompt)。systemPrompt 非空(服务端强制)、65536 上限;
 * 编辑落审计:旧值快照进 ia_audit_log(decision=definition-updated,source=admin)。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit } from '@element-plus/icons-vue'
import { apiErrorMessage } from '@/stores/apps'
import { useDefinitionsStore, PROMPT_SLOT_META, DEFINITION_KIND_META } from '@/stores/definitions'
import type { DefinitionPromptSlot, IaAgentDefinition } from '@/api/types'

/** 提示词单槽长度上限(镜像 AgentDefinitionAdminService.MAX_PROMPT_LENGTH) */
const MAX_PROMPT_LENGTH = 65_536

const props = defineProps<{ definitionId: number | null }>()
const visible = defineModel<boolean>('visible', { required: true })

const store = useDefinitionsStore()
const row = ref<IaAgentDefinition | null>(null)
const loading = ref(false)
/** 当前编辑中的 slot(null=无)+ 草稿内容 */
const editingSlot = ref<DefinitionPromptSlot | null>(null)
const draft = ref('')
const saving = ref(false)

watch(visible, (open) => {
  if (open && props.definitionId !== null) void load(props.definitionId)
  if (!open) editingSlot.value = null
})

async function load(id: number) {
  loading.value = true
  try {
    row.value = await store.get(id)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '定义详情加载失败'))
  } finally {
    loading.value = false
  }
}

function contentOf(slot: DefinitionPromptSlot): string {
  return row.value?.prompts[slot] ?? ''
}

function startEdit(slot: DefinitionPromptSlot) {
  editingSlot.value = slot
  draft.value = contentOf(slot)
}

function cancelEdit() {
  editingSlot.value = null
  draft.value = ''
}

async function saveEdit(slot: DefinitionPromptSlot) {
  if (!row.value) return
  const meta = PROMPT_SLOT_META.find(m => m.slot === slot)!
  if (meta.required && !draft.value.trim()) {
    ElMessage.warning('systemPrompt 不能为空白(定义不可无系统提示词)')
    return
  }
  if (draft.value.length > MAX_PROMPT_LENGTH) {
    ElMessage.warning(`提示词超过长度上限 ${MAX_PROMPT_LENGTH} 字符:当前 ${draft.value.length}`)
    return
  }
  saving.value = true
  try {
    row.value = await store.updatePrompt(row.value.id, slot, draft.value)
    editingSlot.value = null
    ElMessage.success(`已保存 ${meta.label};旧值快照已留痕审计(definition-updated · admin)`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '提示词保存失败'))
  } finally {
    saving.value = false
  }
}

const specRows = computed(() => {
  const spec = (row.value?.spec ?? {}) as Record<string, unknown>
  return [
    { label: 'kind', value: String(spec.kind ?? row.value?.kind ?? '—') },
    { label: 'enabled', value: String(spec.enabled ?? row.value?.enabled ?? '—') },
    { label: 'modelId', value: spec.modelId === undefined || spec.modelId === null ? '—(未指定)' : String(spec.modelId) },
    { label: 'toolWhitelist', value: Array.isArray(spec.toolWhitelist) ? spec.toolWhitelist.join(', ') : '—' },
    { label: 'subAgentTools', value: Array.isArray(spec.subAgentTools) ? JSON.stringify(spec.subAgentTools) : '—' },
    { label: 'contextTemplate', value: spec.contextTemplate ? JSON.stringify(spec.contextTemplate) : '—' },
  ]
})
</script>

<template>
  <el-drawer v-model="visible" :title="`定义详情:${row?.agentType ?? ''}`" size="620px">
    <div v-loading="loading">
      <template v-if="row">
        <el-descriptions :column="2" border size="small" class="head-desc">
          <el-descriptions-item label="agentType"><span class="mono">{{ row.agentType }}</span></el-descriptions-item>
          <el-descriptions-item label="显示名">{{ row.name }}</el-descriptions-item>
          <el-descriptions-item label="kind">
            <el-tag :type="DEFINITION_KIND_META[row.kind]?.tag ?? 'info'" size="small">
              {{ DEFINITION_KIND_META[row.kind]?.label ?? row.kind }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="enabled">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          type="info" :closable="false" show-icon class="audit-alert"
          title="编辑留痕:保存后旧值快照进审计入参(ia_audit_log 仅追加,decision=definition-updated · source=admin);运行内核当前仍读代码注册表,数据驱动切换属后续批次。"
        />

        <!-- 规格 spec(与 bundle specJson 同构;未知字段原样保留) -->
        <div class="section-title">规格 spec</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item v-for="s in specRows" :key="s.label" :label="s.label">
            <span :class="{ mono: s.label !== 'kind' && s.label !== 'enabled' }">{{ s.value }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 提示词三槽:只读展示 + 按 slot 分编辑入口 -->
        <div class="section-title">提示词三槽</div>
        <div v-for="meta in PROMPT_SLOT_META" :key="meta.slot" class="slot-card">
          <div class="slot-head">
            <span class="slot-label">{{ meta.label }}</span>
            <el-tag v-if="meta.required" size="small" type="danger" effect="plain">必填</el-tag>
            <span class="slot-len">{{ contentOf(meta.slot).length }} 字符</span>
            <el-button
              v-if="editingSlot !== meta.slot"
              text type="primary" size="small" :icon="Edit"
              @click="startEdit(meta.slot)"
            >编辑</el-button>
          </div>
          <p class="slot-hint">{{ meta.hint }}</p>
          <template v-if="editingSlot === meta.slot">
            <el-input
              v-model="draft"
              type="textarea"
              :rows="8"
              :maxlength="MAX_PROMPT_LENGTH"
              show-word-limit
              class="mono"
              spellcheck="false"
            />
            <div class="slot-actions">
              <el-button size="small" @click="cancelEdit">取消</el-button>
              <el-button type="primary" size="small" :loading="saving" @click="saveEdit(meta.slot)">保存</el-button>
            </div>
          </template>
          <pre v-else class="slot-pre">{{ contentOf(meta.slot) || '(未配置)' }}</pre>
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.head-desc { margin-bottom: 12px; }
.audit-alert { margin-bottom: 12px; }
.section-title { font-weight: 600; font-size: 13px; margin: 14px 0 8px; }
.slot-card { border: 1px solid #e4e7ed; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.slot-head { display: flex; align-items: center; gap: 8px; }
.slot-label { font-weight: 600; font-size: 13px; }
.slot-len { color: #909399; font-size: 12px; }
.slot-len { margin-left: auto; }
.slot-head .el-button { margin-left: 8px; }
.slot-head .slot-len + .el-button { margin-left: 0; }
.slot-hint { color: #909399; font-size: 12px; margin: 4px 0 8px; }
.slot-pre {
  margin: 0;
  background: #fafafa;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow: auto;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.slot-actions { margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px; }
</style>
