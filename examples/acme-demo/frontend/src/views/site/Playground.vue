<script setup lang="ts">
/**
 * API 体验台(占位骨架,完整实现见后续提交:登录→token→claims 可视化→倒计时)。
 */
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'SitePlayground' })
const { t } = useI18n()
</script>

<template>
  <div class="site-playground" data-testid="site-playground">
    <h1>{{ t('router.playground') }}</h1>
  </div>
</template>

<style scoped lang="scss">
.site-playground {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}
</style>
