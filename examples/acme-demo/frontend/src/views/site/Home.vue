<script setup lang="ts">
/**
 * 产品首页(占位骨架,完整实现见后续提交:hero/特性网格/架构图/接入三步曲)。
 */
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'SiteHome' })
const { t } = useI18n()
</script>

<template>
  <div class="site-home" data-testid="site-home">
    <section class="hero">
      <h1 data-testid="home-title">{{ t('site.name') }}</h1>
      <p data-testid="home-tagline">{{ t('site.tagline') }}</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.site-home {
  min-height: 50vh;
}

.hero {
  max-width: 1152px;
  margin: 0 auto;
  padding: 80px 24px;

  h1 {
    margin: 0;
    font-size: 44px;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 12px 0 0;
    font-size: 18px;
    color: var(--el-text-color-secondary);
  }
}
</style>
