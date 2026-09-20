/**
 * 业务线 4:管理站-授权管理(AdminGrantController /ia/api/v1/admin/grants)。
 *
 * 覆盖:授予(conversation/permanent,快照风险级与 schema 指纹)、
 * 校验矩阵(400/404/409)、撤销、失效原因展示(工具停用级联)。
 *
 * 稳定性:Playwright 在用例失败后会以新模块实例继续(worker salvage),
 * 模块级常量会重算 —— 故全文件用固定标识符(e2e_grant_tool / 固定用户 ID),
 * 每个用例开头自建前置(查库判定存在性,缺则补建),不依赖任何跨用例内存状态。
 */
import {
  test, expect, psql, saveJson, saveText, shot, messageToast, tableRow, confirmBox,
} from '../helpers/support'

const TOOL_NAME = 'e2e_grant_tool'
const SERVER_KEY = 'e2egrants'
const TOOL_FQN = `mcp__${SERVER_KEY}__${TOOL_NAME}`
const USER_A = 8901
const USER_B = 8902

const SCHEMA = JSON.stringify({ type: 'object', properties: { reportId: { type: 'string' } } })
const ANNOTATIONS = JSON.stringify({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })

const toolIdOf = () =>
  Number(psql(`SELECT id FROM ia_tool_registry WHERE tool_name='${TOOL_NAME}' AND deleted=false ORDER BY id DESC LIMIT 1`)) || 0

/** 前置:只读注解工具存在且启用(缺则注册,停用则启用);清理历史运行遗留授权行 */
async function ensureTool(request: import('@playwright/test').APIRequestContext) {
  psql(`DELETE FROM ia_tool_grant WHERE user_id IN (${USER_A}, ${USER_B}) AND tool_fqn LIKE 'mcp__e2e%'`) // 防复跑 500(DEF-04)
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${TOOL_NAME}' AND deleted=true`)
  const id = toolIdOf()
  if (id === 0) {
    const reg = await request.post('/ia/api/v1/admin/tools', {
      data: {
        serverKey: SERVER_KEY, toolName: TOOL_NAME, source: 'host_app', description: 'E2E 只读导出工具',
        parametersSchema: SCHEMA, annotationsJson: ANNOTATIONS,
      },
    })
    expect(reg.status()).toBe(200)
  } else {
    const tool = (await (await request.get(`/ia/api/v1/admin/tools/${id}`)).json()).data
    if (!tool.enabled) await request.post(`/ia/api/v1/admin/tools/${id}/enable`)
  }
}

/** 前置:某用户对固定工具存在一笔有效 permanent 授权 */
async function ensurePermanentGrant(request: import('@playwright/test').APIRequestContext, userId: number) {
  const list = await request.get(`/ia/api/v1/admin/grants?activeOnly=true&userId=${userId}&toolName=${TOOL_NAME}`)
  const existing = (await list.json()).data[0]
  if (existing) return existing
  const grant = await request.post('/ia/api/v1/admin/grants', {
    data: { userId, toolName: TOOL_NAME, scope: 'permanent', decisionNote: 'e2e 前置补授' },
  })
  expect(grant.status()).toBe(200)
  return (await grant.json()).data
}

test.afterAll(async () => {
  // 物理清理自建数据(DEF-03:逻辑删行会阻断同名工具重注册)
  psql(`DELETE FROM ia_tool_registry WHERE tool_name IN ('${TOOL_NAME}', 'e2e_disabled_tool')`)
  psql(`DELETE FROM ia_tool_grant WHERE user_id IN (${USER_A}, ${USER_B})`)
})

