<template>
  <div class="app-page settings-page">
    <FcSectionHeader title="设置中心 (DEMO)" subtitle="左侧导航 + 右侧配置" :back="true" @back="router.back()" />

    <div class="settings-layout">
      <!-- 左侧导航 -->
      <aside class="settings-nav">
        <button v-for="sec in sections" :key="sec.key" class="nav-item" :class="{ active: activeSection === sec.key }" @click="activeSection = sec.key">
          <i :class="sec.icon" />
          <span>{{ sec.label }}</span>
        </button>
      </aside>

      <!-- 右侧内容 -->
      <main class="settings-content">
        <!-- 账户设置 -->
        <template v-if="activeSection === 'account'">
          <FcSection>
            <template #header><span class="sec-title">账户信息</span></template>
            <div class="setting-rows">
              <div class="setting-row">
                <label>头像</label>
                <div class="avatar-edit">
                  <Avatar src="https://picsum.photos/seed/myavatar/200/200" name="Demo" size="large" />
                  <FcButton size="small">更换</FcButton>
                </div>
              </div>
              <div class="setting-row"><label>昵称</label><input v-model="settings.nickname" class="setting-input" /></div>
              <div class="setting-row"><label>邮箱</label><input v-model="settings.email" type="email" class="setting-input" /></div>
              <div class="setting-row"><label>手机号</label><span class="setting-value">138****5678</span><FcButton link size="small" type="primary">修改</FcButton></div>
              <div class="setting-row"><label>角色</label><FcTag color="warning" size="sm">VIP 用户</FcTag></div>
            </div>
          </FcSection>
        </template>

        <!-- 安全设置 -->
        <template v-if="activeSection === 'security'">
          <FcSection>
            <template #header><span class="sec-title">安全设置</span></template>
            <div class="setting-rows">
              <div class="setting-row">
                <label>登录密码</label>
                <span class="setting-desc">上次修改: 30 天前</span>
                <FcButton size="small">修改密码</FcButton>
              </div>
              <div class="setting-row">
                <label>两步验证</label>
                <span class="setting-desc">已启用 — 通过手机验证码</span>
                <FcSwitch :model-value="true" />
              </div>
              <div class="setting-row">
                <label>登录设备</label>
                <span class="setting-desc">3 台设备在线</span>
                <FcButton link size="small" type="primary">管理</FcButton>
              </div>
              <div class="setting-row">
                <label>登录日志</label>
                <span class="setting-desc">查看最近登录记录</span>
                <FcButton link size="small" type="primary">查看</FcButton>
              </div>
            </div>
          </FcSection>
        </template>

        <!-- 通知设置 -->
        <template v-if="activeSection === 'notifications'">
          <FcSection>
            <template #header><span class="sec-title">通知偏好</span></template>
            <div class="setting-rows">
              <div class="setting-row"><label>作品完成通知</label><FcSwitch v-model="settings.notifyComplete" /></div>
              <div class="setting-row"><label>点赞与评论</label><FcSwitch v-model="settings.notifySocial" /></div>
              <div class="setting-row"><label>系统公告</label><FcSwitch v-model="settings.notifySystem" /></div>
              <div class="setting-row"><label>营销推送</label><FcSwitch :model-value="false" /></div>
              <div class="setting-row"><label>邮件通知</label><FcSwitch v-model="settings.notifyEmail" /></div>
            </div>
          </FcSection>
        </template>

        <!-- 外观设置 -->
        <template v-if="activeSection === 'appearance'">
          <FcSection>
            <template #header><span class="sec-title">外观设置</span></template>
            <div class="setting-rows">
              <div class="setting-row">
                <label>主题模式</label>
                <div class="theme-options">
                  <div class="theme-opt" :class="{ active: settings.theme === 'light' }" @click="settings.theme = 'light'"><i class="ri-sun-line" /> 浅色</div>
                  <div class="theme-opt" :class="{ active: settings.theme === 'dark' }" @click="settings.theme = 'dark'"><i class="ri-moon-line" /> 深色</div>
                  <div class="theme-opt" :class="{ active: settings.theme === 'auto' }" @click="settings.theme = 'auto'"><i class="ri-computer-line" /> 跟随系统</div>
                </div>
              </div>
              <div class="setting-row">
                <label>品牌主题</label>
                <div class="brand-options">
                  <div v-for="b in brands" :key="b.id" class="brand-opt" :class="{ active: settings.brand === b.id }" @click="settings.brand = b.id">
                    <span class="brand-dot" :style="{ background: b.color }" />{{ b.name }}
                  </div>
                </div>
              </div>
              <div class="setting-row"><label>紧凑模式</label><FcSwitch v-model="settings.compact" /></div>
            </div>
          </FcSection>
        </template>

        <!-- 创作设置 -->
        <template v-if="activeSection === 'creation'">
          <FcSection>
            <template #header><span class="sec-title">创作偏好</span></template>
            <div class="setting-rows">
              <div class="setting-row"><label>默认模型</label><FcSelect v-model="settings.defaultModel" size="small" style="width:160px"><option value="flux-pro">FLUX Pro</option><option value="sdxl">SDXL</option><option value="kling">Kling v1.6</option></FcSelect></div>
              <div class="setting-row"><label>默认尺寸</label><FcSelect v-model="settings.defaultSize" size="small" style="width:160px"><option value="16:9">16:9 宽屏</option><option value="1:1">1:1 正方</option><option value="9:16">9:16 竖屏</option></FcSelect></div>
              <div class="setting-row"><label>自动保存草稿</label><FcSwitch v-model="settings.autoSave" /></div>
              <div class="setting-row"><label>添加水印</label><FcSwitch :model-value="false" /></div>
              <div class="setting-row"><label>成人内容过滤</label><FcSwitch v-model="settings.nsfwFilter" /></div>
            </div>
          </FcSection>
        </template>

        <!-- 存储 -->
        <template v-if="activeSection === 'storage'">
          <FcSection>
            <template #header><span class="sec-title">存储管理</span></template>
            <div class="storage-overview">
              <div class="storage-bar"><div class="storage-fill" :style="{ width: '45%' }" /></div>
              <div class="storage-info">已使用 4.5 GB / 10 GB</div>
            </div>
            <div class="setting-rows">
              <div class="setting-row"><label>作品文件</label><span class="setting-desc">2.8 GB</span></div>
              <div class="setting-row"><label>素材库</label><span class="setting-desc">1.2 GB</span></div>
              <div class="setting-row"><label>缓存文件</label><span class="setting-desc">0.5 GB</span><FcButton size="small" @click="clearCache">清除缓存</FcButton></div>
            </div>
          </FcSection>
        </template>

        <div class="save-bar">
          <FcButton type="primary" @click="saveSettings">保存设置</FcButton>
          <FcButton @click="resetSettings">重置</FcButton>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevSettingsPage' })
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcButton, FcTag, FcSelect, FcSwitch } from '@/components/sdk'

