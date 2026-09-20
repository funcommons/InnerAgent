<script setup lang="ts">
/**
 * [new] 环境状态灯(优化建议 #1):替换常驻「mock 后端」徽标。
 * 绿点「已连接」= api 层健康探测判定真实服务可达;黄点「演示数据」= msw 演示后端;
 * 红点「服务不可达」;灰点「检测中…」。数据源见 src/api/health.ts。
 */
import { computed } from 'vue'
import { backendMode, backendNote } from '@/api/health'

interface Meta {
  label: string
  cls: string
  fallback: string
}

const META: Record<string, Meta> = {
  connected: { label: '已连接', cls: 'ok', fallback: '真实服务已连接' },
  demo: { label: '演示数据', cls: 'demo', fallback: '演示后端接管中' },
  offline: { label: '服务不可达', cls: 'down', fallback: '最近请求无响应' },
  unknown: { label: '检测中…', cls: 'idle', fallback: '正在探测后端可达性' },
}

const meta = computed(() => META[backendMode.value] ?? META.unknown!)
const tip = computed(() => `${meta.value.fallback}:${backendNote.value || meta.value.fallback}`)
</script>

<template>
  <el-tooltip :content="tip" placement="bottom">
    <span class="env-badge" :class="meta.cls" data-testid="env-badge">
      <span class="env-dot" />
      <span class="env-label">{{ meta.label }}</span>
    </span>
  </el-tooltip>
</template>

<style scoped>
.env-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 12px;
  border: 1px solid #e4e7ed;
  background: #fff;
  cursor: default;
}
.env-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.env-badge.ok .env-dot {
  background: #67c23a;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.18);
}
.env-badge.demo .env-dot {
  background: #e6a23c;
  box-shadow: 0 0 0 3px rgba(230, 162, 60, 0.18);
}
.env-badge.down .env-dot {
  background: #f56c6c;
  box-shadow: 0 0 0 3px rgba(245, 108, 108, 0.18);
}
.env-badge.idle .env-dot {
  background: #c0c4cc;
}
.env-label {
  color: #606266;
  line-height: 22px;
}
</style>
