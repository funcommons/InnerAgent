<script setup lang="ts">
/**
 * 产品首页(公开官网):hero + 特性网格(8 卡) + 架构一图流(内联 SVG) +
 * 接入三步曲 + 关于(AgentScope 内核说明 / 与 demo-host 定位比对)。
 *
 * 文案全部走 i18n(home.*),产品事实来自 README / PRD §2 / 接入指南,不编造。
 */
import { useI18n } from 'vue-i18n'
import ArchDiagram from '@/components/site/ArchDiagram.vue'
import { SITE_FEATURES, SITE_STEPS } from '@/site/features'

defineOptions({ name: 'SiteHome' })

const { t } = useI18n()

/** 关于区比对表(行 id 与 i18n home.about.compare.<id> 对应) */
const COMPARE_ROWS = ['view', 'token', 'tools', 'usage'] as const
</script>

<template>
  <div class="site-home">
    <!-- ===== Hero ===== -->
    <section class="hero">
      <div class="hero__inner">
        <span class="hero__badge" data-testid="home-badge">
          <i class="ri-sparkling-2-line" aria-hidden="true" />
          {{ t('home.hero.badge') }}
        </span>
        <h1 class="hero__title" data-testid="home-title">{{ t('home.hero.title') }}</h1>
        <p class="hero__subtitle" data-testid="home-subtitle">{{ t('home.hero.subtitle') }}</p>
        <div class="hero__cta">
          <router-link to="/docs" class="hero__btn hero__btn--primary" data-testid="home-cta-docs">
            {{ t('home.hero.cta-docs') }}
            <i class="ri-arrow-right-line" aria-hidden="true" />
          </router-link>
          <router-link to="/ia/overview" class="hero__btn" data-testid="home-cta-demo">
            {{ t('home.hero.cta-demo') }}
            <i class="ri-external-link-line" aria-hidden="true" />
          </router-link>
        </div>
        <p class="hero__note">{{ t('home.hero.hero-note') }}</p>
      </div>
    </section>

    <!-- ===== 特性网格 ===== -->
    <section class="features">
      <div class="section-head">
        <h2>{{ t('home.features.title') }}</h2>
        <p>{{ t('home.features.subtitle') }}</p>
      </div>
      <div class="features__grid" data-testid="home-features">
        <router-link
          v-for="f in SITE_FEATURES"
          :key="f.id"
          :to="f.docTo"
          class="feature-card"
          :data-testid="`feature-${f.id}`"
        >
          <span class="feature-card__icon" aria-hidden="true"><i :class="f.icon" /></span>
          <h3>{{ t(`home.features.items.${f.id}.title`) }}</h3>
          <p>{{ t(`home.features.items.${f.id}.desc`) }}</p>
          <span class="feature-card__more">
            {{ t('home.features.learn-more') }}
            <i class="ri-arrow-right-line" aria-hidden="true" />
          </span>
        </router-link>
      </div>
    </section>

    <!-- ===== 架构一图流 ===== -->
    <section class="arch">
      <div class="section-head">
        <h2>{{ t('home.arch.title') }}</h2>
        <p>{{ t('home.arch.subtitle') }}</p>
      </div>
      <ArchDiagram />
    </section>

    <!-- ===== 接入三步曲 ===== -->
    <section class="steps">
      <div class="section-head">
        <h2>{{ t('home.steps.title') }}</h2>
        <p>{{ t('home.steps.subtitle') }}</p>
      </div>
      <div class="steps__grid" data-testid="home-steps">
        <div v-for="(s, i) in SITE_STEPS" :key="s.id" class="step-card" :data-testid="`step-${s.id}`">
          <span class="step-card__num">{{ i + 1 }}</span>
          <h3>{{ t(`home.steps.${s.id}.title`) }}</h3>
          <p>{{ t(`home.steps.${s.id}.desc`) }}</p>
          <code class="step-card__code">{{ t(`home.steps.${s.id}.code`) }}</code>
        </div>
      </div>
      <div class="steps__cta">
        <router-link to="/docs/quickstart" class="hero__btn hero__btn--primary" data-testid="home-steps-docs">
          {{ t('home.steps.go-docs') }}
          <i class="ri-arrow-right-line" aria-hidden="true" />
        </router-link>
      </div>
      <p class="steps__demo-agents">
        <router-link to="/ia/agents" data-testid="home-demo-agents">
          {{ t('home.steps.demo-agents') }}
          <i class="ri-arrow-right-line" aria-hidden="true" />
        </router-link>
      </p>
    </section>

    <!-- ===== 关于本 Demo ===== -->
    <section class="about">
      <div class="section-head">
        <h2>{{ t('home.about.title') }}</h2>
        <p>{{ t('home.about.compareSubtitle') }}</p>
      </div>
      <p class="about__agentscope" data-testid="home-agentscope">
        <i class="ri-github-line" aria-hidden="true" />
        {{ t('home.about.agent-scope') }}
      </p>
      <table class="about__compare" data-testid="home-compare">
        <thead>
          <tr>
            <th>{{ t('home.about.compare-title-a') }}</th>
            <th>{{ t('home.about.compare-title-b') }}</th>
            <th>{{ t('home.about.compare-title-c') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in COMPARE_ROWS" :key="row">
            <td class="about__compare-cap">{{ t(`home.about.compare.${row}.0`) }}</td>
            <td>{{ t(`home.about.compare.${row}.1`) }}</td>
            <td class="about__compare-dim">{{ t(`home.about.compare.${row}.2`) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.site-home {
  display: flex;
  flex-direction: column;
}

/* ===== 通用 section ===== */
.site-home > section {
  max-width: 1152px;
  width: 100%;
  margin: 0 auto;
  padding: 72px 24px 0;

  &:last-child { padding-bottom: 72px; }
}

.section-head {
  margin-bottom: 32px;

  h2 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 8px 0 0;
    font-size: 15px;
    color: var(--el-text-color-secondary);
  }
}

/* ===== Hero ===== */
.hero {
  padding-top: 88px !important;
  padding-bottom: 24px;
  text-align: center;
}

.hero__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
}

.hero__title {
  margin: 20px 0 0;
  font-size: 46px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--el-text-color-primary);
  letter-spacing: -0.5px;
}

.hero__subtitle {
  max-width: 720px;
  margin: 18px auto 0;
  font-size: 17px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.hero__cta {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 32px;
  flex-wrap: wrap;
}

.hero__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 22px;
  border-radius: 9px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  transition: all 0.15s;

  &:hover { border-color: var(--el-border-color-dark); }

  &--primary {
    color: #fff;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);

    &:hover { filter: brightness(1.06); border-color: var(--el-color-primary); }
  }
}

.hero__note {
  margin: 22px 0 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

/* ===== 特性网格 ===== */
.features__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.feature-card {
  display: flex;
  flex-direction: column;
  padding: 22px 20px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 12px;
  background: var(--el-bg-color);
  text-decoration: none;
  transition: all 0.18s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: var(--app-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.06));
    transform: translateY(-2px);

    .feature-card__more { color: var(--el-color-primary); }
  }

  h3 {
    margin: 14px 0 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--el-text-color-secondary);
    flex: 1;
  }
}

