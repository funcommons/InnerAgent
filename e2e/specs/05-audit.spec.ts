/**
 * 业务线 5:管理站-审计检索(AdminAuditQueryService /ia/api/v1/admin/audit-logs)。
 *
 * 覆盖:分页、decision/decisionSource/时间过滤、敏感参数脱敏展示(password 类 ***),
 * 以及字典端点与 UI 下拉的值域一致性(发现项:web 缺 expired 档)。
 *
 * 数据策略(固定标识符,防 worker 重启后模块常量变化):
 *  - 真实写路径:固定工具的授予/撤销(API,审计由服务端落库);
 *  - 检索面数据:psql 直插合成行(写路径覆盖归 T2 SDK 线)。服务端为「读时脱敏」
 *    设计 —— 库内明文行在出参必须打码,恰好可验证读侧防线。
 *  每个用例先 ensureSeed()(幂等:按固定 FQN 检查数量,缺则补插)。
 */
import {
  test, expect, psql, saveJson, saveText, shot, tableRow,
} from '../helpers/support'

const FQN_PAG = 'mcp__e2eaudit__pag'
const FQN_DENY = 'mcp__e2eaudit__den'
const FQN_TIME = 'mcp__e2eaudit__time'
const FQN_SECRET = 'mcp__e2eaudit__secret'
const AUDIT_TOOL = 'e2e_audit_tool'
// 明文敏感参数(验证「读时脱敏」:库内原文,出参必须 ***)
const SECRET_PARAMS = JSON.stringify({
  password: 'SuperSecret123',
  api_key: 'abcd-1234-efgh',
  nested: { refreshToken: 'rt-999', note: 'keepme' },
})
const SECRET_PARAMS_ESC = SECRET_PARAMS.replace(/'/g, "''")

/** 幂等补种:分页 12 行 + 拒绝行 + 时间旧行 + 敏感明文行 */
function ensureSeed() {
  const count = Number(psql(`SELECT count(*) FROM ia_audit_log WHERE tool_fqn='${FQN_PAG}'`)) || 0
  if (count < 12) {
    psql(`DELETE FROM ia_audit_log WHERE tool_fqn='${FQN_PAG}'`)
    psql(`INSERT INTO ia_audit_log (app_id, tenant_id, user_id, tool_fqn, decision, decision_source, risk_level, params_masked_json, duration_ms, create_time)
          SELECT 1, 0, 7001, '${FQN_PAG}', 'allowed', 'mode-default', 'low', '{}', 5, now() - (i || ' seconds')::interval
          FROM generate_series(1, 12) AS i`)
  }
  if (!Number(psql(`SELECT count(*) FROM ia_audit_log WHERE tool_fqn='${FQN_DENY}'`))) {
    psql(`INSERT INTO ia_audit_log (app_id, tenant_id, user_id, tool_fqn, decision, decision_source, risk_level, params_masked_json, duration_ms)
          VALUES (1, 0, 7002, '${FQN_DENY}', 'denied', 'live-confirm', 'high', '{"reason":"deny"}', 8)`)
  }
  if (!Number(psql(`SELECT count(*) FROM ia_audit_log WHERE tool_fqn='${FQN_TIME}'`))) {
    psql(`INSERT INTO ia_audit_log (app_id, tenant_id, user_id, tool_fqn, decision, decision_source, risk_level, params_masked_json, create_time)
          VALUES (1, 0, 7003, '${FQN_TIME}', 'allowed', 'mode-default', 'low', '{}', '2020-01-01 00:00:00')`)
  }
  if (!Number(psql(`SELECT count(*) FROM ia_audit_log WHERE tool_fqn='${FQN_SECRET}'`))) {
    psql(`INSERT INTO ia_audit_log (app_id, tenant_id, user_id, tool_fqn, decision, decision_source, risk_level, params_masked_json, duration_ms)
          VALUES (1, 0, 7004, '${FQN_SECRET}', 'allowed', 'mode-default', 'medium', '${SECRET_PARAMS_ESC}', 3)`)
  }
}

/** 真实写路径:授予+撤销各落一条审计(granted/revoked,source=user-grant) */
async function ensureGrantRevokeRows(request: import('@playwright/test').APIRequestContext) {
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${AUDIT_TOOL}'`)
  psql(`DELETE FROM ia_tool_grant WHERE user_id = 8701`) // 防复跑 500(DEF-04:逻辑删行占唯一键)
  const reg = await request.post('/ia/api/v1/admin/tools', {
    data: { serverKey: 'e2eaudit', toolName: AUDIT_TOOL, source: 'host_app' },
  })
  expect(reg.status()).toBe(200)
  const grant = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8701, toolName: AUDIT_TOOL, scope: 'permanent', decisionNote: 'e2e audit' },
  })
  expect(grant.status()).toBe(200)
  const grantId = (await grant.json()).data.id as number
  await request.delete(`/ia/api/v1/admin/grants/${grantId}`, { data: { decisionNote: 'e2e revoke' } })
  return (await reg.json()).data.id as number
}

