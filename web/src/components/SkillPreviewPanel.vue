<script setup lang="ts">
/**
 * [new] Skill zip 预览面板(镜像 AppSkillCatalogService.PreviewView):
 * 清单卡(manifest)+ 文件清单 + 警告/错误两栏列表;valid=false 时错误置顶
 * 并禁用后续确认语义(由调用方依据 valid 控制)。dryRun 零落库。
 */
import { computed } from 'vue'
import type { SkillPreviewView } from '@/api/types'

const props = defineProps<{ preview: SkillPreviewView }>()

const totalKb = computed(() => (props.preview.totalBytes / 1024).toFixed(1))
</script>

<template>
  <div class="skill-preview" data-testid="skill-preview">
    <div class="badge-row">
      <el-tag :type="preview.valid ? 'success' : 'danger'" effect="dark" size="small">
        {{ preview.valid ? '校验通过' : '校验未通过' }}
      </el-tag>
      <span class="dim">{{ preview.fileName }} · {{ preview.files.length }} 个文件 · {{ totalKb }} KB</span>
    </div>

    <!-- 清单卡 -->
    <el-descriptions v-if="preview.manifest" :column="2" border size="small" class="manifest" title="包清单(skill.json)">
      <el-descriptions-item label="name"><span class="mono">{{ preview.manifest.name }}</span></el-descriptions-item>
      <el-descriptions-item label="displayName">{{ preview.manifest.displayName ?? '—' }}</el-descriptions-item>
      <el-descriptions-item label="description" :span="2">{{ preview.manifest.description ?? '—' }}</el-descriptions-item>
      <el-descriptions-item label="version"><span class="mono">{{ preview.manifest.version ?? '—' }}</span></el-descriptions-item>
    </el-descriptions>
    <el-alert v-else type="error" :closable="false" show-icon title="包清单不可用:未解析出有效 skill.json" />

    <!-- 错误(阻断)/警告(不阻断) -->
    <el-alert
      v-for="(e, i) in preview.errors" :key="`e${i}`"
      type="error" :closable="false" show-icon class="issue"
      :title="`错误:${e}`"
    />
    <el-alert
      v-for="(w, i) in preview.warnings" :key="`w${i}`"
      type="warning" :closable="false" show-icon class="issue"
      :title="`警告:${w}`"
    />
    <p v-if="!preview.errors.length && !preview.warnings.length" class="no-issues">无警告与错误</p>

    <!-- 文件清单 -->
    <el-table :data="preview.files" size="small" class="files" empty-text="包内没有任何文件">
      <el-table-column prop="path" label="文件路径" min-width="200">
        <template #default="{ row }"><span class="mono">{{ row.path }}</span></template>
      </el-table-column>
      <el-table-column prop="encoding" label="编码" width="90" />
      <el-table-column label="大小" width="100">
        <template #default="{ row }">{{ (row.sizeBytes / 1024).toFixed(1) }} KB</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.skill-preview { display: flex; flex-direction: column; gap: 10px; }
.badge-row { display: flex; align-items: center; gap: 8px; }
.dim { color: #909399; font-size: 12px; }
.manifest :deep(.el-descriptions__title) { font-size: 13px; }
.issue { margin: 0; }
.no-issues { margin: 0; color: #909399; font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
</style>