.feature-card__icon {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  font-size: 19px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.feature-card__more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-placeholder);
  transition: color 0.15s;
}

/* ===== 架构图 ===== */
.arch svg {
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 14px;
  padding: 12px;
  background: var(--el-bg-color);
}

/* ===== 接入三步曲 ===== */
.steps__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.step-card {
  position: relative;
  padding: 24px 22px 20px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 12px;
  background: var(--el-bg-color);

  h3 {
    margin: 14px 0 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 8px 0 14px;
    font-size: 13px;
    line-height: 1.65;
    color: var(--el-text-color-secondary);
  }
}

.step-card__num {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: var(--el-color-primary);
}

.step-card__code {
  display: block;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  overflow-x: auto;
  white-space: nowrap;
}

.steps__cta {
  display: flex;
  justify-content: center;
  margin-top: 28px;
}

.steps__demo-agents {
  margin: 14px 0 0;
  text-align: center;

  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-color-primary);
    text-decoration: none;

    &:hover { filter: brightness(1.1); }
  }
}

/* ===== 关于 ===== */
.about__agentscope {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 20px;
  padding: 16px 18px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);

  i {
    font-size: 17px;
    color: var(--el-color-primary);
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.about__compare {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th,
  td {
    padding: 12px 14px;
    border: 1px solid var(--el-border-color-extra-light);
    text-align: left;
    vertical-align: top;
    line-height: 1.6;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  td {
    color: var(--el-text-color-secondary);
  }
}

.about__compare-cap {
  font-weight: 600;
  color: var(--el-text-color-primary) !important;
  white-space: nowrap;
}

.about__compare-dim {
  color: var(--el-text-color-placeholder) !important;
}

/* ===== 响应式 ===== */
@media (max-width: 1024px) {
  .features__grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .hero__title { font-size: 32px; }
  .steps__grid { grid-template-columns: 1fr; }
  .site-home > section { padding-top: 52px; }
}

@media (max-width: 560px) {
  .features__grid { grid-template-columns: 1fr; }
}
</style>