const router = useRouter()
const activeSection = ref('account')

const sections = [
  { key: 'account', label: '账户', icon: 'ri-user-line' },
  { key: 'security', label: '安全', icon: 'ri-shield-check-line' },
  { key: 'notifications', label: '通知', icon: 'ri-notification-3-line' },
  { key: 'appearance', label: '外观', icon: 'ri-palette-line' },
  { key: 'creation', label: '创作', icon: 'ri-sparkling-line' },
  { key: 'storage', label: '存储', icon: 'ri-hard-drive-2-line' },
]

const brands = [
  { id: 'ldx2', name: 'LDX2', color: '#ff6b00' },
  { id: 'blue', name: '极光蓝', color: '#007aff' },
  { id: 'green', name: '森林绿', color: '#34c759' },
  { id: 'purple', name: '星空紫', color: '#af52de' },
]

const settings = reactive({
  nickname: 'Demo 用户', email: 'demo@example.com',
  theme: 'light', brand: 'ldx2', compact: false,
  notifyComplete: true, notifySocial: true, notifySystem: true, notifyEmail: false,
  defaultModel: 'flux-pro', defaultSize: '16:9', autoSave: true, nsfwFilter: true,
})

function saveSettings() { ElMessage.success('设置已保存') }
function resetSettings() { ElMessage.info('设置已重置') }
function clearCache() { ElMessage.success('缓存已清除') }
</script>

<style scoped lang="scss">
.settings-page { display: flex; flex-direction: column; gap: 16px; }
.settings-layout { display: grid; grid-template-columns: 220px 1fr; gap: 24px; @media (max-width: 768px) { grid-template-columns: 1fr; } }

.settings-nav { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: var(--el-bg-color, #fff); border: 1px solid var(--app-section-border-color); border-radius: var(--app-radius-lg, 16px); }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: var(--app-radius-md, 12px);
  font-size: 14px; color: var(--app-text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: all 0.15s;
  i { font-size: 18px; }
  &:hover { background: var(--app-bg-muted, #f5f5f7); color: var(--app-text); }
  &.active { background: var(--app-primary-lightest, rgba(255,107,0,0.08)); color: var(--app-primary); font-weight: 600; }
}

.settings-content { display: flex; flex-direction: column; gap: 16px; }
.sec-title { font-size: 16px; font-weight: 600; color: var(--app-text); }

.setting-rows { display: flex; flex-direction: column; }
.setting-row {
  display: flex; align-items: center; gap: 16px; padding: 14px 0;
  border-bottom: 1px solid var(--app-border-light);
  &:last-child { border-bottom: none; }
  label { font-size: 14px; font-weight: 500; color: var(--app-text); min-width: 120px; }
}
.setting-input {
  flex: 1; max-width: 300px; padding: 8px 12px; border: 1px solid var(--app-section-border-color);
  border-radius: 8px; font-size: 14px; color: var(--app-text); background: var(--el-bg-color, #fff); outline: none;
  &:focus { border-color: var(--app-primary); }
}
.setting-value { font-size: 14px; color: var(--app-text-secondary); flex: 1; }
.setting-desc { font-size: 13px; color: var(--app-text-tertiary); flex: 1; }
.avatar-edit { display: flex; align-items: center; gap: 12px; flex: 1; }

.theme-options, .brand-options { display: flex; gap: 8px; flex: 1; }
.theme-opt, .brand-opt {
  display: flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid var(--app-section-border-color);
  border-radius: 8px; font-size: 13px; color: var(--app-text-secondary); cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--app-primary-lightest); }
  &.active { border-color: var(--app-primary); color: var(--app-primary); background: var(--app-primary-lightest, rgba(255,107,0,0.08)); }
}
.brand-dot { width: 12px; height: 12px; border-radius: 50%; }

.storage-overview { margin-bottom: 16px; }
.storage-bar { height: 8px; background: var(--app-bg-muted, #f5f5f7); border-radius: 4px; overflow: hidden; }
.storage-fill { height: 100%; background: var(--app-primary); border-radius: 4px; transition: width 0.3s; }
.storage-info { font-size: 12px; color: var(--app-text-tertiary); margin-top: 6px; }

.save-bar { display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--app-border-light); }
</style>
