<script setup lang="ts">
/**
 * [new] Skill 详情抽屉(AdminSkillController GET /{id};含全部文件内容,
 * 总量受导入 128KB 上限约束;utf-8 文本直接展示,base64 仅示占位)。
 */
import { computed, ref, watch } from 'vue'
import { skillAdminApi } from '@/api/admin'
import { apiErrorMessage } from '@/stores/apps'
import { ElMessage } from 'element-plus'
import type { SkillDetailView } from '@/api/types'

const visible = defineModel<boolean>('visible', { required: true })
const props = defineProps<{ skillId: number | null }>()

const loading = ref(false)
const detail = ref<SkillDetailView | null>(null)

watch(() => [props.skillId, visible.value] as const, async ([id, show]) => {
  if (!show || id === null) return
  loading.value = true
  detail.value = null
  try {
    detail.value = await skillAdminApi.get(id)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Skill 详情加载失败'))
    visible.value = false
  } finally {
    loading.value = false
  }
})

const currentFile = ref<string | null>(null)
const fileContent = computed(() =>
  detail.value?.files.find(f => f.path === currentFile.value) ?? null)
</script>

<template>
  <el-drawer v-model="visible" :title="`Skill 详情:${detail?.skill.displayName ?? detail?.skill.name ?? ''}`" size="560px">
    <div v-loading="loading">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="name"><span class="mono">{{ detail.skill.name }}</span></el-descriptions-item>
          <el-descriptions-item label="版本"><span class="mono">{{ detail.skill.version ?? '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="detail.skill.active ? 'success' : 'info'" size="small">
              {{ detail.skill.active ? '已激活' : '未激活' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="来源">{{ detail.skill.source }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">{{ detail.skill.description ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="内容指纹" :span="2">
            <span class="mono dim">{{ detail.skill.contentSha256 }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="files-head">
          <span>文件清单({{ detail.files.length }})</span>
          <el-select v-if="detail.files.length" v-model="currentFile" size="small" class="file-select">
            <el-option v-for="f in detail.files" :key="f.path" :label="f.path" :value="f.path" />
          </el-select>
        </div>
        <pre v-if="fileContent && fileContent.encoding === 'utf-8'" class="file-content mono">{{ fileContent.content }}</pre>
        <div v-else-if="fileContent" class="file-content dim">二进制文件(base64 编码存储,{{ fileContent.sizeBytes }} 字节)不在管理站预览</div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.dim { color: #909399; }
.files-head {
  display: flex; align-items: center; justify-content: space-between;
  margin: 16px 0 8px; color: #606266; font-size: 13px;
}
.file-select { width: 240px; }
.file-content {
  margin: 0; padding: 12px; background: #f5f7fa; border-radius: 6px;
  max-height: 420px; overflow: auto; white-space: pre-wrap; word-break: break-all;
  font-size: 12px; line-height: 1.6; color: #303133;
}
</style>
