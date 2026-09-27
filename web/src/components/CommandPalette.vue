<script setup lang="ts">
/**
 * [C1 · P3 2026-09-27] ⌘K 命令面板:路由直达 + 应用上下文切换。
 * Cmd/Ctrl+K 开关(AdminLayout 全局监听);↑↓ 选择、Enter 执行、Esc 关闭;
 * 关键词大小写不敏感包含匹配。选项 = 侧栏全部路由(按分组标注)+ 应用切换。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppContextStore } from '@/stores/appContext'

const props = defineProps<{
  open: boolean
  groups: { title: string; items: { path: string; title: string }[] }[]
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const appContext = useAppContextStore()

const keyword = ref('')
const cursor = ref(0)

interface PaletteOption {
  key: string
  label: string
  hint: string
  run: () => void
}

const options = computed<PaletteOption[]>(() => {
  const routeOptions = props.groups.flatMap((group) =>
    group.items.map((item) => ({
      key: `route:${item.path}`,
      label: item.title,
      hint: group.title,
      run: () => router.push(item.path),
    })))
  const appOptions = appContext.apps.map((app) => ({
    key: `app:${app.id}`,
    label: `切换应用:${app.name}(${app.appKey})`,
    hint: `id=${app.id}`,
    run: () => appContext.selectApp(app.id),
  }))
  const all = [...routeOptions, ...appOptions]
  const query = keyword.value.trim().toLowerCase()
  if (!query) return all
  return all.filter((option) =>
    `${option.label} ${option.hint}`.toLowerCase().includes(query))
})

watch([keyword, () => props.open], () => {
  cursor.value = 0
})

function close() {
  keyword.value = ''
  cursor.value = 0
  emit('update:open', false)
}

function choose(option: PaletteOption) {
  close()
  option.run()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    emit('update:open', !props.open)
    return
  }
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    cursor.value = Math.min(cursor.value + 1, options.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    cursor.value = Math.max(cursor.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = options.value[cursor.value]
    if (option) choose(option)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cmdk"
      data-testid="cmdk"
      @click.self="close"
    >
      <div class="cmdk__panel">
        <input
          v-model="keyword"
          class="cmdk__input"
          placeholder="搜索页面或应用(↑↓ 选择,Enter 执行,Esc 关闭)"
          data-testid="cmdk-input"
          autofocus
        />
        <ul class="cmdk__list">
          <li
            v-for="(option, index) in options"
            :key="option.key"
            class="cmdk__item"
            :class="{ 'is-active': index === cursor }"
            :data-testid="`cmdk-option-${index}`"
            @mouseenter="cursor = index"
            @click="choose(option)"
          >
            <span class="cmdk__label">{{ option.label }}</span>
            <span class="cmdk__hint">{{ option.hint }}</span>
          </li>
          <li v-if="options.length === 0" class="cmdk__item cmdk__empty">
            无匹配项
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmdk {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}
.cmdk__panel {
  width: 560px;
  max-width: 92vw;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
  overflow: hidden;
}
.cmdk__input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 16px;
  font-size: 14px;
  border: none;
  outline: none;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: transparent;
  color: var(--el-text-color-primary);
}
.cmdk__list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 46vh;
  overflow: auto;
}
.cmdk__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.cmdk__item.is-active {
  background: var(--el-color-primary-light-9);
}
.cmdk__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.cmdk__empty {
  justify-content: center;
  color: var(--el-text-color-secondary);
  cursor: default;
}
</style>
