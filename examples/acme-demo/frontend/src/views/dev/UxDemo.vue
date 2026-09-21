<template>
  <div class="ux-demo">
    <FcSectionHeader title="UX 能力演示" subtitle="Phase 1 全部 17 项能力的可交互入口 · Cmd/Ctrl+K 随时唤起命令面板" :back="true" @back="router.back()" />

    <!-- ① 错误边界 (#7) -->
    <FcSection>
      <template #header><span class="sec-title">① 错误边界 + 重试</span></template>
      <p class="sec-desc">点击下面按钮主动抛错, 验证错误边界降级 + Retry</p>
      <div class="row">
        <FcButton type="danger" @click="boom = true">触发渲染错误</FcButton>
        <FcButton @click="boom = false">恢复</FcButton>
      </div>
      <FcErrorBoundary class="boundary-box">
        <div v-if="boom" class="boom-child">{{ doBoom() }}</div>
        <div v-else class="boundary-box__ok">正常状态 — 点上面按钮触发错误</div>
      </FcErrorBoundary>
    </FcSection>

    <!-- ② 草稿自动恢复 (#10) -->
    <FcSection>
      <template #header><span class="sec-title">② 草稿自动恢复</span></template>
      <p class="sec-desc">输入内容, 关闭 tab 再开, 会看到恢复黄条</p>
      <FcFormDraftBanner :visible="draft.hasDraft.value" @restore="onRestore" @discard="draft.discard()" />
      <el-input v-model="draftForm.note" class="fc-input" type="textarea" :rows="3" placeholder="随便写点..." />
      <div class="row" style="margin-top: 12px">
        <FcButton size="sm" @click="draft.flush()">手动保存</FcButton>
        <FcButton size="sm" variant="secondary" @click="draft.discard()">丢弃</FcButton>
        <span class="hint" v-if="draft.savedAt.value">已自动保存于 {{ formatTime(draft.savedAt.value) }}</span>
      </div>
    </FcSection>

    <!-- ③ 复制即反馈 (#22) -->
    <FcSection>
      <template #header><span class="sec-title">③ 复制即反馈</span></template>
      <p class="sec-desc">点 ID/邮箱自动复制 + toast</p>
      <div class="row">
        <code class="copyable" @click="onCopy('SK-7A2X-9BNE-PLQM')">SK-7A2X-9BNE-PLQM</code>
        <code class="copyable" @click="onCopy('hello@acme-demo.example.com')">hello@acme-demo.example.com</code>
      </div>
    </FcSection>

    <!-- ④ 命令面板 (#8) -->
    <FcSection>
      <template #header><span class="sec-title">④ 命令面板</span></template>
      <p class="sec-desc">点按钮或按 Cmd/Ctrl+K 唤起, 模糊搜索执行命令</p>
      <div class="row">
        <FcButton type="primary" @click="openPalette">打开命令面板</FcButton>
        <span class="hint">已注册 6 条命令, 试试搜 "新建" / "复制" / "撤销"</span>
      </div>
    </FcSection>

    <!-- ⑤ Excel 粘贴 (#11) -->
    <FcSection>
      <template #header><span class="sec-title">⑤ Excel 粘贴解析</span></template>
      <p class="sec-desc">从 Excel 复制 tab 分隔多行多列, 粘贴到下面自动解析</p>
      <el-input
        v-model="pasteRaw"
        class="fc-input"
        type="textarea"
        :rows="4"
        placeholder="按 Tab 分隔, 每行一条, 例如:&#10;name&#9;description&#9;price&#10;item A&#9;first item&#9;100"
        @paste="onPaste"
      />
      <div v-if="parsedRows.length" class="parsed-block">
        <strong>解析结果 ({{ parsedRows.length }} 行):</strong>
        <table class="result-table">
          <thead>
            <tr><th>name</th><th>description</th><th>price</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in parsedRows.slice(0, 5)" :key="i">
              <td>{{ row.name }}</td><td>{{ row.description }}</td><td>{{ row.price }}</td>
            </tr>
          </tbody>
        </table>
        <span v-if="parsedRows.length > 5" class="hint">还有 {{ parsedRows.length - 5 }} 行...</span>
      </div>
      <div v-if="parseErrors.length" class="errors">
        <div v-for="(e, i) in parseErrors" :key="i">⚠ 行 {{ e.row }}: {{ e.message }}</div>
      </div>
    </FcSection>

    <!-- ⑥ 拖拽排序 (#14) + 撤销 (#15) -->
    <FcSection>
      <template #header><span class="sec-title">⑥ 拖拽排序 + 撤销/重做</span></template>
      <p class="sec-desc">卡片拖拽, 顺序变更后可以 Undo / Redo</p>
      <div class="row" style="margin-bottom: 12px; gap: 8px">
        <FcButton size="sm" :disabled="!undo.canUndo.value" @click="undo.undo()">撤销 Undo</FcButton>
        <FcButton size="sm" :disabled="!undo.canRedo.value" @click="undo.redo()">重做 Redo</FcButton>
        <span class="hint">拖动卡片试试</span>
      </div>
      <div class="card-list">
        <div
          v-for="(c, i) in cards"
          :key="c.id"
          class="card-item"
          draggable="true"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent
          @drop="onDrop(i)"
        >
          <i class="ri-draggable" />
          <span>{{ c.title }}</span>
        </div>
      </div>
    </FcSection>

    <!-- ⑦ 字段 help (#18) -->
    <FcSection>
      <template #header><span class="sec-title">⑦ 字段帮助提示</span></template>
      <p class="sec-desc">表单字段旁 `?` 图标, hover 看说明</p>
      <div class="form-row">
        <label>名称</label>
        <el-input style="width: 240px" class="fc-input" placeholder="试试 hover 右边 ? 图标" />
        <FcHelpTip content="4-20 字符, 支持中英文, 不可重复" />
      </div>
      <div class="form-row" style="margin-top: 8px">
        <label>模板</label>
        <el-input style="width: 240px" class="fc-input" />
        <FcHelpTip content="从模板创建可继承的配置, 减少重复填写" />
      </div>
    </FcSection>

    <!-- ⑧ 幂等提交 (#5) -->
    <FcSection>
      <template #header><span class="sec-title">⑧ 幂等提交</span></template>
      <p class="sec-desc">连点提交按钮只发一次请求</p>
      <div class="row">
        <FcButton type="primary" :loading="idem.loading.value" :disabled="idem.loading.value" @click="onIdem">
          提交 (loading 中再点会被拦截)
        </FcButton>
        <span class="hint">客户端点击 {{ idemCount }} 次 · 服务端实际收到 {{ serverCount }} 次</span>
      </div>
    </FcSection>

    <!-- ⑨ 脏表单离开 (#2) -->
    <FcSection>
      <template #header><span class="sec-title">⑨ 脏表单离开提示</span></template>
      <p class="sec-desc">输入后切走会弹确认框</p>
      <el-input v-model="dirtyInput" class="fc-input" placeholder="试试改一下, 然后切到别的页面" />
      <p class="hint" style="margin-top: 8px">isDirty: <strong>{{ String(dirtyDemo.isDirty.value) }}</strong></p>
    </FcSection>

    <!-- ⑩ Toast promise (#21) -->
    <FcSection>
      <template #header><span class="sec-title">⑩ Toast promise 三态</span></template>
      <p class="sec-desc">一键调起 loading → success/error</p>
      <div class="row">
        <FcButton @click="onPromiseDemo(true)">模拟成功</FcButton>
        <FcButton type="danger" @click="onPromiseDemo(false)">模拟失败</FcButton>
      </div>
    </FcSection>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'DevUxDemo' })
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FcSection, FcSectionHeader, FcButton, FcErrorBoundary, FcFormDraftBanner, FcHelpTip, toast } from '@/components/sdk'
import {
  useClipboard,
  parseExcelPaste,
  useFormDraft,
  useDirtyForm,
  useUndoStack,
  useIdempotentSubmit,
  openCommandPalette,
  registerCommands,
  unregisterCommands,
  type CommandItem,
  useDebouncedFn,
} from '@/composables'

const router = useRouter()
const { copy } = useClipboard()

// === ① 错误边界 (#7) ===
const boom = ref(false)
function doBoom(): string {
  throw new Error('demo: boom! 触发的渲染错误')
}

// === ② 草稿 (#10) ===
const draftForm = reactive({ note: '' })
const draft = useFormDraft(draftForm, 'ux-demo:draft')

function onRestore() {
  if (draft.restore()) toast.success('草稿已恢复')
  draft.discard()
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString()
}

// === ③ 复制 (#22) ===
const onCopy = (s: string) => copy(s)

// === ④ 命令面板 (#8) ===
function openPalette() {
  openCommandPalette()
}

// === ⑤ Excel 粘贴 (#11) ===
const pasteRaw = ref('')
const parsedRows = ref<{ name: string; description: string; price: string }[]>([])
const parseErrors = ref<{ row: number; message: string }[]>([])

const debouncedParse = useDebouncedFn(() => {
  const result = parseExcelPaste<{ name: string; description: string; price: string }>(
    pasteRaw.value, ['name', 'description', 'price'],
  )
  parsedRows.value = result.data
  parseErrors.value = result.errors
}, 200)

function onPaste() {
  setTimeout(debouncedParse, 50)
}

// === ⑥ 拖拽 (#14) + 撤销 (#15) ===
interface Card { id: string; title: string }
const cards = ref<Card[]>([
  { id: '1', title: '工作台' },
  { id: '2', title: '仪表盘' },
  { id: '3', title: '权限' },
  { id: '4', title: '剧场' },
  { id: '5', title: '统计' },
  { id: '6', title: '设置' },
])
const undo = useUndoStack(cards)

// 提交初始快照, 撤销栈以初始顺序为基准
onMounted(() => { undo.commit() })

let dragFrom = -1
function onDragStart(i: number, e: DragEvent) {
  dragFrom = i
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDrop(i: number) {
  if (dragFrom < 0 || dragFrom === i) {
    dragFrom = -1
    return
  }
  const next = [...cards.value]
  const [moved] = next.splice(dragFrom, 1)
  next.splice(i, 0, moved!)
  cards.value = next
  undo.commit()
  dragFrom = -1
}

// === ⑧ 幂等 (#5) ===
const idemCount = ref(0)
const serverCount = ref(0)
const idem = useIdempotentSubmit(async () => {
  idemCount.value++
  await new Promise(r => setTimeout(r, 800))
  serverCount.value++
  toast.success('提交成功')
})
function onIdem() { idem().catch(() => {}) }

// === ⑨ 脏表单 (#2) ===
const dirtyInput = ref('')
const dirtyFormObj = reactive({ input: '' })
watch(dirtyInput, (v) => { dirtyFormObj.input = v })
const dirtyDemo = useDirtyForm(dirtyFormObj, () => ({ input: '' }))

// === ⑩ promise (#21) ===
function onPromiseDemo(ok: boolean) {
  toast.promise(
    new Promise<string>((resolve, reject) => {
      setTimeout(() => ok ? resolve('数据加载完成') : reject(new Error('mock fail')), 600)
    }),
    { loading: '加载中...', success: '成功', error: '失败, 已回滚' },
  ).catch(() => {})
}

// === 命令面板注册 ===
const commands: CommandItem[] = [
  { id: 'demo.boundary', label: '触发错误边界', icon: 'ri-error-warning-line', group: '演示', handler: () => { boom.value = true } },
  { id: 'demo.draft.discard', label: '丢弃草稿', icon: 'ri-delete-bin-line', group: '演示', handler: () => draft.discard() },
  { id: 'demo.undo', label: '撤销', labelKey: 'ux.shortcut.undo', icon: 'ri-arrow-go-back-line', group: '操作', shortcut: 'Cmd+Z', handler: () => undo.undo() },
  { id: 'demo.redo', label: '重做', labelKey: 'ux.shortcut.redo', icon: 'ri-arrow-go-forward-line', group: '操作', shortcut: 'Cmd+Shift+Z', handler: () => undo.redo() },
  { id: 'demo.copy', label: '复制演示 ID', labelKey: 'ux.copy', icon: 'ri-file-copy-line', group: '操作', handler: () => copy('DEMO-12345') },
  { id: 'demo.refresh', label: '刷新页面', icon: 'ri-refresh-line', group: '导航', handler: () => location.reload() },
]
registerCommands(commands)

onUnmounted(() => unregisterCommands(commands.map(c => c.id)))
</script>

<style scoped>
.ux-demo { display: flex; flex-direction: column; gap: 16px; }
.sec-title { font-size: 15px; font-weight: 600; color: var(--app-text); }
.sec-desc { font-size: 13px; color: var(--app-text-secondary); margin: 0 0 12px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.hint { font-size: 12px; color: var(--app-text-tertiary); }
.boundary-box { padding: 24px; border: 1px dashed var(--app-separator); border-radius: 8px; margin-top: 12px; min-height: 80px; }
.boundary-box__ok { color: var(--app-text-secondary); text-align: center; padding: 20px; }
.boom-child { display: none; }
.copyable {
  font-family: monospace;
  background: var(--app-bg-muted, #f5f5f7);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.copyable:hover { background: var(--el-color-primary-light-9, #ecf5ff); }
.parsed-block { margin-top: 12px; }
.result-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
.result-table th, .result-table td {
  padding: 6px 12px;
  border: 1px solid var(--app-separator);
  text-align: left;
  font-size: 13px;
}
.result-table th { background: var(--app-bg-muted); font-weight: 600; }
.errors {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-color-danger-light-9, #fef0f0);
  border-radius: 4px;
  font-size: 13px;
  color: var(--el-color-danger);
}
.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  cursor: grab;
  user-select: none;
}
.card-item:active { cursor: grabbing; }
.card-item:hover { border-color: var(--el-color-primary); }
.card-item i { color: var(--app-text-tertiary); }
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-row label { font-size: 14px; color: var(--app-text); }
</style>