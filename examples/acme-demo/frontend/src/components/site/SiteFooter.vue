<script setup lang="ts">
/**
 * SiteFooter — 公开官网页脚:产品/资源两栏链接 + 「由 InnerAgent 驱动」署名。
 * GitHub 为占位外链;文档相关一律指向站内 /docs(文档内容已内化为结构化数据)。
 */
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'SiteFooter' })

const { t } = useI18n()

/** GitHub 仓库占位链接(公开官网形态所需的锚点,非运行时依赖) */
const GITHUB_PLACEHOLDER_URL = 'https://github.com/funcommons/InnerAgent'

interface FooterLink {
  key: string
  to?: string
  href?: string
  testid: string
}

const productLinks: FooterLink[] = [
  { key: 'site.footer.product-home', to: '/', testid: 'footer-home' },
  { key: 'site.footer.api-playground', to: '/playground', testid: 'footer-playground' },
  { key: 'site.footer.enter-console', to: '/ia/overview', testid: 'footer-console' },
]

const resourceLinks: FooterLink[] = [
  { key: 'site.footer.docs-center', to: '/docs', testid: 'footer-docs' },
  { key: 'site.footer.quick-start', to: '/docs/quickstart', testid: 'footer-quickstart' },
  { key: 'site.footer.frontend-embed', to: '/docs/frontend-embed', testid: 'footer-embed' },
  { key: 'site.footer.github', href: GITHUB_PLACEHOLDER_URL, testid: 'footer-github' },
]
</script>

<template>
  <footer class="site-footer" data-testid="site-footer">
    <div class="site-footer__inner">
      <div class="site-footer__brand">
        <div class="site-footer__logo">
          <span class="site-footer__mark" aria-hidden="true"><i class="ri-sparkling-2-line" /></span>
          <strong>{{ t('site.name') }}</strong>
        </div>
        <p class="site-footer__tagline">{{ t('site.tagline') }}</p>
      </div>

      <div class="site-footer__cols">
        <div class="site-footer__col">
          <h4>{{ t('site.footer.product') }}</h4>
          <template v-for="link in productLinks" :key="link.testid">
            <router-link v-if="link.to" :to="link.to" :data-testid="link.testid">{{ t(link.key) }}</router-link>
          </template>
        </div>
        <div class="site-footer__col">
          <h4>{{ t('site.footer.resources') }}</h4>
          <template v-for="link in resourceLinks" :key="link.testid">
            <router-link v-if="link.to" :to="link.to" :data-testid="link.testid">{{ t(link.key) }}</router-link>
            <a v-else-if="link.href" :href="link.href" target="_blank" rel="noopener noreferrer" :data-testid="link.testid">
              {{ t(link.key) }}
              <i class="ri-external-link-line" aria-hidden="true" />
            </a>
          </template>
        </div>
      </div>
    </div>

    <div class="site-footer__bottom">
      <p class="site-footer__powered">
        <i class="ri-flashlight-line" aria-hidden="true" />
        {{ t('site.footer.poweredBy') }}
      </p>
      <p class="site-footer__note">{{ t('site.footer.demo-note') }}</p>
    </div>
  </footer>
</template>

<style lang="scss" scoped>
.site-footer {
  border-top: 1px solid var(--el-border-color-extra-light);
  background: var(--el-bg-color);
  margin-top: auto;
}

.site-footer__inner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 40px 24px 24px;
  display: flex;
  gap: 48px;
  flex-wrap: wrap;
}

.site-footer__brand {
  flex: 1 1 240px;
  min-width: 0;
}

.site-footer__logo {
  display: flex;
  align-items: center;
  gap: 8px;

  strong {
    font-size: 16px;
    color: var(--el-text-color-primary);
  }
}

.site-footer__mark {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), color-mix(in srgb, var(--el-color-primary) 62%, #1f2937));
  font-size: 15px;
}

.site-footer__tagline {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.site-footer__cols {
  display: flex;
  gap: 64px;
  flex-wrap: wrap;
}

.site-footer__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 120px;

  h4 {
    margin: 0 0 2px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    text-decoration: none;

    &:hover { color: var(--el-color-primary); }
  }
}

.site-footer__bottom {
  max-width: 1152px;
  margin: 0 auto;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--el-border-color-extra-light);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  align-items: center;
  justify-content: space-between;

  p { margin: 0; font-size: 12px; }
}

.site-footer__powered {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);

  i { color: var(--el-color-primary); }
}

.site-footer__note {
  color: var(--el-text-color-placeholder);
}
</style>
