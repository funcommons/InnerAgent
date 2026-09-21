<template>
  <div class="app-page form-page">
    <FcSectionHeader title="表单向导 (DEMO)" subtitle="多步骤 + 校验 + 预览确认" :back="true" @back="router.back()" />

    <FcSection class="form-container">
      <!-- 步骤条 -->
      <div class="steps-bar">
        <div v-for="(s, i) in steps" :key="i" class="step" :class="{ active: step === i, done: step > i }">
          <div class="step-dot">{{ step > i ? '✓' : i + 1 }}</div>
          <span class="step-label">{{ s }}</span>
        </div>
        <div class="step-line" :style="{ width: `${(step / (steps.length - 1)) * 100}%` }" />
      </div>

      <!-- Step 1: 基本信息 -->
      <div v-if="step === 0" class="form-step">
        <h3 class="step-title">基本信息</h3>
        <div class="form-grid">
          <div class="field">
            <label>项目名称 <span class="req">*</span></label>
            <input v-model="form.name" type="text" class="fc-field" :class="{ error: errors.name }" placeholder="输入项目名称" />
            <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label>项目类型</label>
            <FcSelect v-model="form.type" class="fc-field">
              <option value="video">视频创作</option>
              <option value="image">图片创作</option>
              <option value="music">音乐创作</option>
            </FcSelect>
          </div>
          <div class="field full">
            <label>项目描述</label>
            <textarea v-model="form.description" class="fc-field" rows="3" placeholder="简要描述项目目标..." />
          </div>
          <div class="field">
            <label>截止日期</label>
            <input v-model="form.deadline" type="date" class="fc-field" />
          </div>
          <div class="field">
            <label>优先级</label>
            <FcRadioGroup v-model="form.priority" variant="button" size="small">
              <FcRadioButton value="low">低</FcRadioButton>
              <FcRadioButton value="medium">中</FcRadioButton>
              <FcRadioButton value="high">高</FcRadioButton>
            </FcRadioGroup>
          </div>
        </div>
      </div>

      <!-- Step 2: 创作参数 -->
      <div v-if="step === 1" class="form-step">
        <h3 class="step-title">创作参数</h3>
        <div class="form-grid">
          <div class="field">
            <label>AI 模型</label>
            <FcSelect v-model="form.model" class="fc-field">
              <option value="flux-pro">FLUX Pro</option>
              <option value="sdxl">SDXL</option>
              <option value="kling">Kling v1.6</option>
            </FcSelect>
          </div>
          <div class="field">
            <label>输出尺寸</label>
            <FcSelect v-model="form.size" class="fc-field">
              <option value="1:1">1:1 (1024×1024)</option>
              <option value="16:9">16:9 (1920×1080)</option>
              <option value="9:16">9:16 (1080×1920)</option>
            </FcSelect>
          </div>
          <div class="field full">
            <label>提示词 <span class="req">*</span></label>
            <textarea v-model="form.prompt" class="fc-field" :class="{ error: errors.prompt }" rows="4" placeholder="详细描述创作内容..." />
            <span v-if="errors.prompt" class="field-error">{{ errors.prompt }}</span>
          </div>
          <div class="field full">
            <label>负面提示词</label>
            <textarea v-model="form.negativePrompt" class="fc-field" rows="2" placeholder="不希望出现的内容..." />
          </div>
          <div class="field">
            <label>CFG Scale</label>
            <div class="slider-field">
              <input v-model.number="form.cfg" type="range" min="1" max="20" step="0.5" />
              <span class="slider-val">{{ form.cfg }}</span>
            </div>
          </div>
          <div class="field">
            <label>采样步数</label>
            <div class="slider-field">
              <input v-model.number="form.steps" type="range" min="1" max="50" />
              <span class="slider-val">{{ form.steps }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: 确认预览 -->
      <div v-if="step === 2" class="form-step">
        <h3 class="step-title">确认信息</h3>
        <div class="confirm-grid">
          <div class="confirm-section">
            <h4>基本信息</h4>
            <div class="confirm-row"><span>项目名称</span><strong>{{ form.name }}</strong></div>
            <div class="confirm-row"><span>项目类型</span><strong>{{ typeLabels[form.type] }}</strong></div>
            <div class="confirm-row"><span>优先级</span><FcTag :color="form.priority === 'high' ? 'danger' : form.priority === 'medium' ? 'warning' : 'gray'" size="sm">{{ priorityLabels[form.priority] }}</FcTag></div>
            <div v-if="form.deadline" class="confirm-row"><span>截止日期</span><strong>{{ form.deadline }}</strong></div>
            <div v-if="form.description" class="confirm-row full"><span>描述</span><p>{{ form.description }}</p></div>
          </div>
          <div class="confirm-section">
            <h4>创作参数</h4>
            <div class="confirm-row"><span>模型</span><strong>{{ form.model }}</strong></div>
            <div class="confirm-row"><span>尺寸</span><strong>{{ form.size }}</strong></div>
            <div class="confirm-row"><span>CFG</span><strong>{{ form.cfg }}</strong></div>
            <div class="confirm-row"><span>步数</span><strong>{{ form.steps }}</strong></div>
            <div class="confirm-row full"><span>提示词</span><p>{{ form.prompt }}</p></div>
          </div>
        </div>
        <div class="confirm-cost">
          <i class="ri-coin-line" /> 预计消耗 <strong>{{ estimatedCost }}</strong> Credits
        </div>
      </div>

      <!-- Step 4: 完成 -->
      <div v-if="step === 3" class="form-step done-step">
        <div class="done-icon"><i class="ri-checkbox-circle-fill" /></div>
        <h3>提交成功！</h3>
        <p>你的创作任务已提交，预计 3-5 分钟完成。</p>
        <div class="done-actions">
          <FcButton type="primary" @click="step = 0">创建新任务</FcButton>
          <FcButton @click="router.back()">返回</FcButton>
        </div>
      </div>

      <!-- 操作栏 -->
      <div v-if="step < 3" class="form-actions">
        <FcButton v-if="step > 0" @click="step--"><i class="ri-arrow-left-line" /> 上一步</FcButton>
        <div v-else />
        <FcButton v-if="step < 2" type="primary" @click="nextStep">下一步 <i class="ri-arrow-right-line" /></FcButton>
        <FcButton v-else type="primary" @click="handleSubmit"><i class="ri-check-line" /> 确认提交</FcButton>
      </div>
    </FcSection>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevFormPage' })
import { ref, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import FcSectionHeader from '@/components/sdk/section/FcSectionHeader.vue'
import FcSection from '@/components/sdk/section/FcSection.vue'
import { FcButton, FcTag, FcSelect, FcRadioGroup, FcRadioButton } from '@/components/sdk'

const router = useRouter()
const step = ref(0)
const steps = ['基本信息', '创作参数', '确认提交']

const typeLabels: Record<string, string> = { video: '视频创作', image: '图片创作', music: '音乐创作' }
const priorityLabels: Record<string, string> = { low: '低', medium: '中', high: '高' }

const form = reactive({
  name: '', type: 'image', description: '', deadline: '', priority: 'medium',
  model: 'flux-pro', size: '16:9', prompt: '', negativePrompt: '', cfg: 7.5, steps: 30,
})

const errors = reactive<Record<string, string>>({ name: '', prompt: '' })

const estimatedCost = computed(() => form.steps * 2 * (form.size === '16:9' ? 2 : 1))

function nextStep() {
  errors.name = ''
  errors.prompt = ''
  if (step.value === 0 && !form.name.trim()) { errors.name = '请输入项目名称'; return }
  if (step.value === 1 && !form.prompt.trim()) { errors.prompt = '请输入提示词'; return }
  step.value++
}

function handleSubmit() {
  step.value = 3
  ElMessage.success('任务已提交')
}
</script>

<style scoped lang="scss">
.form-page { display: flex; flex-direction: column; gap: 16px; }
.form-container { padding: 32px; }

.steps-bar { display: flex; justify-content: space-between; position: relative; margin-bottom: 32px; padding: 0 20px; }
.step { display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 1; }
.step-dot {
  width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; background: var(--app-bg-muted, #f5f5f7); color: var(--app-text-tertiary);
  border: 2px solid var(--app-section-border-color); transition: all 0.2s;
  .step.active & { background: var(--app-primary); color: #fff; border-color: var(--app-primary); }
  .step.done & { background: var(--el-color-success); color: #fff; border-color: var(--el-color-success); }
}
.step-label { font-size: 12px; color: var(--app-text-tertiary); .step.active & { color: var(--app-primary); font-weight: 600; } }
.step-line { position: absolute; top: 16px; left: 20px; height: 2px; background: var(--app-primary); transition: width 0.3s; z-index: 0; }

.step-title { font-size: 18px; font-weight: 600; color: var(--app-text); margin: 0 0 20px; }

.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.field { display: flex; flex-direction: column; gap: 6px; &.full { grid-column: 1 / -1; }
  label { font-size: 14px; font-weight: 500; color: var(--app-text); }
  .req { color: var(--el-color-danger); }
}
.fc-field {
  padding: 10px 14px; border: 1px solid var(--app-section-border-color); border-radius: var(--app-radius-md, 12px);
  font-size: 14px; color: var(--app-text); background: var(--el-bg-color, #fff); outline: none; transition: border-color 0.2s;
  &:focus { border-color: var(--app-primary); }
  &.error { border-color: var(--el-color-danger); }
}
.field-error { font-size: 12px; color: var(--el-color-danger); }
.slider-field { display: flex; align-items: center; gap: 12px; input[type="range"] { flex: 1; accent-color: var(--app-primary); } }
.slider-val { font-size: 14px; font-weight: 600; color: var(--app-text); min-width: 30px; }

.confirm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.confirm-section { h4 { font-size: 14px; font-weight: 600; color: var(--app-text); margin: 0 0 12px; } }
.confirm-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--app-border-light);
  &.full { flex-direction: column; align-items: flex-start; gap: 4px; p { margin: 0; font-size: 14px; color: var(--app-text); } }
  span { font-size: 13px; color: var(--app-text-tertiary); }
  strong { font-size: 14px; color: var(--app-text); }
}
.confirm-cost { margin-top: 20px; padding: 16px; background: var(--app-primary-lightest, rgba(255,107,0,0.08)); border-radius: 12px; text-align: center; font-size: 15px; color: var(--app-text); strong { color: var(--app-primary); font-size: 20px; } }

.done-step { text-align: center; padding: 40px 0; }
.done-icon { font-size: 64px; color: var(--el-color-success); margin-bottom: 16px; }
.done-step h3 { font-size: 22px; font-weight: 700; color: var(--app-text); margin: 0 0 8px; }
.done-step p { font-size: 15px; color: var(--app-text-secondary); margin: 0 0 24px; }
.done-actions { display: flex; gap: 12px; justify-content: center; }

.form-actions { display: flex; justify-content: space-between; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--app-border-light); }
</style>
