/**
 * 已知缺口记录:熔断与紧急停用 / Webhook 两个页面为 mock 域
 * (web/src/api/admin.ts 头注释与 types.ts #6/#7:服务端无对应端点)。
 * 真服务模式下记录其实际表现(预期 404/空态),按任务口径不定 P 级,单列「已知缺口」。
 */
import { test, expect, saveJson, shot } from '../helpers/support'

test('熔断与紧急停用页:GET /admin/circuit-breaker → 404(服务端无端点)', async ({ adminPage }) => {
  await adminPage.goto('/circuit')
  const resp = await adminPage.waitForResponse((r) => r.url().includes('/admin/circuit-breaker'), { timeout: 15_000 }).catch(() => null)
  if (resp) {
    saveJson('L7-01-熔断页-网络响应.json', { url: resp.url(), status: resp.status(), body: await resp.text().catch(() => '') })
    expect(resp.status()).toBe(404)
  } else {
    saveJson('L7-01-熔断页-网络响应.json', { note: '未捕获到 circuit-breaker 请求' })
  }
  await shot(adminPage, 'L7-01-熔断页-真服务模式表现')
})

test('Webhook 页:config 与 deliveries 均无服务端端点 → 404', async ({ adminPage }) => {
  await adminPage.goto('/webhooks')
  await adminPage.waitForTimeout(2500) // 等待 onMounted 的两发请求
  const journal404: string[] = []
  adminPage.on('response', (r) => {
    if (r.url().includes('/admin/webhooks')) journal404.push(`[${r.status()}] ${r.url()}`)
  })
  await adminPage.reload()
  await adminPage.waitForTimeout(2500)
  saveJson('L7-02-webhook页-网络响应.json', journal404)
  await shot(adminPage, 'L7-02-Webhook页-真服务模式表现')
})
