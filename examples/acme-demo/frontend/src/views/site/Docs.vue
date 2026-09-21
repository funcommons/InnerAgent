<script setup lang="ts">
/**
 * 文档中心(/docs):侧边栏章节树 + 正文渲染 + 学习路径(下一步)。
 *
 * 内容来自 src/site/docs(结构化 TS,按 preference.locale 取 zh/en),
 * 不运行时读 markdown。/docs 无参 → 文档首页(章节卡);
 * /docs/:sectionId → 章节正文;未知 id 回落文档首页。
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/store/preference'
import CodeBlock from '@/components/site/CodeBlock.vue'
import {
  getDocSections,
  getDocSection,
  getDocNeighbours,
  getDocStepIndex,
  docPath,
  type DocBlock,
} from '@/site/docs'

defineOptions({ name: 'SiteDocs' })

const { t } = useI18n()
const route = useRoute()
const preference = usePreferenceStore()

const locale = computed(() => preference.locale)
const sections = computed(() => getDocSections(locale.value))

const sectionId = computed(() => {
  const v = route.params.sectionId
  return Array.isArray(v) ? v[0] : v
})

const currentSection = computed(() => getDocSection(locale.value, sectionId.value))
const prevSection = computed(() => getDocNeighbours(locale.value, sectionId.value).prev)
const nextSection = computed(() => getDocNeighbours(locale.value, sectionId.value).next)

function stepOf(id: string): number {
  return getDocStepIndex(locale.value, id)
}

// ---- 移动端章节抽屉 ----
const navOpen = ref(false)
watch(() => route.fullPath, () => { navOpen.value = false })

function blockKey(block: DocBlock, i: number): string {
  return `${i}-${block.type}`
}
</script>

<template>
  <div class="docs-page">
    <!-- ===== 桌面侧边栏 ===== -->
    <aside class="docs-side">
      <nav class="docs-nav" :aria-label="t('docs.nav-aria')" data-testid="docs-nav">
        <p class="docs-nav__title">{{ t('docs.nav-title') }}</p>
        <router-link
          to="/docs"
          class="docs-nav__item"
          :class="{ 'is-active': !sectionId }"
          data-testid="docs-nav-overview"
        >
          <i class="ri-home-4-line" aria-hidden="true" />
          <span>{{ t('docs.overview-title') }}</span>
        </router-link>
        <router-link
          v-for="s in sections"
          :key="s.id"
          :to="docPath(s.id)"
          class="docs-nav__item"
          :class="{ 'is-active': sectionId === s.id }"
          :data-testid="`docs-nav-${s.id}`"
        >
          <span class="docs-nav__num">{{ String(stepOf(s.id)).padStart(2, '0') }}</span>
          <span class="docs-nav__label">{{ s.title }}</span>
        </router-link>
      </nav>
    </aside>

    <!-- ===== 移动端章节抽屉 ===== -->
    <button
      v-if="!navOpen"
      type="button"
      class="docs-nav-toggle"
      data-testid="docs-nav-toggle"
      @click="navOpen = true"
    >
      <i class="ri-menu-2-line" aria-hidden="true" />
      {{ t('docs.open-nav') }}
    </button>
    <div v-if="navOpen" class="docs-drawer" data-testid="docs-drawer">
      <div class="docs-drawer__mask" @click="navOpen = false" />
      <div class="docs-drawer__panel">
        <div class="docs-drawer__head">
          <span>{{ t('docs.nav-title') }}</span>
          <button type="button" :aria-label="t('docs.close-nav')" data-testid="docs-nav-close" @click="navOpen = false">
            <i class="ri-close-line" aria-hidden="true" />
          </button>
        </div>
        <nav class="docs-nav docs-nav--drawer" :aria-label="t('docs.nav-aria')">
          <router-link
            v-for="s in sections"
            :key="s.id"
            :to="docPath(s.id)"
            class="docs-nav__item"
            :class="{ 'is-active': sectionId === s.id }"
          >
            <span class="docs-nav__num">{{ String(stepOf(s.id)).padStart(2, '0') }}</span>
            <span class="docs-nav__label">{{ s.title }}</span>
          </router-link>
        </nav>
      </div>
    </div>

    <!-- ===== 正文 ===== -->
    <article class="docs-main">
      <!-- 章节正文 -->
      <template v-if="currentSection">
        <p class="docs-step-label">{{ t('docs.step-label', { n: stepOf(currentSection.id) }) }}</p>
        <h1 class="docs-title" data-testid="docs-section-title">{{ currentSection.title }}</h1>
        <p class="docs-summary">{{ currentSection.summary }}</p>

        <template v-for="(block, i) in currentSection.blocks" :key="blockKey(block, i)">
          <h2 v-if="block.type === 'h'" class="docs-h">{{ block.text }}</h2>
          <p v-else-if="block.type === 'p'" class="docs-p">{{ block.text }}</p>
          <CodeBlock v-else-if="block.type === 'code'" class="docs-block" :code="block.code" :lang="block.lang" />
          <ul v-else-if="block.type === 'list' && !block.ordered" class="docs-list">
            <li v-for="(item, j) in block.items" :key="j">{{ item }}</li>
          </ul>
          <ol v-else-if="block.type === 'list'" class="docs-list docs-list--ordered">
            <li v-for="(item, j) in block.items" :key="j">{{ item }}</li>
          </ol>
          <div v-else-if="block.type === 'table'" class="docs-table-wrap">
            <table class="docs-table">
              <thead>
                <tr><th v-for="h in block.head" :key="h">{{ h }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, r) in block.rows" :key="r">
                  <td v-for="(cell, c) in row" :key="c">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="block.type === 'callout'" class="docs-callout" :class="`is-${block.tone}`" role="note">
            <i :class="block.tone === 'warn' ? 'ri-alert-line' : 'ri-information-line'" aria-hidden="true" />
            <p>{{ block.text }}</p>
          </div>
        </template>

        <!-- 学习路径:上一步 / 下一步 -->
        <footer class="docs-path" data-testid="docs-path">
          <router-link v-if="prevSection" :to="docPath(prevSection.id)" class="docs-path__card is-prev">
            <span class="docs-path__cap"><i class="ri-arrow-left-line" aria-hidden="true" />{{ t('docs.prev') }}</span>
            <span class="docs-path__title">{{ prevSection.title }}</span>
          </router-link>
          <span v-else class="docs-path__spacer" />
          <router-link v-if="nextSection" :to="docPath(nextSection.id)" class="docs-path__card is-next" data-testid="docs-next-link">
            <span class="docs-path__cap">{{ t('docs.next') }}<i class="ri-arrow-right-line" aria-hidden="true" /></span>
            <span class="docs-path__title">{{ nextSection.title }}</span>
          </router-link>
          <div v-else class="docs-path__card is-cta" data-testid="docs-playground-cta">
            <span class="docs-path__cap">{{ t('docs.playground-cta-title') }}</span>
            <span class="docs-path__title">{{ t('docs.playground-cta-desc') }}</span>
            <router-link to="/playground" class="docs-path__btn">
              {{ t('docs.playground-cta') }}
              <i class="ri-arrow-right-line" aria-hidden="true" />
            </router-link>
          </div>
        </footer>
      </template>

      <!-- 文档首页(/docs 无参或未知 id)-->
      <template v-else>
        <h1 class="docs-title" data-testid="docs-overview-title">{{ t('docs.overview-title') }}</h1>
        <p class="docs-summary">{{ t('docs.overview-subtitle') }}</p>
        <router-link to="/docs/quickstart" class="docs-start" data-testid="docs-start-cta">
          {{ t('docs.start-reading') }}
          <i class="ri-arrow-right-line" aria-hidden="true" />
        </router-link>
        <div class="docs-cards" data-testid="docs-overview">
          <router-link
            v-for="s in sections"
            :key="s.id"
            :to="docPath(s.id)"
            class="docs-card"
            :data-testid="`docs-card-${s.id}`"
          >
            <span class="docs-card__num">{{ String(stepOf(s.id)).padStart(2, '0') }}</span>
            <h3>{{ s.title }}</h3>
            <p>{{ s.summary }}</p>
          </router-link>
        </div>
      </template>
    </article>
  </div>
</template>

<style lang="scss" scoped>
.docs-page {
  max-width: 1152px;
  margin: 0 auto;
  padding: 40px 24px 72px;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 48px;
}

/* ===== 侧边栏 ===== */
.docs-side {
  position: sticky;
  top: 84px;
  align-self: start;
  max-height: calc(100vh - 108px);
  overflow-y: auto;
}

