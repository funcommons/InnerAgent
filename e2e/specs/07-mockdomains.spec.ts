/**
 * [R3 断言更新] mock 域接真回归(优化建议 #2 修复验证:服务端 dfcecb5 + web 5e8feb7/51de916)。
 *
 * R1/R2 口径:熔断与紧急停用 / Webhook 两页为 mock 域(服务端无端点),真服务模式
 * 断言 404;R3 起服务端已落 GET /admin/circuit-breaker 等 5 端点(V14)与
 * /admin/webhooks/config + /admin/webhook-deliveries → 产品行为正确,旧「404 取证」
 * 断言过时,本 spec 反转为「真端点 + 页面渲染」正向回归。
 *
 * 已知残留(DEF-08/DEF-09,只记录不修):
 *  - DEF-08:PUT /limits 与 emergency-stop/resume 落库 500(JsonbTypeHandler 发
 *    varchar 给 PG jsonb 列;单测 mock 层覆盖不到)。
 *  - DEF-09:GET /admin/webhook-deliveries 不带 status → NPE 500
 *    (WebhookDeliveryAdminService.normalizeStatus 对 null trim);
 *    UI 首载 deliveries(未选状态)同样命中 → 选择状态过滤后恢复 200。
 */
import { test, expect, saveJson, saveText, shot } from '../helpers/support'

test('熔断与紧急停用页:GET /admin/circuit-breaker → 200,页面渲染真实状态', async ({ adminPage }) => {
  await adminPage.goto('/circuit')
  const resp = await adminPage.waitForResponse((r) => r.url().includes('/admin/circuit-breaker') && r.request().method() === 'GET', { timeout: 15_000 })
  const body = (await resp.json().catch(() => null)) as any
  saveJson('L7-01-熔断页-网络响应.json', { url: resp.url(), status: resp.status(), body })
  expect(resp.status(), '熔断状态端点 200(服务端 dfcecb5 已落端点)').toBe(200)
  expect(body?.data, '响应含 emergencyStopped/limits/activeRuns/recentEvents').toBeTruthy()
  expect(typeof body.data.emergencyStopped).toBe('boolean')
  expect(body.data.limits).toBeTruthy()
  expect(typeof body.data.activeRuns).toBe('number')
  expect(Array.isArray(body.data.recentEvents)).toBe(true)
  // 页面渲染:活跃运行数 + 紧急停用区(无「≤5s 生效」旧文案,#2 对齐说明)
  const pageText = await adminPage.locator('body').innerText()
  saveText('L7-01-熔断页-文案观察.txt', pageText)
  expect(pageText).toContain('活跃运行')
  expect(pageText, '旧 mock 文案「≤5s 生效」已移除(commit 51de916)').not.toContain('≤5s')
  await shot(adminPage, 'L7-01-熔断页-真服务渲染(200)')
})

test('Webhook 页:config 200 接真;deliveries 状态过滤可用(首载 500=DEF-09 记录)', async ({ adminPage }) => {
  const configResp = adminPage.waitForResponse((r) => r.url().includes('/admin/webhooks/config') && r.request().method() === 'GET', { timeout: 15_000 })
  const deliveriesFirst = adminPage.waitForResponse((r) => r.url().includes('/admin/webhook-deliveries'), { timeout: 15_000 }).catch(() => null)
  await adminPage.goto('/webhooks')
  const cfg = await configResp
  const cfgBody = (await cfg.json().catch(() => null)) as any
  saveJson('L7-02-webhook-config-网络响应.json', { url: cfg.url(), status: cfg.status(), body: cfgBody })
  expect(cfg.status(), 'webhook config 端点 200(V14 后接真)').toBe(200)
  expect(cfgBody?.data).toBeTruthy()

  // 首载 deliveries(无 status 参数)→ DEF-09 NPE 500(记录,不判 UI 缺陷)
  const first = await deliveriesFirst
  if (first) {
    saveJson('L7-02-webhook-deliveries-首载响应.json', { url: first.url(), status: first.status() })
  }

  // 选择状态过滤(status 参数生效,偏离 #18b 语义的 500 消失)→ 200
  await adminPage.locator('.el-select').filter({ hasText: '投递状态' }).first().click()
  await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '成功' }).first().click()
  const filtered = await adminPage.waitForResponse((r) => r.url().includes('/admin/webhook-deliveries') && r.url().includes('status='), { timeout: 15_000 })
  saveJson('L7-02-webhook-deliveries-状态过滤响应.json', { url: filtered.url(), status: filtered.status() })
  expect(filtered.status(), '带 status 过滤的 deliveries 请求 200').toBe(200)
  await adminPage.waitForTimeout(600)
  await shot(adminPage, 'L7-02-Webhook页-真服务渲染(config200+deliveries状态过滤)')
})
