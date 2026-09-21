<script setup lang="ts">
/**
 * /ia/agents 场景画廊:5 张场景卡(名称 / 一句场景 / 能力 chips / 演示剧本折叠 /
 * 「开始对话」→ EmbedChat 带 agentType)+ 能力×场景矩阵表。
 *
 * 场景契约见 src/ia/demoAgents.ts(agentType 拼写与能力勾叉对齐 seeds/agent-bundle.json);
 * 展示文案在 i18n ia.demo.*(zh/en),剧本步骤为数组经 tm() 渲染。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSection, FcSectionHeader, FcTag } from '@/components/sdk'
import {
  DEMO_AGENTS,
  DEMO_CAPABILITIES,
  hasCapability,
  type DemoAgentType,
  type DemoCapabilityId,
} from '@/ia/demoAgents'

defineOptions({ name: 'IaAgentsGallery' })

const { t, tm } = useI18n()
const router = useRouter()

/** 剧本折叠状态(agentType → 展开?) */
const expanded = ref<Record<string, boolean>>({})

function toggleScript(agentType: string): void {
  expanded.value[agentType] = !expanded.value[agentType]
}

/** i18n 剧本步骤数组(tm 原始数组;兼容字符串与编译 AST 节点两种形态) */
function scriptSteps(agentType: string): string[] {
  const raw = tm(`ia.demo.agents.${agentType}.script`) as unknown
  if (!Array.isArray(raw)) return []
  return raw.map((item) =>
    typeof item === 'string' ? item : String((item as { value?: unknown }).value ?? ''))
}

function startChat(agentType: DemoAgentType): void {
  void router.push({ path: '/ia/embed', query: { agentType } })
}

/** 矩阵单元格测试锚(capability × agentType) */
function cellTestid(capability: DemoCapabilityId, agentType: string): string {
  return `matrix-${capability}-${agentType}`
}
</script>

<template>
  <div class="ia-agents">
    <!-- 开通提示条:未配置时不遮蔽页面(纯 info 展示,不拦截) -->
    <div class="provision-hint" data-testid="provision-hint">
      <i class="ri-information-line" aria-hidden="true" />
      <span>{{ t('ia.demo.provision-hint') }}</span>
      <code>{{ t('ia.demo.provision-cmd') }}</code>
    </div>

    <FcSection>
      <FcSectionHeader :title="t('ia.demo.title')" :subtitle="t('ia.demo.subtitle')" />

      <div class="cards">
        <article
          v-for="a in DEMO_AGENTS"
          :key="a.agentType"
          class="card"
          :data-testid="`agent-card-${a.agentType}`"
        >
          <header class="card-head">
            <h3>{{ t(`ia.demo.agents.${a.agentType}.name`) }}</h3>
            <code class="card-type">{{ a.agentType }}</code>
          </header>
          <p class="card-tagline">{{ t(`ia.demo.agents.${a.agentType}.tagline`) }}</p>

          <div class="card-chips" data-testid="agent-chips">
            <FcTag v-for="c in a.capabilities" :key="c" size="sm">
              {{ t(`ia.demo.capability.${c}`) }}
            </FcTag>
          </div>

          <!-- 演示剧本折叠 -->
          <div class="card-script">
            <button
              type="button"
              class="script-toggle"
              :data-testid="`script-toggle-${a.agentType}`"
              :aria-expanded="!!expanded[a.agentType]"
              @click="toggleScript(a.agentType)"
            >
              <i :class="expanded[a.agentType] ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'" aria-hidden="true" />
              {{ t('ia.demo.script-title') }}
            </button>
            <ol v-show="expanded[a.agentType]" class="script-steps" :data-testid="`script-steps-${a.agentType}`">
              <li v-for="(step, i) in scriptSteps(a.agentType)" :key="i">{{ step }}</li>
            </ol>
          </div>

          <footer class="card-actions">
            <FcButton
              type="primary"
              size="sm"
              :data-testid="`start-chat-${a.agentType}`"
              @click="startChat(a.agentType)"
            >
              <i class="ri-chat-smile-2-line" aria-hidden="true" />
              {{ t('ia.demo.start-chat') }}
            </FcButton>
            <router-link class="doc-link" :to="`/docs/${a.docSectionId}`" :data-testid="`doc-link-${a.agentType}`">
              {{ t('ia.demo.doc-link') }}
              <i class="ri-book-open-line" aria-hidden="true" />
            </router-link>
          </footer>
        </article>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader
        :title="t('ia.demo.capability-title')"
        :subtitle="t('ia.demo.capability-subtitle')"
      />
      <table class="matrix" data-testid="capability-matrix">
        <thead>
          <tr>
            <th>{{ t('ia.demo.col-scenario') }}</th>
            <th v-for="a in DEMO_AGENTS" :key="a.agentType" scope="col">
              {{ t(`ia.demo.agents.${a.agentType}.name`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cap in DEMO_CAPABILITIES" :key="cap">
            <th scope="row">{{ t(`ia.demo.capability.${cap}`) }}</th>
            <td
              v-for="a in DEMO_AGENTS"
              :key="a.agentType"
              :class="hasCapability(a.agentType, cap) ? 'yes' : 'no'"
              :data-testid="cellTestid(cap, a.agentType)"
            >
              {{ hasCapability(a.agentType, cap) ? t('ia.demo.check') : t('ia.demo.cross') }}
            </td>
          </tr>
        </tbody>
      </table>
    </FcSection>
  </div>
</template>

<style scoped lang="scss">
.ia-agents {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.provision-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 8px;

  > i {
    font-size: 17px;
  }

  code {
    padding: 3px 8px;
    font-size: 12px;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
    border-radius: 6px;
  }
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }

  .card-type {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    padding: 2px 8px;
    border-radius: 999px;
  }
}

.card-tagline {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
}

.card-script {
  margin-top: 12px;
}

.script-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  background: none;
  border: 0;
  cursor: pointer;

  i {
    font-size: 17px;
  }
}

.script-steps {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);

  li + li {
    margin-top: 4px;
  }
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
}

.doc-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-decoration: none;

  &:hover {
    color: var(--el-color-primary);
  }
}

.matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th,
  td {
    padding: 9px 12px;
    border: 1px solid var(--el-border-color-lighter);
    text-align: center;
  }

  thead th {
    background: var(--el-fill-color-light);
    font-weight: 600;
  }

  tbody th {
    text-align: left;
    font-weight: 600;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  td.yes {
    color: var(--el-color-success);
    font-weight: 700;
  }

  td.no {
    color: var(--el-text-color-placeholder);
  }
}
</style>
