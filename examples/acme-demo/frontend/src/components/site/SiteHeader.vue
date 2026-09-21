<script setup lang="ts">
/**
 * SiteHeader — 公开官网顶部导航(产品/Demo/文档/体验台 + 语言 + 进入控制台)。
 *
 * 与控制台 AppLayout(侧栏形态)分离;移动端折叠为汉堡菜单。
 * 语言切换写 preference store(与控制台共用一份 locale,App.vue 负责同步 i18n)。
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/store/preference'

defineOptions({ name: 'SiteHeader' })

const { t } = useI18n()
const route = useRoute()
const preference = usePreferenceStore()

interface NavLink {
  key: string
  to: string
  /** 前缀匹配高亮(如 /docs/xxx 也点亮「文档」) */
  prefix?: string
  /** 精确匹配高亮 */
  exact?: string
}

const links = computed<NavLink[]>(() => [
  { key: 'site.nav.product', to: '/', exact: '/' },
  { key: 'site.nav.demo', to: '/ia/overview', prefix: '/ia' },
  { key: 'site.nav.docs', to: '/docs', prefix: '/docs' },
  { key: 'site.nav.playground', to: '/playground', prefix: '/playground' },
])

function isActive(link: NavLink): boolean {
  if (link.exact !== undefined) return route.path === link.exact
  if (link.prefix) return route.path === link.to || route.path.startsWith(link.prefix)
  return route.path === link.to
}

// ---- 移动端折叠菜单 ----
const menuOpen = ref(false)
watch(() => route.fullPath, () => { menuOpen.value = false })

// ---- 语言切换(与控制台 preference 同源) ----
const nextLocaleLabel = computed(() => (preference.locale === 'zh-CN' ? 'EN' : '中'))

function toggleLocale() {
  preference.setLocale(preference.locale === 'zh-CN' ? 'en-US' : 'zh-CN')
}
</script>

<template>
  <header class="site-header" data-testid="site-header">
    <div class="site-header__inner">
      <router-link to="/" class="site-logo" :aria-label="t('site.nav.brand')" data-testid="site-logo">
        <span class="site-logo__mark" aria-hidden="true">
          <i class="ri-sparkling-2-line" />
        </span>
        <span class="site-logo__text">
          <strong>{{ t('site.name') }}</strong>
          <small>{{ t('site.tagline') }}</small>
        </span>
      </router-link>

      <nav class="site-nav" aria-label="Primary">
        <router-link
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="site-nav__link"
          :class="{ 'is-active': isActive(link) }"
          :data-testid="`site-nav-${link.to === '/' ? 'home' : link.to.slice(1)}`"
        >
          {{ t(link.key) }}
        </router-link>
      </nav>

      <div class="site-header__actions">
        <button
          type="button"
          class="site-lang"
          :aria-label="t('site.nav.language')"
          :title="t('site.nav.language')"
          data-testid="site-lang"
          @click="toggleLocale"
        >
          <i class="ri-global-line" aria-hidden="true" />
          <span>{{ nextLocaleLabel }}</span>
        </button>
        <router-link to="/ia/overview" class="site-cta" data-testid="site-console-cta">
          {{ t('site.nav.console') }}
          <i class="ri-arrow-right-line" aria-hidden="true" />
        </router-link>
        <button
          type="button"
          class="site-burger"
          :aria-label="menuOpen ? t('site.nav.close-menu') : t('site.nav.open-menu')"
          :aria-expanded="menuOpen"
          data-testid="site-burger"
          @click="menuOpen = !menuOpen"
        >
          <i :class="menuOpen ? 'ri-close-line' : 'ri-menu-line'" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- 移动端折叠菜单(≤880px 由 CSS 展示;桌面隐藏) -->
    <div v-if="menuOpen" class="site-mobile-menu" data-testid="site-mobile-menu">
      <router-link
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="site-mobile-menu__link"
        :class="{ 'is-active': isActive(link) }"
      >
        {{ t(link.key) }}
        <i class="ri-arrow-right-s-line" aria-hidden="true" />
      </router-link>
      <div class="site-mobile-menu__foot">
        <button type="button" class="site-lang" data-testid="site-lang-mobile" @click="toggleLocale">
          <i class="ri-global-line" aria-hidden="true" />
          <span>{{ nextLocaleLabel }}</span>
        </button>
        <router-link to="/ia/overview" class="site-cta" data-testid="site-console-cta-mobile">
          {{ t('site.nav.console') }}
          <i class="ri-arrow-right-line" aria-hidden="true" />
        </router-link>
      </div>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.site-header__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 28px;
}

/* ---- logo ---- */
.site-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  min-width: 0;
}

.site-logo__mark {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), color-mix(in srgb, var(--el-color-primary) 62%, #1f2937));
  font-size: 17px;
}

.site-logo__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;

  strong {
    font-size: 16px;
    font-weight: 700;
    color: var(--el-text-color-primary);
    letter-spacing: 0.2px;
  }

  small {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }
}

/* ---- 主导航 ---- */
.site-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.site-nav__link {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;

  &:hover {
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
  }

  &.is-active {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

/* ---- 右侧动作区 ---- */
.site-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.site-lang {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: var(--el-text-color-primary);
    border-color: var(--el-border-color);
  }

  i { font-size: 15px; }
}

.site-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: filter 0.15s, transform 0.15s;

  &:hover { filter: brightness(1.06); }
  &:active { transform: translateY(1px); }

  i { font-size: 15px; }
}

/* ---- 移动端 ---- */
.site-burger {
  display: none;
  width: 38px;
  height: 38px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 20px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
}

.site-mobile-menu {
  display: none;
  flex-direction: column;
  padding: 8px 16px 16px;
  border-top: 1px solid var(--el-border-color-extra-light);
  background: var(--el-bg-color);
}

.site-mobile-menu__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px;
  font-size: 15px;
  color: var(--el-text-color-primary);
  text-decoration: none;
  border-bottom: 1px solid var(--el-border-color-extra-light);

  &.is-active { color: var(--el-color-primary); }
}

.site-mobile-menu__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 14px;
}

@media (max-width: 880px) {
  .site-nav { display: none; }
  .site-header__actions .site-cta { display: none; }
  .site-burger { display: inline-flex; }
  .site-mobile-menu { display: flex; }
  .site-logo__text small { display: none; }
}
</style>
