/**
 * [new] 熔断与资源上限 store(视图清单 #6;已落地 AdminCircuitBreakerController)。
 * 契约注记(2026-09-21 服务端批):紧急停用仅翻转总开关+记事件,不批量取消
 * 进行中 run(引导管理员按 activeRuns 逐个 terminate-run);limits 本版仅落库+
 * 管理面读写,内核并发/QPS 强制执行后续接入(文案不得宣称「已强制生效」)。
 * 老版本服务端无此端点时置 unavailable,视图显「服务端能力未开通」占位。
 * 上限默认值 = 《02-技术方案》§4.7。
 */
import { defineStore } from 'pinia'
import { circuitAdminApi } from '@/api/admin'
import type { CircuitBreakerState, ResourceLimits } from '@/api/types'

export const DEFAULT_LIMITS: ResourceLimits = {
  maxToolCallsPerRun: 32,
  maxTokensPerRun: 300000,
  maxRunDurationMinutes: 30,
  toolRetryLimit: 2,
  mcpConcurrency: 8,
  mcpQps: 20,
  confirmTimeoutHours: 24,
}

export const LIMIT_FIELDS: Array<{ key: keyof ResourceLimits; label: string; hint: string; min: number; max: number }> = [
  { key: 'maxToolCallsPerRun', label: '单运行最大工具调用', hint: '超限终止并告知用户', min: 1, max: 999 },
  { key: 'maxTokensPerRun', label: '单运行最大 token', hint: '输入+输出累计,按上下文窗口自适应下修', min: 1000, max: 10000000 },
  { key: 'maxRunDurationMinutes', label: '单运行最长时长(分)', hint: '与 deadline 取小', min: 1, max: 1440 },
  { key: 'toolRetryLimit', label: '工具失败重试上限', hint: '仅幂等只读工具(指数退避 1s/4s)', min: 0, max: 10 },
  { key: 'mcpConcurrency', label: '宿主 MCP 并发上限', hint: '应用级可配,护栏指标落点', min: 1, max: 1000 },
  { key: 'mcpQps', label: '宿主 MCP QPS 上限', hint: '应用级可配', min: 1, max: 10000 },
  { key: 'confirmTimeoutHours', label: '确认等待超时(小时)', hint: '超时自动拒绝并通知(PRD 默认 24h)', min: 1, max: 168 },
]

export const useCircuitStore = defineStore('circuit', {
  state: () => ({
    state: null as CircuitBreakerState | null,
    /** GET /circuit-breaker 不可达(老版本服务端)→ 视图显「服务端能力未开通」占位 */
    unavailable: false,
    loading: false,
    limitsForm: { ...DEFAULT_LIMITS } as ResourceLimits,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.state = await circuitAdminApi.getState()
        this.limitsForm = { ...this.state.limits }
        this.unavailable = false
      } catch {
        // 端点 404/未授权(老版本服务端)→ 占位态,不弹错误
        this.state = null
        this.unavailable = true
      } finally {
        this.loading = false
      }
    },
    async saveLimits() {
      const saved = await circuitAdminApi.updateLimits({ limits: this.limitsForm })
      if (this.state) this.state.limits = { ...saved }
      return saved
    },
    async emergencyStop(reason: string) {
      const event = await circuitAdminApi.emergencyStop({ reason })
      await this.load()
      return event
    },
    async resume() {
      const event = await circuitAdminApi.resume()
      await this.load()
      return event
    },
    async terminateRun(runId: string, reason: string) {
      return circuitAdminApi.terminateRun({ runId, reason })
    },
  },
})
