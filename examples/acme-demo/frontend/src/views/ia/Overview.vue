<script setup lang="ts">
/**
 * InnerAgent 接入总览(docs/接入指南.md 五步路径)。
 * 实时拉取后端公开配置与管理面开通状态,直观验证「开通没/可达没/公钥登记没」;
 * 并给出「接入指南章节 ↔ 本 DEMO 代码位置」映射表(范式沿用原 acme README)。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSection, FcSectionHeader, FcTag } from '@/components/sdk'
import { demoApi, type DemoConfig } from '@/api/demo'
import { fetchIaServerStatus, type IaServerStatus } from '@/api/ia'

defineOptions({ name: 'IaOverview' })

const { t } = useI18n()
const router = useRouter()

const config = ref<DemoConfig | null>(null)
const serverStatus = ref<IaServerStatus | null>(null)

const steps = computed(() => [
  { key: 'step-1', done: true },
  { key: 'step-2', done: !!config.value },
  { key: 'step-3', done: serverStatus.value?.state === 'registered' },
  { key: 'step-4', done: serverStatus.value?.state === 'registered' },
  { key: 'step-5', done: true },
])

const stateTagType = computed(() => {
  switch (serverStatus.value?.state) {
    case 'registered': return 'success'
    case 'not_registered': return 'warning'
    case 'admin_key_missing': return 'info'
    default: return 'danger'
  }
})

/**
 * 中台能力 ↔ DEMO 体验入口(2026-09-22 能力覆盖盘点定稿)。
 * 验收口径:每项中台能力要么有可体验入口,要么标注「内核保障(E2E/IT 覆盖)」;
 * 管理台 12 页(应用/工具/定义/MCP/Skill/KB/用量/反馈/审计/模型/熔断/webhook)
 * 由 /ia/admin iframe 整站覆盖,已逐页截图验证(test-report/2026-09-22-02)。
 */
const coverageRows: { cap: string; to?: string; entry: string; note: string }[] = [
  { cap: '对话运行(SSE 流式 · 多会话)', to: '/ia/embed', entry: '嵌入对话(深链 ?agentType= 选场景)', note: 'MiniMax-M3 真模型;Enter=换行,点「发送」' },
  { cap: '写操作确认流(WRITE 工具)', to: '/ia/embed?agentType=ticket-assistant', entry: '工单助手对话:说「帮我建一张工单」', note: '先出确认卡;确认后调用记录落 /ia/tools' },
  { cap: '工具调用记录与事件流', to: '/ia/tools', entry: '工具调用演示页', note: '宿主桥 4 业务工具 + 三方 acme-echo + webhook 事件' },
  { cap: 'MCP 接入(宿主桥 + 三方)', to: '/ia/tools', entry: '/ia/tools + 管理台 · 三方 MCP', note: '业务工具经 @IaTool → /ia-mcp 桥;echo 服务(9401)' },
  { cap: 'Skill(技能包)', to: '/ia/embed?agentType=report-writer', entry: 'report-writer 对话触发技能', note: 'zip 上传 / 激活 / 停用在 管理台 · Skill 管理' },
  { cap: '知识库(KB 引用)', to: '/ia/embed?agentType=knowledge-qa', entry: 'knowledge-qa 对话', note: '回答带 [KB:…] 引用标记;管理台 · 知识库 3 篇 21 分块' },
  { cap: '子 Agent(2 层)', to: '/ia/embed?agentType=master-demo', entry: 'master-demo / ops-analyst 对话', note: '级联取消语义由内核 IT 覆盖' },
  { cap: '嵌入双模式(WC 直挂 / iframe postMessage)', to: '/ia/embed', entry: '嵌入演示页切换挂载模式', note: 'tokenGetter 懒换单飞;iframe 握手 origin 校验' },
  { cap: 'embed token 签发 / claims 可视化', to: '/playground', entry: '体验台 Playground', note: 'RS256;sub=数字用户 ID;exp 12h;tenantId 可传(多租户)' },
  { cap: '管理台整站(iframe 嵌入)', to: '/ia/admin', entry: 'InnerAgent 管理台(独立管理员登录)', note: '不做 SSO;默认落定义页;12 页逐页验证通过' },
  { cap: '多应用 / 公钥轮换 / webhook 配置', to: '/ia/admin', entry: '管理台 · 应用管理', note: '全局视角(acme-demo 行在列)' },
  { cap: '工具授权 grants(代授 / 撤销)', to: '/ia/admin', entry: '管理台 · 工具注册与授权 →「用户授权」Tab', note: '失效记录含原因(工具停用 / schema 安全相关)' },
  { cap: '模型管理与连通性', to: '/ia/admin', entry: '管理台 · 模型配置', note: 'MiniMax-M3(anthropic 协议)' },
  { cap: '用量统计', to: '/ia/admin', entry: '管理台 · 用量统计', note: '调用次数 / tokens 聚合;appId 由服务端按缺省应用行级注入' },
  { cap: '用户反馈', to: '/ia/admin', entry: '对话里点 👍/👎 → 管理台 · 用户反馈', note: '好评率 / 带反馈完成率(口径见页面说明卡)' },
  { cap: '审计检索', to: '/ia/admin', entry: '管理台 · 审计查询', note: '读时脱敏' },
  { cap: '熔断 / 紧急停用 / 资源上限', to: '/ia/admin', entry: '管理台 · 熔断与紧急停用', note: '应用级总开关 + 单运行终止 + limits 表单' },
  { cap: 'Webhook 投递(HMAC · 退避重试)', to: '/ia/tools', entry: '/ia/tools 事件流 + 管理台 · Webhook', note: '状态过滤与失败重投(redeliver)' },
  { cap: 'SSE 断点续传(Last-Event-ID)', entry: '—', note: '内核保障(E2E / IT 覆盖),无独立演示 UI' },
]

