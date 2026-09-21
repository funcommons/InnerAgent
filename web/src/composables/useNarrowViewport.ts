/**
 * [new] 窄屏视口探测(优化建议 #26 短期方案)。
 *
 * 背景:el-table 固定列在 DOM 产生隐藏克隆行(e2e 行定位须 visible 过滤、
 * 窄屏下固定列阴影偶发错位)。升级评估结论(2026-09-21):Element Plus 2.x
 * 主线 el-table 仍为克隆方案,sticky 方案需迁移 el-table-v2(虚拟滚动,
 * 六域改造成本高)或等待上游重构;本期采取「窄屏(<1280)收起次要列」
 * 降低固定列使用面,克隆 DOM 问题留待版本升级再评估。
 *
 * 各宽表次要列(描述/注解/指纹/备注/用户等)以 v-if="!narrow" 收起,
 * 操作列保持 fixed="right"。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** 默认断点 1280px(e2e 视口 1440 不受影响) */
export function useNarrowViewport(breakpoint = 1280): Readonly<Ref<boolean>> {
  const narrow = ref(false)
  let mql: MediaQueryList | null = null
  const update = () => {
    narrow.value = Boolean(mql?.matches)
  }
  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return // jsdom 等环境兜底
    mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    update()
    mql.addEventListener('change', update)
  })
  onBeforeUnmount(() => {
    mql?.removeEventListener('change', update)
  })
  return narrow
}
