import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useReasoningElapsedMs, REASONING_TIMER_INTERVAL_MS } from '../assistant/useReasoningElapsed'

/** 挂载临时组件以运行组合式函数 (onBeforeUnmount 安全) */
async function withSetup(fn: () => { elapsed: ReturnType<typeof useReasoningElapsedMs> }) {
  const { createApp, h } = await import('vue')
  let result: ReturnType<typeof fn> | null = null
  const host = document.createElement('div')
  const app = createApp({ setup() { result = fn(); return () => h('div') } })
  app.mount(host)
  await flushPromises()
  return { app, host, get result() { return result! } }
}

describe('useReasoningElapsedMs (流式推理走表, 对齐旧 timeline.tsx:53-117)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('常量: 100ms 步长', () => {
    expect(REASONING_TIMER_INTERVAL_MS).toBe(100)
  })

  it('流式 + startedAtMs → 随时间增长; Date.now 基准', async () => {
    vi.setSystemTime(1_000)
    const startedAtMs = ref(1_000)
    const durationMs = ref<number | undefined>(undefined)
    const active = ref(true)
    const { app, host, result } = await withSetup(() => ({
      elapsed: useReasoningElapsedMs(startedAtMs, durationMs, active),
    }))
    expect(result.elapsed.value).toBe(0)

    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(result.elapsed.value).toBe(1_000)

    app.unmount()
    host.remove()
  })

  it('终态 durationMs 直接返回, 不走表', async () => {
    vi.setSystemTime(1_000)
    const startedAtMs = ref<number | undefined>(1_000)
    const durationMs = ref<number | undefined>(4_200)
    const active = ref(true)
    const { app, host, result } = await withSetup(() => ({
      elapsed: useReasoningElapsedMs(startedAtMs, durationMs, active),
    }))
    expect(result.elapsed.value).toBe(4_200)
    vi.advanceTimersByTime(500)
    await flushPromises()
    expect(result.elapsed.value).toBe(4_200)
    app.unmount()
    host.remove()
  })

  it('非 active → undefined', async () => {
    vi.setSystemTime(1_000)
    const startedAtMs = ref<number | undefined>(1_000)
    const durationMs = ref<number | undefined>(undefined)
    const active = ref(false)
    const { app, host, result } = await withSetup(() => ({
      elapsed: useReasoningElapsedMs(startedAtMs, durationMs, active),
    }))
    expect(result.elapsed.value).toBeUndefined()
    app.unmount()
    host.remove()
  })
})
