/**
 * [port] useReasoningElapsed — 源: $SRC/src/components/assistant/useReasoningElapsed.ts。
 * 流式推理计时 composable, 逻辑 1:1 复制, 无 import 改动。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 流式推理计时走表步长 (对齐旧 timeline.tsx:51 REASONING_TIMER_INTERVAL_MS) */
export const REASONING_TIMER_INTERVAL_MS = 100

/**
 * 流式推理计时 (对齐旧 useReasoningElapsedMs, timeline.tsx:53-117):
 * - durationMs 已有 (终态) → 直接返回, 不启动计时器
 * - active && startedAtMs 存在 → 100ms 走表; focus/visibilitychange 立即补拍
 * - 其余 → undefined (UI 显示静态「思考中」)
 */
export function useReasoningElapsedMs(
  startedAtMs: Ref<number | undefined>,
  durationMs: Ref<number | undefined>,
  active: Ref<boolean>,
) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  const running = computed(
    () => active.value && durationMs.value === undefined && startedAtMs.value !== undefined,
  )

  const updateNow = () => {
    now.value = Date.now()
  }

  watch(
    running,
    (isRunning) => {
      if (isRunning && timer === null) {
        updateNow()
        timer = setInterval(updateNow, REASONING_TIMER_INTERVAL_MS)
        window.addEventListener('focus', updateNow)
        document.addEventListener('visibilitychange', updateNow)
      } else if (!isRunning && timer !== null) {
        clearInterval(timer)
        timer = null
        window.removeEventListener('focus', updateNow)
        document.removeEventListener('visibilitychange', updateNow)
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer)
    timer = null
    window.removeEventListener('focus', updateNow)
    document.removeEventListener('visibilitychange', updateNow)
  })

  return computed(() => {
    if (durationMs.value !== undefined) return durationMs.value
    if (!running.value || startedAtMs.value === undefined) return undefined
    return Math.max(0, now.value - startedAtMs.value)
  })
}
