<template>
  <div class="app-page users-page">
    <FcSectionHeader title="用户管理 (DEMO)" subtitle="Mock 数据演示" :back="true" @back="router.back()">
      <template #actions>
        <div class="search-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input v-model="searchKeyword" type="text" placeholder="搜索用户..." class="search-input" />
        </div>
        <FcButton type="primary" @click="showCreateTip">
          <i class="ri-add-line" /> 创建用户
        </FcButton>
      </template>
    </FcSectionHeader>

    <FcFilterBar>
      <FcFilterButton
        v-for="tab in filterTabs"
        :key="tab.value"
        :active="activeFilter === tab.value"
        @click="activeFilter = tab.value"
      >
        {{ tab.label }}
      </FcFilterButton>
    </FcFilterBar>

    <FcSection>
      <el-scrollbar>
        <el-table class="fc-table users-table" :data="filteredUsers" row-key="id" stripe highlight-current-row :max-height="600">
          <el-table-column label="用户" min-width="180">
            <template #default="{ row }">
              <div class="user-cell">
                <div class="user-avatar-wrapper">
                  <Avatar :src="row.avatar" :name="row.name" size="small" />
                  <span class="user-status" :class="row.status === 0 ? 'active' : 'disabled'"></span>
                </div>
                <div class="user-info">
                  <span class="user-name">{{ row.name }}</span>
                  <span class="user-id">ID: {{ row.id }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="手机号" prop="phone" min-width="120">
            <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
          </el-table-column>

          <el-table-column label="角色" min-width="90">
            <template #default="{ row }">
              <FcTag :color="row.role === 'admin' ? 'danger' : row.role === 'vip' ? 'warning' : 'gray'" size="sm">
                {{ getRoleLabel(row.role) }}
              </FcTag>
            </template>
          </el-table-column>

          <el-table-column label="状态" min-width="90">
            <template #default="{ row }">
              <FcTag :color="row.status === 0 ? 'success' : 'danger'" size="sm">
                {{ row.status === 0 ? '正常' : '禁用' }}
              </FcTag>
            </template>
          </el-table-column>

          <el-table-column label="算力" prop="credits" min-width="80">
            <template #default="{ row }">
              <span class="credits-cell">{{ row.credits }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" min-width="140">
            <template #default="{ row }">
              <div class="actions-cell">
                <FcTooltip content="充值">
                  <button class="action-icon-btn" @click="handleCharge(row)">
                    <i class="ri-money-cny-circle-line" />
                  </button>
                </FcTooltip>
                <FcTooltip :content="row.status === 0 ? '禁用' : '启用'">
                  <button class="action-icon-btn" @click="handleToggle(row)">
                    <i :class="row.status === 0 ? 'ri-lock-line' : 'ri-lock-unlock-line'" />
                  </button>
                </FcTooltip>
              </div>
            </template>
          </el-table-column>
          <template #empty><FcEmpty /></template>
        </el-table>
      </el-scrollbar>

      <div v-if="filteredUsers.length > 0" class="pagination">
        <FcPagination v-model:current-page="page" :page-size="10" :total="filteredUsers.length" layout="total, prev, pager, next" background />
      </div>
    </FcSection>

    <!-- 充值弹窗 -->
    <FcDialog v-model:open="chargeVisible" title="充值" width="480px" append-to-body>
      <template v-if="chargeUser">
        <div class="charge-user-info">
          <Avatar :src="chargeUser.avatar" :name="chargeUser.name" size="medium" />
          <div class="charge-info-text">
            <span class="charge-name">{{ chargeUser.name }}</span>
            <span class="charge-balance">当前余额: {{ chargeUser.credits }} Credits</span>
          </div>
        </div>
        <div class="charge-options">
          <button v-for="opt in [100, 200, 500, 1000]" :key="opt" class="charge-option" :class="{ 'is-selected': chargeAmount === opt }" @click="chargeAmount = opt">
            <span class="option-amount">{{ opt }}</span>
            <span class="option-unit">Credits</span>
          </button>
        </div>
        <div class="charge-summary">
          <span class="summary-label">充值后余额</span>
          <span class="summary-value">{{ (chargeUser?.credits ?? 0) + chargeAmount }} Credits</span>
        </div>
      </template>
      <template #footer>
        <FcButton @click="chargeVisible = false">取消</FcButton>
        <FcButton type="primary" @click="confirmCharge">确认充值</FcButton>
      </template>
    </FcDialog>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevUsersPage' })
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcDialog from '@/components/sdk/overlay/FcDialog.vue'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import { FcTag, FcTooltip, FcPagination, FcEmpty, FcButton } from '@/components/sdk'
import FcSection from '@/components/sdk/section/FcSection.vue'
import FcFilterBar from '@/components/sdk/navigation/FcFilterBar.vue'
import FcFilterButton from '@/components/sdk/navigation/FcFilterButton.vue'

const router = useRouter()
const searchKeyword = ref('')
const activeFilter = ref<string>('all')
const page = ref(1)
const chargeVisible = ref(false)
const chargeUser = ref<MockUser | null>(null)
const chargeAmount = ref(100)

interface MockUser {
  id: string; name: string; phone: string; role: string; status: number; credits: number; avatar: string;
}

const mockUsers = ref<MockUser[]>(generateMockUsers())

function generateMockUsers(): MockUser[] {
  const names = ['张三', '李四', '王五', '赵六', '孙七', '周八', '吴九', '郑十', '陈一一', '林二二', '黄三三', '刘四四', '杨五五', '何六六', '马七七']
  const roles = ['user', 'user', 'user', 'vip', 'user', 'admin', 'user', 'vip', 'user', 'user', 'admin', 'user', 'vip', 'user', 'user']
  return names.map((name, i) => ({
    id: `U${String(i + 1).padStart(6, '0')}`,
    name,
    phone: `138${String(10000000 + i * 1234567).slice(0, 8)}`,
    role: roles[i] ?? 'user',
    status: i === 5 ? 1 : 0,
    credits: Math.floor(Math.random() * 10000),
    avatar: `https://picsum.photos/seed/user${i + 1}/100/100`,
  }))
}

const filterTabs = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '禁用', value: 'disabled' },
  { label: 'VIP', value: 'vip' },
]

