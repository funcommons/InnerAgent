/**
 * [port] useAssistantMessageScroll — 源: $SRC/src/components/assistant/useAssistantMessageScroll.ts。
 * 消息流滚动跟随 composable, 逻辑 1:1 复制, 无 import 改动。
 */
/**
 * useAssistantMessageScroll — 助手消息流滚动跟随 (旧
 * ai-fusion-video-web/components/dashboard/assistant/use-assistant-message-scroll.ts:60-226
 * 的 Vue 移植, 行为 1:1):
 * - 内容就绪时隐形贴底 (双 rAF 兜底), 就绪后揭示视口 (viewportReady)
 * - 流式运行中自动跟随新内容 (内容版本号变化 + ResizeObserver → animateToBottom)
 * - 用户向上滚动 (滚轮/键盘/触摸) 即脱离跟随, 出现「回到底部」按钮
 * - 滚回底部 (≤30px) 自动重新跟随; 运行态切换 (新消息发出) 重新贴底
 * - prefers-reduced-motion 时直接跳底, 不做动画
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'

const AT_BOTTOM_THRESHOLD_PX = 30
const FOLLOW_SCROLL_DURATION_MS = 100
const SCROLLABLE_THRESHOLD_PX = 20

export interface UseAssistantMessageScrollOptions {
  /** 滚动视口元素 ref (组件模板 ref="viewportRef" 绑定) */
  viewportRef: Ref<HTMLElement | null>
  /** 内容容器元素 ref (ResizeObserver 观察对象) */
  contentRef: Ref<HTMLElement | null>
  /** 消息内容是否就绪 (加载完成或已有错误) */
  contentReady: () => boolean
  /** 内容版本号 (messagesLoaded:messages.length:lastSequence) — 变化即有新内容提交 */
  contentVersion: () => string
  /** 是否流式运行中 */
  running: () => boolean
}

