/**
 * [port] useAssistantCountdown — 源: $SRC/src/components/assistant/useAssistantCountdown.ts。
 * 工具确认到期倒计时 composable, 逻辑 1:1 复制, 无 import 改动。
 */
/**
 * 工具确认到期倒计时。(自旧 ai-fusion-video-web/components/dashboard/shared/
 * tool-confirmation-countdown.ts 1:1 移植, React hook → Vue composable)
 *
 * expiresAt 接受 getter/ref, 确认批动态到达/更换时自动重启计时;
 * 每秒刷新 + focus/visibilitychange 立即校准 (与旧实现一致)。
 */
import { computed, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

export function formatApprovalCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分 ${seconds} 秒`
}

export interface ApprovalCountdown {
  expired: boolean
  label: string
}

export function useToolConfirmationCountdown(
  expiresAt: MaybeRefOrGetter<string | undefined>,
  updateEverySecond = true,
) {
  const parsed = computed<number | undefined>(() => {
    const value = toValue(expiresAt)
    if (value === undefined) return undefined
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) {
      throw new Error('Tool confirmation expiry is invalid')
    }
    return ms
  })
  const now = ref(Date.now())

  let timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null
  const stopTimer = () => {
    if (timer) {
      updateEverySecond ? clearInterval(timer) : clearTimeout(timer)
      timer = null
    }
  }
  const update = () => { now.value = Date.now() }

  if (typeof window !== 'undefined') {
    watch(parsed, () => {
      stopTimer()
      update()
      if (parsed.value === undefined) return
      timer = updateEverySecond
        ? setInterval(update, 1000)
        : setTimeout(update, Math.max(0, parsed.value - Date.now()))
    }, { immediate: true })

    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    onUnmounted(() => {
      stopTimer()
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    })
  }

  return computed<ApprovalCountdown | undefined>(() => {
    if (parsed.value === undefined) return undefined
    const remainingMs = Math.max(0, parsed.value - now.value)
    return {
      expired: remainingMs === 0,
      label: formatApprovalCountdown(remainingMs),
    }
  })
}
