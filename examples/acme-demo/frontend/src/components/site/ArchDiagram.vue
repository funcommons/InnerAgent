<script setup lang="ts">
/**
 * ArchDiagram — 架构分层一图流(纯内联 SVG,不引外部图片)。
 *
 * 图层(左→右):宿主应用(前端 SDK + 后端 starter 桥) ↔ InnerAgent(运行内核 + 管理面) ↔ 模型服务。
 * 数据流标注真实令牌/协议:embed token(Bearer)、X-IA-Act(60s)、MCP tools/call、模型调用。
 * 文案走 i18n(home.arch.*);颜色走主题 CSS 变量,亮暗主题自动适配。
 */
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'ArchDiagram' })

const { t } = useI18n()
</script>

<template>
  <figure class="arch-diagram" data-testid="arch-diagram">
    <svg viewBox="0 0 900 330" role="img" aria-labelledby="arch-diagram-title" preserveAspectRatio="xMidYMid meet">
      <title id="arch-diagram-title">{{ t('home.arch.title') }}</title>

      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="arch-arrow-head" />
        </marker>
      </defs>

      <!-- ===== 宿主应用外框 ===== -->
      <rect x="14" y="14" width="280" height="302" rx="14" class="arch-box arch-box--host-frame" />
      <text x="154" y="40" text-anchor="middle" class="arch-label arch-label--frame">{{ t('home.arch.host-app') }}</text>

      <!-- 宿主前端 -->
      <rect x="34" y="56" width="240" height="104" rx="10" class="arch-box arch-box--host" />
      <text x="154" y="92" text-anchor="middle" class="arch-title">{{ t('home.arch.host-frontend') }}</text>
      <text x="154" y="116" text-anchor="middle" class="arch-desc">{{ t('home.arch.host-frontend-desc') }}</text>
      <text x="154" y="138" text-anchor="middle" class="arch-desc arch-desc--dim">init({ appKey, tokenGetter })</text>

      <!-- 宿主后端 + starter 桥 -->
      <rect x="34" y="188" width="240" height="104" rx="10" class="arch-box arch-box--host" />
      <text x="154" y="220" text-anchor="middle" class="arch-title">{{ t('home.arch.host-backend') }}</text>
      <text x="154" y="242" text-anchor="middle" class="arch-desc">{{ t('home.arch.host-backend-desc') }}</text>
      <text x="154" y="264" text-anchor="middle" class="arch-desc arch-desc--dim">{{ t('home.arch.bridge') }} · {{ t('home.arch.bridge-desc') }}</text>

      <!-- ===== InnerAgent 服务框 ===== -->
      <rect x="330" y="80" width="250" height="170" rx="14" class="arch-box arch-box--ia" />
      <text x="455" y="112" text-anchor="middle" class="arch-label arch-label--ia">InnerAgent</text>

      <rect x="348" y="126" width="214" height="52" rx="8" class="arch-box arch-box--inner" />
      <text x="455" y="147" text-anchor="middle" class="arch-title">{{ t('home.arch.ia-core') }}</text>
      <text x="455" y="167" text-anchor="middle" class="arch-desc">{{ t('home.arch.ia-core-desc') }}</text>

      <rect x="348" y="188" width="214" height="44" rx="8" class="arch-box arch-box--inner" />
      <text x="455" y="207" text-anchor="middle" class="arch-title">{{ t('home.arch.ia-admin') }}</text>
      <text x="455" y="225" text-anchor="middle" class="arch-desc">{{ t('home.arch.ia-admin-desc') }}</text>

      <!-- ===== 模型服务 ===== -->
      <rect x="656" y="120" width="230" height="90" rx="14" class="arch-box arch-box--model" />
      <text x="771" y="155" text-anchor="middle" class="arch-title">{{ t('home.arch.model') }}</text>
      <text x="771" y="178" text-anchor="middle" class="arch-desc">{{ t('home.arch.model-desc') }}</text>

      <!-- ===== 数据流 ===== -->
      <!-- 宿主前端 → InnerAgent:embed token -->
      <path d="M 274 96 C 306 96, 306 130, 330 138" class="arch-flow" marker-end="url(#arch-arrow)" />
      <text x="312" y="88" text-anchor="middle" class="arch-flow-label">{{ t('home.arch.flow-embed') }}</text>

      <!-- InnerAgent → 宿主后端:X-IA-Act / MCP -->
      <path d="M 330 196 C 306 204, 306 240, 274 240" class="arch-flow arch-flow--act" marker-end="url(#arch-arrow)" />
      <text x="302" y="228" text-anchor="middle" class="arch-flow-label">{{ t('home.arch.flow-act') }}</text>
      <text x="302" y="264" text-anchor="middle" class="arch-flow-label">{{ t('home.arch.flow-mcp') }}</text>

      <!-- InnerAgent ↔ 模型 -->
      <path d="M 580 165 L 656 165" class="arch-flow arch-flow--model" marker-end="url(#arch-arrow)" />
      <text x="618" y="152" text-anchor="middle" class="arch-flow-label">{{ t('home.arch.flow-model') }}</text>
    </svg>
  </figure>
</template>

<style lang="scss" scoped>
.arch-diagram {
  margin: 0;

  svg {
    width: 100%;
    height: auto;
    display: block;
  }
}

.arch-box {
  rx: 10;
}

.arch-box--host-frame {
  fill: var(--el-fill-color-lighter, var(--el-fill-color-light));
  stroke: var(--el-border-color-lighter);
  stroke-dasharray: 6 4;
}

.arch-box--host {
  fill: var(--el-bg-color);
  stroke: var(--el-border-color-light);
}

.arch-box--ia {
  fill: var(--el-color-primary-light-9);
  stroke: var(--el-color-primary-light-5);
}

.arch-box--inner {
  fill: var(--el-bg-color);
  stroke: var(--el-color-primary-light-7);
}

.arch-box--model {
  fill: var(--el-bg-color);
  stroke: var(--el-border-color);
}

.arch-title {
  font-size: 14px;
  font-weight: 600;
  fill: var(--el-text-color-primary);
}

.arch-desc {
  font-size: 11px;
  fill: var(--el-text-color-secondary);
}

.arch-desc--dim {
  fill: var(--el-text-color-placeholder);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.arch-label--frame {
  font-size: 12px;
  font-weight: 700;
  fill: var(--el-text-color-secondary);
  letter-spacing: 1px;
}

.arch-label--ia {
  font-size: 15px;
  font-weight: 700;
  fill: var(--el-color-primary);
  letter-spacing: 0.5px;
}

.arch-flow {
  fill: none;
  stroke: var(--el-color-primary);
  stroke-width: 1.6;
}

.arch-flow--act {
  stroke: var(--el-color-success);
}

.arch-flow--model {
  stroke: var(--el-text-color-secondary);
  stroke-dasharray: 5 4;
}

.arch-arrow-head {
  fill: var(--el-color-primary);
}

.arch-flow--act + .arch-arrow-head { fill: var(--el-color-success); }

.arch-flow-label {
  font-size: 11px;
  fill: var(--el-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 640px) {
  .arch-desc {
    display: none;
  }
}
</style>
