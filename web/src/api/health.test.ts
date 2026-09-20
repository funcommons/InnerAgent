/**
 * [new] 环境状态灯健康探测测试(优化建议 #1)。
 * 状态机:demo 锁定优先;connected=拿到任何 HTTP 响应(含 401/403 拒答);
 * offline=网络层失败;unknown=尚无交换。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import {
  backendMode,
  backendNote,
  isDemoBackendActive,
  markDemoBackend,
  probeBackend,
  reportReach,
} from './health'

function resetState() {
  backendMode.value = 'unknown'
  backendNote.value = ''
}

describe('环境状态灯(api/health)', () => {
  beforeEach(resetState)

  it('dev 下默认判定 msw 演示后端接管', () => {
    // vitest 运行于 import.meta.env.DEV=true 且未设 VITE_ENABLE_MOCK
    expect(isDemoBackendActive()).toBe(true)
  })

  it('markDemoBackend 锁定演示态;后续交换成功不把演示洗成已连接', () => {
    markDemoBackend()
    expect(backendMode.value).toBe('demo')
    reportReach(true)
    expect(backendMode.value).toBe('demo')
  })

  it('reportReach:任何 HTTP 响应 → connected;网络层失败 → offline', () => {
    reportReach(true)
    expect(backendMode.value).toBe('connected')
    reportReach(false)
    expect(backendMode.value).toBe('offline')
    expect(backendNote.value).toContain('不可达')
  })

  it('启动探测:401/403 拒答也判定真实服务可达(connected)', async () => {
    // 真实服务对未携带凭据的探测返回 403(AdminTokenFilter 缺省封闭)→ 可达;
    // 测试进程本身是 DEV,显式关掉 msw 接管以覆盖直连探测分支
    import.meta.env.VITE_ENABLE_MOCK = 'false'
    server.use(
      mswHttp.get('/ia/api/v1/admin/audit-logs/dictionary', () =>
        HttpResponse.json({ code: 403, msg: '管理面凭据无效', data: null }, { status: 403 })),
    )
    try {
      await probeBackend()
    } finally {
      delete import.meta.env.VITE_ENABLE_MOCK
    }
    expect(backendMode.value).toBe('connected')
  })
})
