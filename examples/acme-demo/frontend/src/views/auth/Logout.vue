<template>
  <div class="logout-page">
    <div class="logout-card">
      <i class="ri-loader-4-line spinning" />
      <p>{{ t('common.logout-in-progress') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/store/user'

defineOptions({ name: 'LogoutPage' })

const router = useRouter()
const { t } = useI18n()
const userStore = useUserStore()

onMounted(async () => {
  try {
    await userStore.logout()
  } catch {
    // 即使服务端登出失败也清前端态
    userStore.clearAuth()
  }
  // 短暂延迟让用户看到提示
  setTimeout(() => {
    router.replace('/login')
  }, 400)
})
</script>

<style scoped lang="scss">
.logout-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.logout-card {
  background: #fff;
  border-radius: 12px;
  padding: 36px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);

  i {
    font-size: 32px;
    color: var(--el-color-primary);
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  p {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
}
</style>