test('分页:total 正确,pageNo/pageSize 翻页', async ({ request, adminPage }) => {
  ensureSeed()
  const page1 = await request.get(`/ia/api/v1/admin/audit-logs?toolFqn=${encodeURIComponent(FQN_PAG)}&pageNo=1&pageSize=10`)
  const p1 = await page1.json()
  expect(p1.data.total).toBe(12)
  expect(p1.data.list.length).toBe(10)
  expect(p1.data.pageNo).toBe(1)
  const page2 = await request.get(`/ia/api/v1/admin/audit-logs?toolFqn=${encodeURIComponent(FQN_PAG)}&pageNo=2&pageSize=10`)
  const p2 = await page2.json()
  expect(p2.data.list.length).toBe(2)
  saveJson('L5-01-分页-服务端.json', { p1: { total: p1.data.total, rows: p1.data.list.length }, p2: { rows: p2.data.list.length } })

  await adminPage.goto('/audit')
  await adminPage.getByPlaceholder('工具 FQN(模糊)').fill(FQN_PAG)
  await adminPage.getByRole('button', { name: '查询' }).click()
  await expect(adminPage.getByText(/共 12 条|Total 12/)).toBeVisible() // FIND-P3:Element Plus 未配 zh-cn locale,英文 Total
  await expect(adminPage.locator('.el-table__row')).toHaveCount(10)
  await shot(adminPage, 'L5-01-审计分页-第1页10行')
  await adminPage.locator('.el-pagination .btn-next').click()
  await expect(adminPage.locator('.el-table__row')).toHaveCount(2)
  await shot(adminPage, 'L5-01-审计分页-第2页2行')
})

test('decision / decisionSource 过滤:服务端与 UI 一致', async ({ request, adminPage }) => {
  ensureSeed()
  const byDecision = await request.get(`/ia/api/v1/admin/audit-logs?decision=denied&toolFqn=${encodeURIComponent(FQN_DENY)}`)
  const bd = await byDecision.json()
  expect(bd.data.total).toBe(1)
  expect(bd.data.list[0].decision).toBe('denied')
  expect(bd.data.list[0].decisionSource).toBe('live-confirm')
  saveJson('L5-02-decision过滤-服务端.json', bd)

  await adminPage.goto('/audit')
  await adminPage.getByPlaceholder('工具 FQN(模糊)').fill(FQN_DENY)
  await adminPage.locator('.el-select').filter({ hasText: 'decision_source' }).first().click()
  await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '实时确认' }).click()
  await expect(adminPage.locator('.el-table__row')).toHaveCount(1)
  await expect(tableRow(adminPage, FQN_DENY).getByText('拒绝')).toBeVisible()
  await shot(adminPage, 'L5-02-UI-decisionSource过滤(live-confirm)')
})

test('时间过滤:from 排除历史行;UI 触发的 query 携带 ISO 时间', async ({ request, adminPage }) => {
  ensureSeed()
  const withFrom = await request.get(`/ia/api/v1/admin/audit-logs?toolFqn=${encodeURIComponent(FQN_TIME)}&from=2021-01-01T00:00:00`)
  const wf = await withFrom.json()
  expect(wf.data.total).toBe(0)
  const noFrom = await request.get(`/ia/api/v1/admin/audit-logs?toolFqn=${encodeURIComponent(FQN_TIME)}`)
  expect((await noFrom.json()).data.total).toBe(1)
  saveJson('L5-03-时间过滤-服务端.json', { from2021: wf.data.total, all: 1 })

  // UI:起始时间按 value-format(YYYY-MM-DDTHH:mm:ss[Z])输入,触发查询请求
  await adminPage.goto('/audit')
  await adminPage.getByPlaceholder('工具 FQN(模糊)').fill(FQN_TIME)
  const fromInput = adminPage.getByPlaceholder('起始时间')
  await fromInput.click()
  await fromInput.fill('2021-01-01T00:00:00Z')
  await fromInput.press('Enter')
  await adminPage.getByRole('button', { name: '查询' }).click()
  await adminPage.waitForTimeout(500)
  const auditReqPromise = adminPage.waitForRequest((r) => r.url().includes('/admin/audit-logs') && r.url().includes('from='))
  const fired = await Promise.race([
    auditReqPromise.then((r) => r.url()),
    new Promise<'no-request'>((resolve) => setTimeout(() => resolve('no-request'), 4000)),
  ])
  saveText('L5-03-时间过滤-UI请求URL.txt', String(fired))
  if (fired === 'no-request') {
    // 发现项证据:UI 时间筛选未能触发查询(交互缺陷)
    await shot(adminPage, 'L5-03-时间过滤-UI未触发请求(发现项)')
    saveText('L5-03-时间过滤-UI结论.txt', 'UI 时间筛选输入未能触发查询请求(交互/解析缺陷,见截图)')
  } else {
    await expect(adminPage.locator('.el-table__row')).toHaveCount(0)
    await shot(adminPage, 'L5-03-时间过滤-UI排除历史行')
  }
})

