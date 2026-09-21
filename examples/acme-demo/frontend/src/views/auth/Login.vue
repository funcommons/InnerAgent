<template>
  <div class="login-page" :style="loginPageStyle">
    <div class="login-card">
      <div class="brand-area">
        <h1 class="brand-title">{{ oemTitle }}</h1>
        <p class="brand-subtitle">{{ oemSubtitle }}</p>
      </div>

      <div class="form-area">
        <h2 class="form-title">{{ t('auth.welcome-back') }}</h2>
        <p class="form-subtitle">{{ t('auth.login-to-continue') }}</p>

        <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent="handleLogin">
          <el-form-item class="fc-form-item" prop="username">
            <el-input class="fc-input"
              v-model="form.username"
              :placeholder="t('auth.username-placeholder')"
              :prefix-icon="User"
              size="large"
              clearable
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <div class="mock-hint">
            <i class="ri-information-line" />
            <span>{{ t('auth.demo-hint') }}</span>
          </div>

          <el-form-item class="fc-form-item">
            <FcButton
              type="primary"
              size="large"
              :loading="loading"
              class="submit-btn"
              @click="handleLogin"
            >
              {{ t('auth.login-btn') }}
            </FcButton>
          </el-form-item>
        </el-form>
      </div>

      <div v-if="oemFooter" class="footer">{{ oemFooter }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FcButton } from '@/components/sdk'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { User } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { useOemStore } from '@/store/oem'

defineOptions({ name: 'LoginPage' })

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const oem = useOemStore()

const oemTitle = computed(() => oem.config.title || 'ACME InnerAgent 接入 DEMO')
const oemSubtitle = computed(() => oem.config.subtitle || t('auth.default-subtitle'))
const oemFooter = computed(() => oem.config.footerText || '')
const loginPageStyle = computed(() => {
  if (oem.config.loginBgUrl) {
    return {
      backgroundImage: `url(${oem.config.loginBgUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return {}
})

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
})

// 演示轻登录: 用户名即宿主用户标识(见 store/user.ts;生产须替换为真实鉴权)
const rules: FormRules = {
  username: [
    { required: true, message: t('auth.username-required'), trigger: 'blur' },
  ],
}

async function handleLogin() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  loading.value = true
  try {
    await userStore.login(form.username)
    ElMessage.success(t('auth.login-success'))
    const redirect = (route.query.redirect as string) || '/ia/overview'
    router.replace(redirect)
  } catch {
    ElMessage.error(t('auth.login-failed'))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #e0f2fe 0%, #f0fdfa 100%);
  padding: 20px;
}

.login-card {
  width: 420px;
  max-width: 100%;
  background: #ffffff;
  border-radius: 16px;
  padding: 40px 36px 28px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
}

.brand-area {
  text-align: center;
  margin-bottom: 32px;
}

.brand-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-primary);
  letter-spacing: 0.5px;
}

.brand-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.form-area { margin-bottom: 16px; }

.form-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.form-subtitle {
  margin: 0 0 24px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

:deep(.el-input__wrapper) {
  border-radius: 8px;
  padding-left: 12px;
}
:deep(.el-input--large .el-input__wrapper) {
  padding: 4px 12px;
}

.mock-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -4px 0 16px;
  padding: 8px 12px;
  background: #fef3c7;
  border-radius: 6px;
  font-size: 12px;
  color: #92400e;
  i { font-size: 14px; }
}

.submit-btn {
  width: 100%;
  border-radius: 8px;
  font-weight: 600;
  letter-spacing: 2px;
}

.footer {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

@media (max-width: 480px) {
  .login-card {
    padding: 32px 24px 20px;
    border-radius: 12px;
  }
  .brand-title { font-size: 20px; }
  .form-title { font-size: 18px; }
}
</style>
