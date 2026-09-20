<script setup lang="ts">
/**
 * [new] 登录视图(DEF-01 修复:对齐服务端 18a 账号密码契约,替换 adminKey 占位表单)。
 * 主通道:用户名/密码 → POST /admin/auth/login → Bearer 会话 token(localStorage)。
 * 引导模式:X-IA-Admin-Key(自动化/引导通道)保留为「高级」折叠项,sessionStorage。
 * 错误文案:401 凭据错误(服务端防枚举文案)与 423 账号锁定(透出剩余分钟)区分。
 */
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Key } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { describeLoginError } from '@/utils/loginError'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref()
const loading = ref(false)
const advanced = ref<string[]>([])
const form = reactive({ username: '', password: '', adminKey: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/** 引导模式:填写了管理 Key 时跳过账号密码,直接走 X-IA-Admin-Key 通道 */
const usingAdminKey = () => form.adminKey.trim().length > 0

async function redirectToTarget(): Promise<void> {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  void router.push(redirect)
}

async function handleLogin() {
  if (usingAdminKey()) {
    loading.value = true
    try {
      await auth.loginWithAdminKey(form.adminKey.trim())
      await redirectToTarget()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '登录失败,请重试')
    } finally {
      loading.value = false
    }
    return
  }
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.login(form.username.trim(), form.password)
    await redirectToTarget()
  } catch (err) {
    ElMessage.error(describeLoginError(err))
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
          <p>应用级独立管理控制台(管理员账号登录)</p>
        </div>
      </template>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="handleLogin">
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="管理员用户名"
            :prefix-icon="User"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="管理员密码"
            :prefix-icon="Lock"
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item>
          <el-button class="login-btn" type="primary" :loading="loading" native-type="button" @click="handleLogin">
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <el-collapse v-model="advanced" class="login-advanced">
        <el-collapse-item title="高级:引导模式(X-IA-Admin-Key)" name="bootstrap">
          <el-input
            v-model="form.adminKey"
            type="password"
            show-password
            placeholder="填写后跳过账号密码,以 X-IA-Admin-Key 通道进入(自动化/引导场景)"
            :prefix-icon="Key"
            autocomplete="off"
          />
          <p class="login-advanced__note">引导 Key 不产生会话,仅逐请求校验;常规使用请走账号密码登录。</p>
        </el-collapse-item>
      </el-collapse>
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
.login-advanced {
  border-top: none;
  --el-collapse-header-height: 32px;
}
.login-advanced__note {
  margin: 8px 0 0;
  color: #c0c4cc;
  font-size: 12px;
}
</style>