async function load() {
  try {
    config.value = await demoApi.config()
  } catch {
    return
  }
  serverStatus.value = await fetchIaServerStatus().catch(() => null)
}

onMounted(load)
</script>

<template>
  <div class="ia-overview">
    <FcSection>
      <FcSectionHeader :title="t('ia.overview.title')" :subtitle="t('ia.overview.subtitle')" />

      <div class="steps">
        <div v-for="s in steps" :key="s.key" class="step-card" data-testid="overview-step">
          <div class="step-head">
            <span class="step-title">{{ t(`ia.overview.${s.key}`) }}</span>
            <FcTag :type="s.done ? 'success' : 'info'">{{ s.done ? '✓' : '…' }}</FcTag>
          </div>
          <p class="step-desc">{{ t(`ia.overview.${s.key}-desc`) }}</p>
        </div>
      </div>

      <div class="actions">
        <FcButton type="primary" @click="router.push('/ia/embed')">
          {{ t('ia.overview.go-embed') }}
        </FcButton>
        <FcButton @click="router.push('/ia/tools')">
          {{ t('ia.overview.go-tools') }}
        </FcButton>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader :title="t('ia.overview.status-title')" :subtitle="config?.inneragentBaseUrl">
        <template #extra>
          <FcTag :type="stateTagType" data-testid="server-state">
            {{ t(`ia.overview.state-${serverStatus?.state ?? 'unreachable'}`) }}
          </FcTag>
        </template>
      </FcSectionHeader>
      <div class="status">
        <div class="status-row">
          <span class="k">appKey</span>
          <code>{{ config?.appKey || '—' }}</code>
        </div>
        <div class="status-row">
          <span class="k">agentType</span>
          <code>{{ config?.agentType || '—' }}</code>
        </div>
        <div class="status-row">
          <span class="k">{{ t('ia.overview.field-fingerprint') }}</span>
          <code>{{ serverStatus?.signKeyFingerprint || '—' }}</code>
        </div>
        <p class="status-hint">{{ t('ia.overview.state-hint') }}</p>
      </div>
    </FcSection>

    <FcSection>
      <FcSectionHeader :title="t('ia.overview.mapping-title')" :subtitle="t('ia.overview.mapping-subtitle')" />
      <table class="mapping" data-testid="mapping-table">
        <thead>
          <tr>
            <th>{{ t('ia.overview.col-guide') }}</th>
            <th>{{ t('ia.overview.col-code') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in [
            { guide: '§2-①/③ 引依赖 + yaml 桥配置', code: 'backend/pom.xml + backend/src/main/resources/application.yml(inneragent.bridge.*)' },
            { guide: '§2-② 写工具 @IaTool', code: 'backend/.../tool/AcmeTicketTools.java(create_ticket/list_tickets/resolve_scope)' },
            { guide: '§2-④ 管理面注册应用/工具', code: 'backend/.../ia/InnerAgentAdminClient.java(一次性开通封装+状态自检)' },
            { guide: '§2-⑤/§4.1 签发 embed token', code: 'backend/.../ia/EmbedTokenSigner.java + web/EmbedTokenController.java;frontend src/ia/innerAgentBridge.ts(tokenGetter 缓存+临期重签)' },
            { guide: '§4.2 act token(宿主桥内环)', code: 'starter 自动装配(X-IA-Act Filter + /ia-mcp);yaml act.audiences 对齐 endpointUrl' },
            { guide: '前端 SDK 嵌入(WC 直挂)', code: 'frontend/src/views/ia/EmbedChat.vue(mode=wc)+ src/vendor/inneragent/inneragent-chat.js' },
            { guide: 'iframe postMessage 模式(token 不入 URL)', code: 'frontend/src/vendor/inneragent/iframe-host.js + public/ia/{iframe-child.js,frame.html,frame.js};EmbedChat.vue(mode=iframe)' },
            { guide: '§6.3 Webhook 订阅与验签', code: 'backend/.../ia/IaWebhookVerifier.java + web/WebhookController.java;ToolsBoard.vue 事件流' },
          ]" :key="row.guide">
            <td>{{ row.guide }}</td>
            <td><code>{{ row.code }}</code></td>
          </tr>
        </tbody>
      </table>
    </FcSection>
    <FcSection>
      <FcSectionHeader :title="t('ia.overview.coverage-title')" :subtitle="t('ia.overview.coverage-subtitle')" />
      <table class="mapping cov" data-testid="capability-coverage">
        <thead>
          <tr>
            <th>{{ t('ia.overview.col-capability') }}</th>
            <th>{{ t('ia.overview.col-entry') }}</th>
            <th>{{ t('ia.overview.col-note') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in coverageRows" :key="row.cap" data-testid="coverage-row">
            <td>{{ row.cap }}</td>
            <td>
              <RouterLink v-if="row.to" :to="row.to" data-testid="coverage-link">{{ row.entry }}</RouterLink>
              <span v-else>{{ row.entry }}</span>
            </td>
            <td>{{ row.note }}</td>
          </tr>
        </tbody>
      </table>
    </FcSection>
  </div>
</template>

<style scoped lang="scss">
.ia-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.step-card {
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
}

.step-desc {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-row {
  display: flex;
  align-items: baseline;
  gap: 12px;

  .k {
    flex-shrink: 0;
    width: 150px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  code {
    font-size: 12px;
  }
}

.status-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.mapping {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    text-align: left;
    vertical-align: top;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 600;
  }

  td:first-child {
    width: 40%;
    white-space: pre-wrap;
  }

  a {
    color: var(--el-color-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &.cov {
    td:nth-child(1) {
      width: 24%;
    }

    td:nth-child(2) {
      width: 34%;
    }
  }
}
</style>