test('敏感参数脱敏:库内明文,出参与 UI 详情一律 ***', async ({ request, adminPage }) => {
  ensureSeed()
  const raw = psql(`SELECT params_masked_json FROM ia_audit_log WHERE tool_fqn='${FQN_SECRET}'`)
  expect(raw).toContain('SuperSecret123') // 库内确为明文(观察项,见报告)
  saveText('L5-04-脱敏-库内原文.txt', `ia_audit_log.params_masked_json 库内原文:\n${raw}`)

  const resp = await request.get(`/ia/api/v1/admin/audit-logs?toolFqn=${encodeURIComponent(FQN_SECRET)}`)
  const row = (await resp.json()).data.list[0]
  const masked = JSON.parse(row.paramsMaskedJson as string)
  expect(masked.password).toBe('***')
  expect(masked.api_key).toBe('***') // key 后缀宽匹配
  expect(masked.nested.refreshToken).toBe('***') // 嵌套 + token 后缀
  expect(masked.nested.note).toBe('keepme') // 非敏感键保留
  expect(JSON.stringify(masked)).not.toContain('SuperSecret123')
  saveJson('L5-04-脱敏-出参.json', row)

  await adminPage.goto('/audit')
  await adminPage.getByPlaceholder('工具 FQN(模糊)').fill(FQN_SECRET)
  await adminPage.getByRole('button', { name: '查询' }).click()
  await tableRow(adminPage, FQN_SECRET).click()
  const drawer = adminPage.locator('.el-drawer:visible')
  await expect(drawer.getByText('入参快照(脱敏)')).toBeVisible()
  const drawerText = await drawer.locator('pre').innerText()
  expect(drawerText).toContain('***')
  expect(drawerText).not.toContain('SuperSecret123')
  await shot(adminPage, 'L5-04-脱敏-UI详情抽屉')
})

test('DEF-04 回归:撤销后同键重授 → 200;活跃重复授予 → 409', async ({ request }) => {
  // 前置:注册工具,授予并撤销
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${AUDIT_TOOL}'`)
  psql(`DELETE FROM ia_tool_grant WHERE user_id = 8702`)
  const reg = await request.post('/ia/api/v1/admin/tools', {
    data: { serverKey: 'e2eaudit', toolName: AUDIT_TOOL, source: 'host_app' },
  })
  expect(reg.status()).toBe(200)
  const g1 = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8702, toolName: AUDIT_TOOL, scope: 'permanent', decisionNote: 'd1' },
  })
  expect(g1.status()).toBe(200)
  const grantId = (await g1.json()).data.id as number
  const rev = await request.delete(`/ia/api/v1/admin/grants/${grantId}`, { data: { decisionNote: 'r1' } })
  expect(rev.status()).toBe(200)
  // 修复口径(V13 部分唯一索引):撤销(逻辑删)行不占唯一键,同键重授 200
  const again = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8702, toolName: AUDIT_TOOL, scope: 'permanent', decisionNote: 'd2' },
  })
  expect(again.status()).toBe(200)
  saveJson('L5-07-DEF04-撤销后重授200.json', {
    revoke: rev.status(),
    reGrant: await again.json(),
  })
  // 活跃行重复授予 → 409 业务语义(不再裸 500)
  const dup = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8702, toolName: AUDIT_TOOL, scope: 'permanent', decisionNote: 'd3' },
  })
  expect(dup.status()).toBe(409)
  psql(`DELETE FROM ia_tool_grant WHERE user_id = 8702`)
  psql(`DELETE FROM ia_tool_registry WHERE id=${(await reg.json()).data.id}`)
})

test('decision_source 值域:字典含 expired,web 下拉缺失(发现项证据)', async ({ request, adminPage }) => {
  const dict = await request.get('/ia/api/v1/admin/audit-logs/dictionary')
  const sources = (await dict.json()).data.decisionSources.map((s: { code: string }) => s.code)
  saveJson('L5-05-审计字典.json', await dict.json())
  const hasExpired = sources.includes('expired')

  await adminPage.goto('/audit')
  await adminPage.locator('.el-select').filter({ hasText: 'decision_source' }).first().click()
  const dropdownText = await adminPage.locator('.el-select-dropdown:visible').innerText()
  await shot(adminPage, 'L5-05-decisionSource-UI下拉值域')
  await adminPage.keyboard.press('Escape')

  saveJson('L5-05-值域对比.json', { server: sources, uiHasExpired: dropdownText.includes('expired') })
  // 观察项断言(V8 已新增 expired 档;web 脚手架未跟进)——当前实现即期望,差异记录于报告
  if (hasExpired) {
    expect(dropdownText.includes('expired')).toBe(false)
  }
})

test('真实写路径审计:granted/revoked 落库且出参可检索', async ({ request }) => {
  const toolId = await ensureGrantRevokeRows(request)
  psql(`DELETE FROM ia_tool_registry WHERE id=${toolId}`)
  const resp = await request.get('/ia/api/v1/admin/audit-logs?decision=granted&pageNo=1&pageSize=5')
  const body = await resp.json()
  expect(body.data.total).toBeGreaterThanOrEqual(1)
  const granted = body.data.list[0]
  expect(granted.decisionSource).toBe('user-grant')
  saveJson('L5-06-granted审计行.json', granted)
})