const filteredUsers = computed(() => {
  let result = mockUsers.value
  if (activeFilter.value === 'normal') result = result.filter(u => u.status === 0)
  else if (activeFilter.value === 'disabled') result = result.filter(u => u.status === 1)
  else if (activeFilter.value === 'vip') result = result.filter(u => u.role === 'vip')
  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase()
    result = result.filter(u => u.name.includes(kw) || u.phone.includes(kw) || u.id.toLowerCase().includes(kw))
  }
  return result
})

function getRoleLabel(role: string) {
  return role === 'admin' ? '管理员' : role === 'vip' ? 'VIP' : '用户'
}

function maskPhone(phone: string) {
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function showCreateTip() { ElMessage.info('DEMO: 创建用户功能演示') }

function handleCharge(user: MockUser) {
  chargeUser.value = user
  chargeAmount.value = 100
  chargeVisible.value = true
}

function confirmCharge() {
  if (chargeUser.value) {
    chargeUser.value.credits += chargeAmount.value
    ElMessage.success(`已为 ${chargeUser.value.name} 充值 ${chargeAmount.value} Credits`)
  }
  chargeVisible.value = false
}

function handleToggle(user: MockUser) {
  user.status = user.status === 0 ? 1 : 0
  ElMessage.success(user.status === 0 ? `${user.name} 已启用` : `${user.name} 已禁用`)
}
</script>

<style scoped lang="scss">
.users-page {
  display: flex;
  flex-direction: column;
  gap: var(--app-block-mb);
  min-width: 0;
}

.search-wrapper {
  position: relative;
  width: 320px;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  color: var(--app-text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 10px 16px 10px 48px;
  background: var(--app-bg-muted, #f5f5f7);
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: var(--app-radius-input, var(--app-radius-sm, 8px));
  font-size: var(--app-font-size-base);
  color: var(--app-text);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  &:focus {
    border-color: var(--app-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-primary) 15%, transparent);
  }
  &::placeholder { color: var(--app-text-tertiary); }
}

.pagination { display: flex; justify-content: center; margin-top: 16px; }

.user-cell { display: flex; align-items: center; gap: 12px; }
.user-avatar-wrapper { position: relative; flex-shrink: 0; }
.user-status {
  position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;
  &.active { background: var(--color-success); }
  &.disabled { background: var(--color-error); }
}
.user-info { display: flex; flex-direction: column; gap: 2px; }
.user-name { font-size: 14px; font-weight: 500; color: var(--app-text); }
.user-id { font-size: 12px; color: var(--app-text-tertiary); }
.credits-cell { font-weight: 600; color: var(--app-text); }
.actions-cell { display: flex; gap: 4px; }

.action-icon-btn {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--app-radius-sm, 6px); color: var(--app-text-secondary);
  background: none; border: none; cursor: pointer; transition: all 0.15s;
  i { font-size: 16px; }
  &:hover { background: var(--app-sidebar-item-hover-bg); color: var(--app-text); }
}

.charge-user-info {
  display: flex; align-items: center; gap: 16px; padding: 20px;
  background: var(--app-bg-muted, #f5f5f7); border-radius: var(--app-radius-lg, 16px); margin-bottom: 20px;
}
.charge-info-text { display: flex; flex-direction: column; gap: 4px; }
.charge-name { font-size: 16px; font-weight: 600; color: var(--app-text); }
.charge-balance { font-size: 13px; color: var(--app-text-tertiary); }

.charge-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.charge-option {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 16px 12px;
  background: var(--app-bg-muted, #f5f5f7); border: 2px solid transparent;
  border-radius: var(--app-radius-md, 12px); cursor: pointer; transition: all 0.2s;
  &:hover { background: var(--app-section-border-color); }
  &.is-selected { background: var(--app-primary-lightest, rgba(255,107,0,0.08)); border-color: var(--app-primary); }
}
.option-amount { font-size: 20px; font-weight: 700; color: var(--app-text); }
.option-unit { font-size: 12px; color: var(--app-text-tertiary); }

.charge-summary {
  display: flex; justify-content: space-between; align-items: center; padding: 16px 20px;
  background: var(--app-primary-lightest, rgba(255,107,0,0.08)); border-radius: var(--app-radius-md, 12px);
}
.summary-label { font-size: 14px; color: var(--app-text-secondary); }
.summary-value { font-size: 20px; font-weight: 700; color: var(--app-primary); }
</style>
