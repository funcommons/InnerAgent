<script setup lang="ts">
/**
 * [new] 登录占位视图(视图清单 #1)。
 * 管理 key 登录,X-IA-Admin-Key 头,仅 UI 壳:mock 恒定放行任意非空 key。
 * P2 正式任务替换为内置管理员账号(Argon2 + 失败锁定 + 登录审计,《02-技术方案》§6.3)。
 */
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/errorCodes'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref()
const loading = ref(false)
const form = reactive({ adminKey: '' })
const rules = {
  adminKey: [{ required: true, message: '请输入管理 key', trigger: 'blur' }],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.login(form.adminKey.trim())
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    void router.push(redirect)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '登录失败,请重试'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <template #header>
        <div class="login-header">
          <h1>InnerAgent 管理站</h1>
          <p>应用级独立管理控制台(占位登录,P2 接入正式账号体系)</p>
        </div>
      </template>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="handleLogin">
        <el-form-item label="管理 Key" prop="adminKey">
          <el-input
            v-model="form.adminKey"
            type="password"
            show-password
            placeholder="X-IA-Admin-Key(mock 环境任意非空值)"
            :prefix-icon="Lock"
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item>
          <el-button class="login-btn" type="primary" :loading="loading" :icon="User" native-type="button" @click="handleLogin">
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <p class="login-note">本环境为 mock 后端(msw),不产生真实凭据。</p>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}
.login-card {
  width: 400px;
}
.login-header h1 {
  margin: 0;
  font-size: 20px;
}
.login-header p {
  margin: 6px 0 0;
  color: #909399;
  font-size: 12px;
}
.login-btn {
  width: 100%;
}
.login-note {
  margin: 0;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
}
</style>