.docs-nav__title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
}

.docs-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs-nav__item {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
  transition: all 0.15s;

  &:hover {
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
  }

  &.is-active {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    font-weight: 600;
  }
}

.docs-nav__num {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.docs-nav__label {
  min-width: 0;
}

/* ===== 移动端抽屉 ===== */
.docs-nav-toggle {
  display: none;
}

.docs-drawer {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.docs-drawer__mask {
  position: absolute;
  inset: 0;
  background: var(--app-mask, rgba(0, 0, 0, 0.5));
}

.docs-drawer__panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(300px, 84vw);
  background: var(--el-bg-color);
  padding: 16px;
  overflow-y: auto;
}

.docs-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);

  button {
    border: none;
    background: transparent;
    font-size: 20px;
    color: var(--el-text-color-secondary);
    cursor: pointer;
  }
}

/* ===== 正文 ===== */
.docs-main {
  min-width: 0;
}

.docs-step-label {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--el-color-primary);
}

.docs-title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  color: var(--el-text-color-primary);
}

.docs-summary {
  margin: 10px 0 8px;
  font-size: 15px;
  color: var(--el-text-color-secondary);
}

.docs-h {
  margin: 34px 0 12px;
  font-size: 19px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.docs-p {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}

.docs-block {
  margin: 0 0 16px;
}

.docs-list {
  margin: 0 0 16px;
  padding-left: 22px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-regular);

  li { margin-bottom: 6px; }
  &--ordered { list-style: decimal; }
}