test('授予 permanent:列表展示快照(风险级/schema 指纹/来源/时间)', async ({ request, adminPage }) => {
  await ensureTool(request)
  // 清理复跑残留的同作用域有效授权,避免 409
  psql(`DELETE FROM ia_tool_grant WHERE user_id = ${USER_A} AND tool_fqn = '${TOOL_FQN}'`) // 防复跑 500(DEF-04)
  await adminPage.goto('/tools')
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  await adminPage.getByRole('button', { name: '代授' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder('宿主应用侧数字用户 ID').fill(String(USER_A))
  await dlg.locator('.el-select').click()
  await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: TOOL_NAME }).click()
  await dlg.getByText('总是允许(不过期)').click()
  await dlg.getByPlaceholder('授予说明(落 decision_note 与审计)').fill('e2e 永久授权')

  const grantResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/grants') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '授予' }).click()
  const resp = await grantResp
  const body = await resp.json()
  expect(body.data.scope).toBe('permanent')
  expect(body.data.toolFqn).toBe(TOOL_FQN)
  expect(body.data.riskAtGrant).toBe('low')
  expect(body.data.schemaSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(body.data.source).toBe('admin')
  expect(body.data.conversationId).toBeNull()
  saveJson('L4-01-授予permanent-响应.json', body)

  await expect(messageToast(adminPage, '授权已授予')).toBeVisible()
  const row = tableRow(adminPage, String(USER_A))
  await expect(row.getByText('总是允许')).toBeVisible()
  await expect(row.getByText('有效')).toBeVisible()
  await expect(row.getByText('管理员代授')).toBeVisible()
  await shot(adminPage, 'L4-01-授予permanent-列表展示')
})

test('授予 conversation:会话 ID 展示;UI 校验缺会话拦截', async ({ request, adminPage }) => {
  await ensureTool(request)
  psql(`DELETE FROM ia_tool_grant WHERE user_id = ${USER_B} AND tool_fqn = '${TOOL_FQN}'`) // 防复跑 500(DEF-04)
  await adminPage.goto('/tools')
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  await adminPage.getByRole('button', { name: '代授' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder('宿主应用侧数字用户 ID').fill(String(USER_B))
  await dlg.locator('.el-select').click()
  await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: TOOL_NAME }).click()
  await dlg.getByText('本会话(随会话失效)').click()
  // 缺会话 ID → UI 拦截
  await dlg.getByRole('button', { name: '授予' }).click()
  await expect(messageToast(adminPage, 'conversation 作用域必须携带会话 ID')).toBeVisible()
  await shot(adminPage, 'L4-02-conversation缺会话ID-UI拦截')
  await dlg.getByPlaceholder(/conversation_id/).fill('e2e-conv-permanent-l4')
  const grantResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/grants') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '授予' }).click()
  const resp = await grantResp
  expect(resp.status()).toBe(200)
  saveJson('L4-02-授予conversation-响应.json', await resp.json())
  const row = tableRow(adminPage, String(USER_B))
  await expect(row.getByText('本会话')).toBeVisible()
  await expect(row.getByText('e2e-conv-permanent-l4')).toBeVisible()
  await shot(adminPage, 'L4-02-授予conversation-列表展示')
})

test('授予校验矩阵:400(permanent 带会话/缺会话/未知 scope/停用工具)/404(未注册工具)/409(重复同作用域)', async ({ request }) => {
  await ensureTool(request)
  // 停用另一工具供「停用工具授予」用例
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='e2e_disabled_tool'`)
  const reg = await request.post('/ia/api/v1/admin/tools', {
    data: { serverKey: 'e2egrants2', toolName: 'e2e_disabled_tool', source: 'host_app' },
  })
  const disabledId = (await reg.json()).data.id as number
  await request.post(`/ia/api/v1/admin/tools/${disabledId}/disable`)
  try {
    const cases: Array<{ name: string; body: Record<string, unknown>; expectStatus: number; expectMsg?: string }> = [
      { name: 'permanent 携带会话 ID', body: { userId: USER_A, toolName: TOOL_NAME, scope: 'permanent', conversationId: 'conv-x' }, expectStatus: 400 },
      { name: 'conversation 缺会话 ID', body: { userId: USER_A, toolName: TOOL_NAME, scope: 'conversation' }, expectStatus: 400 },
      { name: '未知 scope', body: { userId: USER_A, toolName: TOOL_NAME, scope: 'session' }, expectStatus: 400 },
      { name: '未注册工具', body: { userId: USER_A, toolName: 'e2e_no_such_tool', scope: 'permanent' }, expectStatus: 404, expectMsg: '工具未注册' },
      { name: '停用工具授予', body: { userId: USER_A, toolName: 'e2e_disabled_tool', scope: 'permanent' }, expectStatus: 400, expectMsg: '已停用' },
    ]
    const results: unknown[] = []
    for (const c of cases) {
      const resp = await request.post('/ia/api/v1/admin/grants', { data: c.body })
      const body = await resp.json()
      expect(resp.status(), c.name).toBe(c.expectStatus)
      if (c.expectMsg) expect(body.msg, c.name).toContain(c.expectMsg)
      results.push({ case: c.name, http: resp.status(), code: body.code, msg: body.msg })
    }
    // 409:重复同作用域有效授权(先确保一笔存在)
    await ensurePermanentGrant(request, USER_A)
    const dup = await request.post('/ia/api/v1/admin/grants', { data: { userId: USER_A, toolName: TOOL_NAME, scope: 'permanent' } })
    expect(dup.status()).toBe(409)
    results.push({ case: '重复同作用域有效授权', http: 409 })
    // 撤销不存在的授权 → 404
    const revoke404 = await request.delete('/ia/api/v1/admin/grants/999999999', { data: { decisionNote: 'e2e' } })
    expect(revoke404.status()).toBe(404)
    results.push({ case: '撤销不存在授权', http: 404 })
    saveJson('L4-03-授予校验矩阵.json', results)
  } finally {
    await request.delete(`/ia/api/v1/admin/tools/${disabledId}`)
  }
})

test('撤销授权:列表移除、库层逻辑删、审计落 revoked', async ({ request, adminPage }) => {
  await ensureTool(request)
  await ensurePermanentGrant(request, USER_A)
  await adminPage.goto('/tools')
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  // 按工具名精确过滤,只看本工具的授权行
  await adminPage.getByPlaceholder('工具名(精确)').fill(TOOL_NAME)
  await adminPage.getByRole('button', { name: '查询' }).click()
  const row = tableRow(adminPage, String(USER_A))
  await expect(row).toBeVisible()
  const revokeResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/grants\/\d+$/) !== null && r.request().method() === 'DELETE')
  await row.getByRole('button', { name: '撤销' }).click()
  await confirmBox(adminPage, '确定')
  const resp = await revokeResp
  expect(resp.status()).toBe(200)
  saveJson('L4-04-撤销-响应.json', await resp.json())
  await expect(messageToast(adminPage, '已撤销')).toBeVisible()

  // 逻辑删行不再出现在任一视图(含失效记录)
  await expect(adminPage.locator('.el-table__row').filter({ hasText: String(USER_A) })).toHaveCount(0)
  await shot(adminPage, 'L4-04-撤销后列表')

  // 库层 + 审计佐证
  const dbRow = psql(`SELECT deleted, decision_note FROM ia_tool_grant WHERE user_id=${USER_A} AND tool_fqn='${TOOL_FQN}'
                      ORDER BY id DESC LIMIT 1`)
  saveText('L4-04-撤销-库层行.txt', `ia_tool_grant(user_id=${USER_A}) 最新行 deleted|decision_note:\n${dbRow}`)
  expect(dbRow).toContain('t|')
  const audit = psql(`SELECT decision, decision_source FROM ia_audit_log WHERE user_id=${USER_A} AND tool_fqn='${TOOL_FQN}'
                      ORDER BY id DESC LIMIT 2`)
  saveText('L4-04-撤销-审计行.txt', `ia_audit_log 最近两行 decision|decision_source:\n${audit}`)
  expect(audit).toContain('revoked')
})

test('失效原因展示:conversation 授权经工具停用级联失效,原因在列表可见', async ({ request, adminPage }) => {
  await ensureTool(request)
  // 确保 USER_B 有本工具的 conversation 有效授权
  psql(`DELETE FROM ia_tool_grant WHERE user_id = ${USER_B} AND tool_fqn = '${TOOL_FQN}'`) // 防复跑 500(DEF-04)
  const grant = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: USER_B, toolName: TOOL_NAME, scope: 'conversation', conversationId: 'e2e-conv-invalidate', decisionNote: 'e2e 失效展示' },
  })
  expect(grant.status()).toBe(200)
  const grantId = (await grant.json()).data.id as number
  // 停用工具级联失效
  const dis = await request.post(`/ia/api/v1/admin/tools/${toolIdOf()}/disable`)
  expect(dis.status()).toBe(200)
  const grants = await request.get(`/ia/api/v1/admin/grants?activeOnly=false&userId=${USER_B}`)
  const row = (await grants.json()).data.find((g: { id: number }) => g.id === grantId)
  expect(row.invalidated).toBe(true)
  expect(row.invalidatedReason).toBe('tool_disabled')
  saveJson('L4-05-级联失效-响应.json', row)

  await adminPage.goto('/tools')
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  const uiRow = tableRow(adminPage, String(USER_B))
  await expect(uiRow.getByText('工具已停用')).toBeVisible()
  await shot(adminPage, 'L4-05-失效原因展示(tool_disabled)')
})