export function useAssistantMessageScroll(options: UseAssistantMessageScrollOptions) {
  const { viewportRef, contentRef } = options
  const viewportReady = ref(false)
  const showBackToBottom = ref(false)

  // 非响应式滚动状态 (对齐旧 ref 旗标)
  let isDetached = false
  let isInitializing = true
  let isScrollingToBottom = false
  let isScrollbarDragging = false
  let lastScrollTop = 0
  let touchY: number | null = null
  let followFrame: number | null = null

  function cancelFollowAnimation(): void {
    if (followFrame !== null) {
      cancelAnimationFrame(followFrame)
      followFrame = null
    }
    isScrollingToBottom = false
  }

  function pinToBottom(): void {
    const element = viewportRef.value
    if (!element) return
    cancelFollowAnimation()
    element.scrollTop = element.scrollHeight
    lastScrollTop = element.scrollTop
  }

  function animateToBottom(): void {
    const element = viewportRef.value
    if (!element) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pinToBottom()
      return
    }
    if (followFrame !== null) return

    const startTop = element.scrollTop
    const startedAt = performance.now()
    isScrollingToBottom = true

    // 用 performance.now() 自计步 (不用 rAF 回调时间戳: jsdom 下两者时钟原点不同)
    const step = (): void => {
      const el = viewportRef.value
      if (!el) {
        followFrame = null
        isScrollingToBottom = false
        return
      }
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight)
      const progress = Math.min((performance.now() - startedAt) / FOLLOW_SCROLL_DURATION_MS, 1)
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      el.scrollTop = startTop + (targetTop - startTop) * easedProgress
      lastScrollTop = el.scrollTop

      if (progress < 1) {
        followFrame = requestAnimationFrame(step)
        return
      }
      el.scrollTop = targetTop
      lastScrollTop = el.scrollTop
      followFrame = null
      isScrollingToBottom = false
    }

    followFrame = requestAnimationFrame(step)
  }

  function scheduleFollow(): void {
    if (followFrame !== null || isDetached || (!options.running() && !isInitializing)) return
    animateToBottom()
  }

  function isScrollable(): boolean {
    const element = viewportRef.value
    return !!element && element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX
  }

  // 初始/会话切换就绪: 隐形贴底两帧后才揭示 (旧 useLayoutEffect 初始化序列)
  watch(
    () => options.contentReady() && !!viewportRef.value,
    (ready) => {
      if (!ready) return
      isDetached = false
      pinToBottom()
      requestAnimationFrame(() => {
        if (!viewportRef.value) return
        pinToBottom()
        requestAnimationFrame(() => {
          pinToBottom()
          isInitializing = false
          showBackToBottom.value = false
          viewportReady.value = true
        })
      })
    },
    { immediate: true },
  )

  // 运行态切换 (用户发新消息 / 流开始): 重新贴底 (旧 useLayoutEffect on running)
  watch(
    () => options.running(),
    (now, was) => {
      if (now && !was) {
        isDetached = false
        showBackToBottom.value = false
        animateToBottom()
      }
    },
  )

  // 每批内容提交后在绘制前跟随 (旧 contentVersion useLayoutEffect)
  watch(
    () => options.contentVersion(),
    () => {
      if (viewportReady.value && options.running() && !isDetached) {
        animateToBottom()
      }
    },
  )

  // 内容/视口尺寸变化时持续跟随
  let resizeObserver: ResizeObserver | null = null
  watch(
    () => [contentRef.value, viewportRef.value] as const,
    ([content, viewport]) => {
      resizeObserver?.disconnect()
      if (!content || !viewport || typeof ResizeObserver === 'undefined') return
      resizeObserver = new ResizeObserver(() => scheduleFollow())
      resizeObserver.observe(content)
      resizeObserver.observe(viewport)
    },
    { immediate: true },
  )

  // 滚动条拖拽判定 (pointerdown 在视口上即视为可能拖拽滚动条, pointerup 解除)
  const onScrollbarPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (isScrollable()) isScrollbarDragging = true
  }
  const stopScrollbarDrag = (): void => {
    isScrollbarDragging = false
  }
  window.addEventListener('pointerup', stopScrollbarDrag)
  window.addEventListener('pointercancel', stopScrollbarDrag)

  function detachFromBottom(): void {
    if (isDetached) return
    isDetached = true
    cancelFollowAnimation()
    const element = viewportRef.value
    if (element) {
      showBackToBottom.value = element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX
    }
  }

  function onViewportScroll(event: Event): void {
    if (isInitializing) return
    const element = event.currentTarget
    if (!(element instanceof HTMLElement)) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const atBottom = distance <= AT_BOTTOM_THRESHOLD_PX
    const movedDown = element.scrollTop > lastScrollTop + 1

    if (atBottom && (!isDetached || movedDown)) {
      isDetached = false
      isScrollingToBottom = false
      showBackToBottom.value = false
    } else if (isDetached) {
      showBackToBottom.value = element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX
    } else if (isScrollbarDragging) {
      detachFromBottom()
    } else if (options.running() && !isScrollingToBottom) {
      // 浏览器滚动恢复/重连布局变化会无用户意图地移动视口, 保持跟随
      scheduleFollow()
    }

    lastScrollTop = element.scrollTop
  }

  function onWheel(event: WheelEvent): void {
    if (event.deltaY < 0 && isScrollable()) {
      detachFromBottom()
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const scrollsUp = event.key === 'ArrowUp'
      || event.key === 'PageUp'
      || event.key === 'Home'
      || (event.key === ' ' && event.shiftKey)
    if (scrollsUp && isScrollable()) {
      detachFromBottom()
    }
  }

  function onTouchStart(event: TouchEvent): void {
    touchY = event.touches[0]?.clientY ?? null
  }

  function onTouchMove(event: TouchEvent): void {
    const nextY = event.touches[0]?.clientY
    if (nextY === undefined || touchY === null) return
    if (nextY > touchY && isScrollable()) {
      detachFromBottom()
    }
    touchY = nextY
  }

  function scrollToBottom(): void {
    const element = viewportRef.value
    if (!element) return
    isDetached = false
    showBackToBottom.value = false
    animateToBottom()
  }

  onScopeDispose(() => {
    cancelFollowAnimation()
    resizeObserver?.disconnect()
    window.removeEventListener('pointerup', stopScrollbarDrag)
    window.removeEventListener('pointercancel', stopScrollbarDrag)
  })

  return {
    viewportReady,
    showBackToBottom,
    onViewportScroll,
    onWheel,
    onKeyDown,
    onTouchStart,
    onTouchMove,
    onScrollbarPointerDown,
    scrollToBottom,
  }
}