.docs-table-wrap {
  margin: 0 0 16px;
  overflow-x: auto;
}

.docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th,
  td {
    padding: 9px 12px;
    border: 1px solid var(--el-border-color-lighter);
    text-align: left;
    vertical-align: top;
    line-height: 1.6;
  }

  th {
    background: var(--el-fill-color-light);
    font-weight: 600;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  td { color: var(--el-text-color-regular); }
}

.docs-callout {
  display: flex;
  gap: 10px;
  margin: 0 0 16px;
  padding: 13px 16px;
  border-radius: 9px;
  font-size: 13.5px;
  line-height: 1.7;

  i { font-size: 17px; flex-shrink: 0; margin-top: 2px; }
  p { margin: 0; }

  &.is-info {
    background: var(--el-color-primary-light-9);
    color: var(--el-text-color-regular);
    i { color: var(--el-color-primary); }
  }

  &.is-warn {
    background: var(--el-color-warning-light-9, #fdf6ec);
    color: var(--el-text-color-regular);
    i { color: var(--el-color-warning); }
  }
}

/* ===== 学习路径 ===== */
.docs-path {
  display: flex;
  gap: 14px;
  margin-top: 40px;
  padding-top: 22px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.docs-path__spacer {
  flex: 1;
}

.docs-path__card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  text-decoration: none;
  transition: all 0.15s;

  &.is-prev { align-items: flex-start; }
  &.is-next { align-items: flex-end; text-align: right; }

  &:hover {
    border-color: var(--el-color-primary-light-5);

    .docs-path__title { color: var(--el-color-primary); }
  }
}

.docs-path__cap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.docs-path__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.docs-path__card.is-cta {
  align-items: flex-start;
  border-style: dashed;
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.docs-path__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 7px 14px;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;

  &:hover { filter: brightness(1.06); }
}

/* ===== 文档首页章节卡 ===== */
.docs-start {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 28px;
  padding: 10px 18px;
  border-radius: 9px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;

  &:hover { filter: brightness(1.06); }
}

.docs-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.docs-card {
  padding: 18px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 11px;
  text-decoration: none;
  transition: all 0.15s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    transform: translateY(-2px);
  }

  h3 {
    margin: 8px 0 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 6px 0 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--el-text-color-secondary);
  }
}

.docs-card__num {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--el-color-primary);
}

/* ===== 响应式 ===== */
@media (max-width: 880px) {
  .docs-page {
    grid-template-columns: 1fr;
    padding-top: 24px;
  }

  .docs-side { display: none; }

  .docs-nav-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
    padding: 8px 14px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    font-size: 13px;
    cursor: pointer;
  }

  .docs-cards { grid-template-columns: 1fr; }

  .docs-path { flex-direction: column; }
  .docs-path__card.is-next { align-items: flex-start; text-align: left; }
  .docs-path__spacer { display: none; }

  .docs-title { font-size: 24px; }
}
</style>
