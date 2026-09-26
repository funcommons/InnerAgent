/**
 * [E2 · P3 2026-09-27] 前端控制台错误遥测(§E2):error / unhandledrejection /
 * console.error 统一上报 /api/demo/client-log(报告作者建议的产品化:
 * 演示现场问题可回放,不再只存在于 Playwright 采集里)。
 *
 * 节流:同一 (level, message) 只报一次 + 单会话上限 20 条,防错误风暴;
 * 遥测自身失败必须静默(不允许观测动作产生新错误)。
 */
let installed = false
const seenMessages = new Set<string>()
let sentCount = 0
const MAX_PER_SESSION = 20

function report(level: string, message: string, stack?: string): void {
  if (sentCount >= MAX_PER_SESSION) return
  const key = `${level}:${message}`
  if (seenMessages.has(key)) return
  seenMessages.add(key)
  sentCount += 1
  try {
    void fetch('/api/demo/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        message: message.slice(0, 1000),
        stack: stack?.slice(0, 2000),
        url: window.location.href,
      }),
      keepalive: true,
    }).catch(() => { /* 遥测自身失败静默 */ })
  } catch {
    /* 遥测自身失败静默 */
  }
}

export function installClientLogTelemetry(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    report('error', event.message || 'window.error', event.error?.stack)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? event.reason.message
      : String(event.reason)
    report(
      'unhandledrejection',
      reason,
      event.reason instanceof Error ? event.reason.stack : undefined,
    )
  })
  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    report(
      'console.error',
      args.map((item) => String(item)).join(' '),
    )
    originalError(...args)
  }
}
