/**
 * [new] 后端环境健康探测(优化建议 #1:「mock 后端」徽标 → 环境状态灯)。
 *
 * 状态机(优先级:demo > connected > offline/unknown):
 *   - demo      msw 演示后端接管(import.meta.env.DEV 且未显式关闭)→ 黄点「演示数据」;
 *   - connected 最近一次 /ia/api 交换得到任何 HTTP 响应(含 401/403 业务拒答,
 *               服务端在答话即证明可达)→ 绿点「已连接」;
 *   - offline   最近一次交换网络层失败(无响应/超时)→ 红点「服务不可达」;
 *   - unknown   尚无任何交换(启动探测进行中)→ 灰点「检测中」。
 *
 * 数据来源:① 构建期 import.meta.env(VITE_ENABLE_MOCK 决定 msw 是否接管);
 * ② 启动探测 probeBackend()(对真实服务发一次轻量 GET,任何 HTTP 响应即为可达);
 * ③ 运行期 request.ts 响应拦截器逐次校正(reportReach)。
 */
import { ref } from 'vue'

export type BackendMode = 'connected' | 'demo' | 'offline' | 'unknown'

export const backendMode = ref<BackendMode>('unknown')
export const backendNote = ref('')

/** dev 模式 msw 接管判断:DEV 且未显式 VITE_ENABLE_MOCK=false(生产构建恒不启 msw) */
export function isDemoBackendActive(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK !== 'false'
}

/** msw 演示后端已激活(main.ts 在 worker.start 后调用;此后运行期交换不再降级该态) */
export function markDemoBackend(): void {
  backendMode.value = 'demo'
  backendNote.value = '本地 msw 演示后端接管中,数据为演示种子,非真实服务数据'
}

/**
 * 运行期校正(request.ts 响应拦截器在每次 /ia/api 交换后调用)。
 * reachable=「拿到 HTTP 响应」而非「业务成功」——401/403 也证明服务可达。
 * demo 态不覆盖:msw 接管时交换恒成功,不能把演示态洗成「已连接」。
 */
export function reportReach(reachable: boolean): void {
  if (backendMode.value === 'demo') return
  backendMode.value = reachable ? 'connected' : 'offline'
  backendNote.value = reachable
    ? '真实服务已连接(最近一次请求有响应)'
    : '服务不可达(最近一次请求无响应或超时)'
}

/**
 * 启动探测:对轻量真实端点发一次静默 GET。
 * 判据与运行期一致:任何 HTTP 响应(含 401/403)→ connected;网络层失败 → offline。
 * dev+msw 场景下 markDemoBackend 已锁定演示态,探测结果被 reportReach 忽略。
 */
export async function probeBackend(): Promise<void> {
  if (isDemoBackendActive()) {
    markDemoBackend()
    return
  }
  try {
    const { http } = await import('./request')
    await http.get('/ia/api/v1/admin/audit-logs/dictionary', { silent: true })
  } catch {
    // 请求层已按「是否有 HTTP 响应」调用 reportReach;此处仅吞掉探测异常
  }
}
