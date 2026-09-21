<script setup lang="ts">
/**
 * 文档中心(占位骨架,完整实现见后续提交:章节树/正文/代码块/学习路径)。
 */
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'SiteDocs' })
const { t } = useI18n()
</script>

<template>
  <div class="site-docs" data-testid="site-docs">
    <h1>{{ t('router.site-docs') }}</h1>
  </div>
</template>

<style scoped lang="scss">
.site-docs {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}
</style>
