<script setup lang="ts">
/**
 * Agent 管理(/ia/agent-admin):创建 / 管理 / 配置 InnerAgent Agent 定义。
 *
 * 演示「宿主应用即管理入口」:前端只持演示登录态,管理面密钥留在宿主后端。
 * - 列表:管理面 definitions API(宿主后端代理);
 * - 创建/配置:单定义 bundle 走 import(overwrite)通道,保存即生效
 *   (内核数据驱动解析,运行时 DB 优先);
 * - 模型/工具/子 Agent 下拉:后端聚合(工具注册表 + 用户面对话模型 + 定义)。
 * 与「嵌入演示」页联动:这里改完人设/工具,嵌入聊天立刻按新配置对话。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  FcButton,
  FcDrawer,
  FcSection,
  FcSectionHeader,
  FcSelect,
  FcSwitch,
  toast,
} from '@/components/sdk'
import type { SelectOption } from '@/components/sdk'
import {
  fetchAgentDefinitions,
  fetchAgentOptions,
  saveAgentDefinition,
  type IaAgentDefinitionRow,
  type IaAgentOptions,
  type IaAgentSaveReq,
} from '@/api/ia'

defineOptions({ name: 'IaAgentAdmin' })

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const rows = ref<IaAgentDefinitionRow[]>([])
const options = ref<IaAgentOptions>({ tools: [], models: [], subAgents: [] })

const drawerOpen = ref(false)
const editingId = ref<number | null>(null)

const form = reactive({
  agentType: '',
  name: '',
  kind: 'main',
  enabled: true,
  modelId: null as number | null,
  toolWhitelist: [] as string[],
  subAgentTools: [] as string[],
  systemPrompt: '',
  greeting: '',
})

const kindOptions: SelectOption[] = [
  { label: t('ia.agentAdmin.kind-main'), value: 'main' },
  { label: t('ia.agentAdmin.kind-sub'), value: 'sub' },
]

const modelOptions = computed<SelectOption[]>(() =>
  options.value.models.map((m) => ({
    label: String(m.name ?? m.code ?? m.modelName ?? m.id),
    value: Number(m.id),
  })),
)

const toolOptions = computed<SelectOption[]>(() =>
  options.value.tools.map((tool) => ({
    label: `${String(tool.serverKey ?? '')} / ${String(tool.toolName ?? '')}`,
    value: String(tool.toolName ?? ''),
  })),
)

const subAgentOptions = computed<SelectOption[]>(() =>
  options.value.subAgents.map((sub) => ({ label: sub.name, value: sub.agentType })),
)

const isCreate = computed(() => editingId.value === null)

async function refresh() {
  loading.value = true
  try {
    const [defs, opts] = await Promise.all([fetchAgentDefinitions(), fetchAgentOptions()])
    rows.value = defs
    options.value = opts
  } catch {
    // 错误弹窗由 request.ts 拦截器统一处理
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    agentType: '',
    name: '',
    kind: 'main',
    enabled: true,
    modelId: null,
    toolWhitelist: [],
    subAgentTools: [],
    systemPrompt: '',
    greeting: '',
  })
  drawerOpen.value = true
}

function openEdit(row: IaAgentDefinitionRow) {
  editingId.value = row.id
  Object.assign(form, {
    agentType: row.agentType,
    name: row.name,
    kind: row.kind === 'sub' ? 'sub' : 'main',
    enabled: row.enabled,
    modelId: row.modelId,
    toolWhitelist: [...row.toolWhitelist],
    subAgentTools: [...row.subAgentTools],
    systemPrompt: '',
    greeting: '',
  })
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function submit() {
  if (!form.name.trim() || (isCreate.value && !form.agentType.trim())) return
  if (isCreate.value && !form.systemPrompt.trim()) return
  saving.value = true
  try {
    const req: IaAgentSaveReq = {
      definitionId: editingId.value,
      agentType: form.agentType.trim(),
      name: form.name.trim(),
      kind: form.kind,
      enabled: form.enabled,
      modelId: form.modelId,
      toolWhitelist: form.toolWhitelist,
      subAgentTools: form.kind === 'main' ? form.subAgentTools : [],
      systemPrompt: form.systemPrompt,
      greeting: form.greeting,
    }
    const result = await saveAgentDefinition(req)
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      toast.error(t('ia.agentAdmin.save-errors', { count: result.errors.length }))
    } else {
      toast.success(t(isCreate.value ? 'ia.agentAdmin.create-ok' : 'ia.agentAdmin.update-ok'))
    }
    closeDrawer()
    await refresh()
  } catch {
    // 错误弹窗由 request.ts 拦截器统一处理
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="agent-admin">
    <FcSection>
      <template #header>
        <FcSectionHeader
          :title="t('ia.agentAdmin.title')"
          :subtitle="t('ia.agentAdmin.subtitle')"
        >
          <template #actions>
            <FcButton type="primary" data-testid="agent-admin-create" @click="openCreate">
              {{ t('ia.agentAdmin.create') }}
            </FcButton>
          </template>
        </FcSectionHeader>
      </template>

      <el-table
        v-loading="loading"
        class="fc-table"
        :data="rows"
        row-key="agentType"
        stripe
        data-testid="agent-admin-table"
      >
        <el-table-column label="agentType" prop="agentType" min-width="150" />
        <el-table-column :label="t('ia.agentAdmin.col-name')" prop="name" min-width="140" />
        <el-table-column :label="t('ia.agentAdmin.col-kind')" min-width="90">
          <template #default="{ row }">
            <el-tag :type="row.kind === 'sub' ? 'info' : 'success'" size="small">
              {{ t(row.kind === 'sub' ? 'ia.agentAdmin.kind-sub' : 'ia.agentAdmin.kind-main') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('ia.agentAdmin.col-tools')" min-width="160">
          <template #default="{ row }">
            <span data-testid="agent-admin-tools">{{ row.toolWhitelist.length }}</span>
            <el-tag
              v-for="tool in row.toolWhitelist.slice(0, 2)"
              :key="tool"
              size="small"
              class="agent-admin__tool-tag"
            >
              {{ tool }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('ia.agentAdmin.col-enabled')" min-width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ t(row.enabled ? 'ia.agentAdmin.enabled' : 'ia.agentAdmin.disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('ia.agentAdmin.col-actions')" min-width="90" fixed="right">
          <template #default="{ row }">
            <FcButton
              link
              data-testid="agent-admin-edit"
              @click="openEdit(row as IaAgentDefinitionRow)"
            >
              {{ t('ia.agentAdmin.edit') }}
            </FcButton>
          </template>
        </el-table-column>
      </el-table>

      <p class="agent-admin__hint">{{ t('ia.agentAdmin.hint') }}</p>
    </FcSection>

    <FcDrawer
      :open="drawerOpen"
      :title="t(isCreate ? 'ia.agentAdmin.drawer-create' : 'ia.agentAdmin.drawer-edit')"
      size="480px"
      @update:open="drawerOpen = $event"
    >
      <div class="agent-admin__form" data-testid="agent-admin-form">
        <label class="agent-admin__field">
          <span>agentType</span>
          <el-input
            v-model="form.agentType"
            :disabled="!isCreate"
            :placeholder="t('ia.agentAdmin.ph-agent-type')"
            data-testid="agent-admin-agent-type"
          />
        </label>
        <label class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.col-name') }}</span>
          <el-input v-model="form.name" :placeholder="t('ia.agentAdmin.ph-name')" />
        </label>
        <div class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.col-kind') }}</span>
          <el-radio-group v-model="form.kind" :disabled="!isCreate">
            <el-radio value="main">{{ t('ia.agentAdmin.kind-main') }}</el-radio>
            <el-radio value="sub">{{ t('ia.agentAdmin.kind-sub') }}</el-radio>
          </el-radio-group>
        </div>
        <div class="agent-admin__field agent-admin__field--inline">
          <span>{{ t('ia.agentAdmin.col-enabled') }}</span>
          <FcSwitch v-model="form.enabled" />
        </div>
        <div class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.field-model') }}</span>
          <FcSelect
            v-model="form.modelId"
            :options="modelOptions"
            clearable
            :placeholder="t('ia.agentAdmin.ph-model')"
          />
        </div>
        <div class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.field-tools') }}</span>
          <FcSelect
            v-model="form.toolWhitelist"
            :options="toolOptions"
            multiple
            filterable
            :placeholder="t('ia.agentAdmin.ph-tools')"
          />
        </div>
        <div v-if="form.kind === 'main'" class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.field-sub-agents') }}</span>
          <FcSelect
            v-model="form.subAgentTools"
            :options="subAgentOptions"
            multiple
            :placeholder="t('ia.agentAdmin.ph-sub-agents')"
          />
        </div>
        <label class="agent-admin__field">
          <span>
            {{ t('ia.agentAdmin.field-system-prompt') }}
            <em v-if="!isCreate" class="agent-admin__keep">{{ t('ia.agentAdmin.keep-blank') }}</em>
          </span>
          <el-input
            v-model="form.systemPrompt"
            type="textarea"
            :rows="8"
            :placeholder="t('ia.agentAdmin.ph-system-prompt')"
            data-testid="agent-admin-system-prompt"
          />
        </label>
        <label class="agent-admin__field">
          <span>{{ t('ia.agentAdmin.field-greeting') }}</span>
          <el-input v-model="form.greeting" type="textarea" :rows="2" />
        </label>
        <div class="agent-admin__actions">
          <FcButton data-testid="agent-admin-cancel" @click="closeDrawer">
            {{ t('ia.agentAdmin.cancel') }}
          </FcButton>
          <FcButton
            type="primary"
            :loading="saving"
            data-testid="agent-admin-save"
            @click="submit"
          >
            {{ t('ia.agentAdmin.save') }}
          </FcButton>
        </div>
      </div>
    </FcDrawer>
  </div>
</template>

<style scoped lang="scss">
.agent-admin {
  &__tool-tag {
    margin-left: 4px;
  }

  &__hint {
    margin-top: 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;

    > span {
      color: var(--el-text-color-regular);
    }
  }

  &__field--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  &__keep {
    margin-left: 6px;
    font-style: normal;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
}
</style>
