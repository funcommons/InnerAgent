/**
 * 业务线 3:管理站-工具注册与分诊(AdminToolController)。
 *
 * 覆盖:注册必填校验(UI 拦截)、注册成功(FQN/指纹/默认中危)、
 * 删除类关键词强制高危且不可下调(400)、schema 活刷新分诊三态
 * (unchanged/compatible/breaking→confirm|reject)、breaking 级联失效授权、
 * 停用/启用(级联 tool_disabled)、schema 历史(V14 留痕)。
 *
 * DEF-02(已修复,回归口径):管理站 UI「刷新」按钮的空体分诊现按
 * 「未重发 schema」处理 → verdict=unchanged(schema_not_resent),指纹基准
 * 保持现库值,空串指纹绝不入库。本文件用独立无 schema 工具验证 unchanged 档,
 * 并单列一个 DEF-02 回归用例(R1 取证断言已反转)。
 *
 * 稳定性:worker 可能在用例失败后重启并重求值本模块(名称会变),
 * 故所有用例经「现查库取 id + API 自建前置」自洽,分诊前先归位基准 schema。
 */
import {
  test, expect, psql, saveJson, saveText, shot, messageToast, tableRow, unique, confirmBox,
} from '../helpers/support'

// 固定标识符(worker 失败续跑会以新模块实例重算随机常量,不可跨用例依赖)
const serverKey = 'e2etools'
const normalTool = 'e2e_refresh_tool'
const deleteTool = 'e2e_delete_tool'
const pingTool = 'e2e_ping_tool'
// 状态自洽:id 现查库
const toolIdOf = (name: string) =>
  Number(psql(`SELECT id FROM ia_tool_registry WHERE tool_name='${name}' AND deleted=false ORDER BY id DESC LIMIT 1`)) || 0
const normalToolId = () => toolIdOf(normalTool)

const V1 = JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } })
const V2 = JSON.stringify({ type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } })
const V3 = JSON.stringify({ type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name', 'age'] })
const V4 = JSON.stringify({ type: 'object', properties: { name: { type: 'number' }, age: { type: 'integer' } }, required: ['name', 'age'] })

/** 确保普通工具存在(不存在则注册,基准 schema V1) */
async function ensureNormalTool(request: import('@playwright/test').APIRequestContext) {
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${normalTool}' AND deleted=true`)
  const existing = normalToolId()
  if (existing === 0) {
    const reg = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName: normalTool, source: 'host_app', description: 'E2E 普通读工具', parametersSchema: V1 },
    })
    expect(reg.status()).toBe(200)
  } else {
    // 复用前归位:清待确认态、恢复启用(免疫上一次运行残留)
    const t = (await (await request.get(`/ia/api/v1/admin/tools/${existing}`)).json()).data
    if (t.revalidateRequired) await request.post(`/ia/api/v1/admin/tools/${existing}/schema/reject`)
    if (!t.enabled) await request.post(`/ia/api/v1/admin/tools/${existing}/enable`)
  }
}
/** 把普通工具 schema 归位到指定版本(空体副作用免疫:重复刷新同版即 unchanged) */
async function normalizeSchema(request: import('@playwright/test').APIRequestContext, schemaJson: string) {
  await ensureNormalTool(request)
  const resp = await request.post(`/ia/api/v1/admin/tools/${normalToolId()}/schema`, {
    data: { parametersSchema: schemaJson },
  })
  expect(resp.status()).toBe(200)
}

/** 工具表按关键字过滤并等待查询生效(客户端分页,保证目标行落在第 1 页) */
async function filterToolRow(adminPage: import('@playwright/test').Page, keyword: string) {
  await adminPage.getByPlaceholder('工具名 / FQN / 描述').fill(keyword)
  await adminPage.getByRole('button', { name: '查询' }).click()
  await adminPage.waitForTimeout(300)
}

test.afterAll(async () => {
  // 物理清理自建工具(逻辑删行会阻断同名重注册,见 DEF-03;为可复跑直接删行)
  psql(`DELETE FROM ia_tool_registry WHERE tool_name IN ('${normalTool}', '${deleteTool}', '${pingTool}')`)
})

test('注册必填校验:UI 客户端拦截,不发起网络请求', async ({ adminPage }) => {
  await adminPage.goto('/tools')
  await expect(adminPage.getByRole('tab', { name: '工具注册表' })).toBeVisible()
  await adminPage.getByRole('button', { name: '注册工具' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByRole('button', { name: '注册', exact: true }).click()
  await expect(messageToast(adminPage, 'serverKey 与工具名必填')).toBeVisible()
  await shot(adminPage, 'L3-01-注册必填校验-客户端拦截')
  // 非法 schema JSON 亦被客户端拦截
  await dlg.getByPlaceholder(/FQN 前缀/).fill(serverKey)
  await dlg.getByPlaceholder(/MCP tools\/list/).fill(normalTool)
  await dlg.getByPlaceholder(/JSON Schema/).fill('not-json')
  await dlg.getByRole('button', { name: '注册', exact: true }).click()
  await expect(messageToast(adminPage, '入参 Schema 须为合法 JSON')).toBeVisible()
  await shot(adminPage, 'L3-01-注册schema非法JSON拦截')
})

test('注册普通工具:FQN 生成、schema 指纹回显、默认中危', async ({ adminPage, request }) => {
  await ensureNormalTool(request)
  await adminPage.goto('/tools')
  await adminPage.getByRole('button', { name: '注册工具' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  const oneOff = `probe_${Date.now().toString(36)}` // 用完即删的一次性工具(仅本用例内使用)
  await dlg.getByPlaceholder(/FQN 前缀/).fill(serverKey)
  await dlg.getByPlaceholder(/MCP tools\/list/).fill(oneOff)
  await dlg.locator('textarea').nth(0).fill('E2E 一次性探针工具')
  await dlg.getByPlaceholder(/JSON Schema/).fill(V1)
  const regResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/tools') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '注册', exact: true }).click()
  const resp = await regResp
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.data.fqn).toBe(`mcp__${serverKey}__${oneOff}`)
  expect(body.data.schemaSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(body.data.riskLevel).toBe('medium') // 无注解 → 默认中危
  expect(body.data.revalidateRequired).toBe(false)
  saveJson('L3-02-注册工具-响应.json', body)
  await expect(messageToast(adminPage, '指纹已生成')).toBeVisible()
  await shot(adminPage, 'L3-02-注册工具成功(默认中危)')
  await filterToolRow(adminPage, oneOff)
  await expect(tableRow(adminPage, oneOff)).toBeVisible()
  await request.delete(`/ia/api/v1/admin/tools/${toolIdOf(oneOff)}`)
})

test('delete 关键词强制高危;风险下调被服务端 400 拒绝', async ({ request, adminPage }) => {
  // 复跑防重:物理清掉同名逻辑删行(DEF-03:逻辑删行会阻断重注册复活)
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${deleteTool}'`)
  await adminPage.goto('/tools')
  await adminPage.getByRole('button', { name: '注册工具' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder(/FQN 前缀/).fill(serverKey)
  await dlg.getByPlaceholder(/MCP tools\/list/).fill(deleteTool)
  await dlg.locator('textarea').nth(0).fill('E2E 删除类工具(名称含 delete)')
  const regResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/tools') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '注册', exact: true }).click()
  const resp = await regResp
  expect([200, 409]).toContain(resp.status())
  let body = await resp.json()
  if (resp.status() === 409) {
    // 复跑重注册被拒:读现库工具态继续断言
    const cur = await request.get(`/ia/api/v1/admin/tools/${toolIdOf(deleteTool)}`)
    body = await cur.json()
  }
  expect(body.data.riskLevel).toBe('high') // 工具名命中删除类关键词 → 强制高危
  saveJson('L3-03-强制高危注册-响应.json', body)
  await expect(messageToast(adminPage, '高危')).toBeVisible()
  await shot(adminPage, 'L3-03-delete关键词强制高危注册')

  // 下调尝试:策略对话框选低危 → 服务端 400
  await filterToolRow(adminPage, deleteTool)
  await tableRow(adminPage, deleteTool).getByRole('button', { name: '策略' }).click()
  const policyDlg = adminPage.locator('.el-dialog:visible')
  await policyDlg.locator('.el-radio-button').filter({ hasText: '低危' }).click()
  const putResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/tools\/\d+$/) !== null && r.request().method() === 'PUT')
  await policyDlg.getByRole('button', { name: '保存' }).click()
  const downResp = await putResp
  expect(downResp.status()).toBe(400)
  const downBody = await downResp.json()
  expect(downBody.msg).toContain('强制高危,不可下调')
  saveJson('L3-04-风险下调被拒-响应.json', { status: downResp.status(), ...downBody })
  await expect(messageToast(adminPage, '不可下调')).toBeVisible()
  await shot(adminPage, 'L3-04-强制高危下调-400错误态')
  await policyDlg.getByRole('button', { name: '取消' }).click()
})

test('分诊 unchanged:无 schema 工具上 UI「刷新」→ 静默刷新', async ({ request, adminPage }) => {
  // 前置:无入参 schema 的工具(空对空 → 指纹相同 → unchanged);缺则注册
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${pingTool}' AND deleted=true`)
  if (toolIdOf(pingTool) === 0) {
    const reg = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName: pingTool, source: 'host_app', description: 'E2E 无参工具' },
    })
    expect(reg.status()).toBe(200)
  }

  await adminPage.goto('/tools')
  await filterToolRow(adminPage, pingTool)
  const triResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/tools\/\d+\/schema$/) !== null)
  await tableRow(adminPage, pingTool).getByRole('button', { name: '刷新' }).click()
  const resp = await triResp
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.data.verdict).toBe('unchanged')
  saveJson('L3-05-分诊unchanged-响应.json', body)
  await expect(messageToast(adminPage, '无变更(静默刷新)')).toBeVisible()
  await shot(adminPage, 'L3-05-分诊unchanged-静默刷新')

  const history = await request.get(`/ia/api/v1/admin/tools/${toolIdOf(pingTool)}/schema-history`)
  expect((await history.json()).data.some((h: { outcome: string }) => h.outcome === 'silent_refresh')).toBe(true)
})

test('DEF-02 回归:UI「刷新」空体分诊 → unchanged,指纹基准不被空串覆写', async ({ request }) => {
  // 前置:普通工具带 V1 schema(归位并取当前指纹基准)
  await normalizeSchema(request, V1)
  const id = normalToolId()
  const before = (await (await request.get(`/ia/api/v1/admin/tools/${id}`)).json()).data
  const shaBaseline = before.schemaSha256 as string
  expect(shaBaseline).toMatch(/^[0-9a-f]{64}$/)
  // 模拟管理站「刷新」按钮的空体调用
  const resp = await request.post(`/ia/api/v1/admin/tools/${id}/schema`, { data: {} })
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  // 修复口径(DEF-02):空体 = 未重发 schema → unchanged,理由 schema_not_resent
  expect(body.data.verdict).toBe('unchanged')
  expect(body.data.reasons).toContain('schema_not_resent')
  expect(body.data.effectiveSchemaSha256).toBe(shaBaseline) // 指纹保持现库值,不退化为空串指纹
  saveJson('L3-05b-DEF02-空体分诊-响应.json', body)

  // 库内指纹与 schema 内容保持一致,无 pending
  const tool = await request.get(`/ia/api/v1/admin/tools/${id}`)
  const after = (await tool.json()).data
  expect(after.parametersSchema).not.toBeNull()
  expect(after.schemaSha256).toBe(shaBaseline)
  expect(after.pendingSchemaSha256).toBeNull()
  saveJson('L3-05b-DEF02-刷新后工具实态.json', after)
  saveText('L3-05b-DEF02-结论.txt',
    'UI「刷新」空体分诊(修复后回归口径):verdict=unchanged(schema_not_resent),\n' +
    'effectiveSchemaSha256 保持现库指纹;空串指纹不覆写 schema_sha256、不落 pending,\n' +
    '历史留痕为 silent_refresh —— 指纹链路与授权快照基准不再失真(DEF-02 修复验证)。')
  // 归位:重新刷回 V1,供后续用例使用
  await normalizeSchema(request, V1)
})

test('分诊 compatible:新增可选属性 → 自动生效,指纹更新', async ({ request, adminPage }) => {
  await normalizeSchema(request, V1)
  const resp = await request.post(`/ia/api/v1/admin/tools/${normalToolId()}/schema`, {
    data: { parametersSchema: V2, toolVersion: 'v2' },
  })
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.data.verdict).toBe('compatible')
  expect(body.data.revalidateRequired).toBe(false)
  expect(body.data.effectiveSchemaSha256).toMatch(/^[0-9a-f]{64}$/) // 新指纹立即生效
  expect(body.data.pendingSchemaSha256).toBeNull() // 无暂存
  saveJson('L3-06-分诊compatible-响应.json', body)

  // UI 侧核验:指纹已切到新值,无「待重新确认」标记
  await adminPage.goto('/tools')
  await filterToolRow(adminPage, normalTool)
  const row = tableRow(adminPage, normalTool)
  await expect(row).toBeVisible()
  await expect(row.getByText('待重新确认')).toHaveCount(0)
  await shot(adminPage, 'L3-06-分诊compatible-UI指纹已更新')
})

test('分诊 breaking:新增必填 → 待确认 + 存量授权自动失效;confirm 应用暂存', async ({ request, adminPage }) => {
  await normalizeSchema(request, V2)
  psql(`DELETE FROM ia_tool_grant WHERE user_id = 8802`) // 防复跑 500(DEF-04:逻辑删行占唯一键)
  // 先授一笔有效授权(permanent),验证 breaking 级联
  const grant = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8802, toolName: normalTool, scope: 'permanent', decisionNote: 'e2e breaking 级联预置' },
  })
  expect(grant.status()).toBe(200)
  const grantId = (await grant.json()).data.id as number

  const resp = await request.post(`/ia/api/v1/admin/tools/${normalToolId()}/schema`, {
    data: { parametersSchema: V3 },
  })
  expect(resp.status()).toBe(200)
  const triage = await resp.json()
  expect(triage.data.verdict).toBe('breaking')
  expect(triage.data.revalidateRequired).toBe(true)
  expect(triage.data.reasons.join()).toContain('required_added:age')
  saveJson('L3-07-分诊breaking-响应.json', triage)

  // 授权已被级联失效(schema_breaking)
  const grants = await request.get('/ia/api/v1/admin/grants?activeOnly=false')
  const invalidated = (await grants.json()).data.find((g: { id: number }) => g.id === grantId)
  expect(invalidated.invalidated).toBe(true)
  expect(invalidated.invalidatedReason).toBe('schema_breaking')
  saveJson('L3-07-级联失效授权-响应.json', invalidated)

  // UI:待重新确认标记 + 确认/拒绝按钮出现;授权页签展示失效原因
  await adminPage.goto('/tools')
  await filterToolRow(adminPage, normalTool)
  const row = tableRow(adminPage, normalTool)
  await expect(row.getByText('待重新确认')).toBeVisible()
  await expect(row.getByRole('button', { name: '确认' })).toBeVisible()
  await expect(row.getByRole('button', { name: '拒绝' })).toBeVisible()
  await shot(adminPage, 'L3-07-breaking-待确认态')
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  await expect(adminPage.locator('.el-table__row').filter({ hasText: 'schema 安全相关变更' }).first()).toBeVisible()
  await shot(adminPage, 'L3-07-breaking-授权级联失效展示')

  // 确认应用暂存 schema:指纹切到 pending 值,授权不复活
  await adminPage.getByRole('tab', { name: '工具注册表' }).click()
  await filterToolRow(adminPage, normalTool)
  const pendingSha = triage.data.pendingSchemaSha256
  const confirmResp = adminPage.waitForResponse((r) => r.url().endsWith('/schema/confirm'))
  await tableRow(adminPage, normalTool).getByRole('button', { name: '确认' }).click()
  await confirmBox(adminPage, '确认应用')
  const conf = await confirmResp
  expect(conf.status()).toBe(200)
  const confBody = await conf.json()
  expect(confBody.data.schemaSha256).toBe(pendingSha)
  expect(confBody.data.revalidateRequired).toBe(false)
  saveJson('L3-08-confirm-响应.json', confBody)
  await expect(messageToast(adminPage, '已应用暂存 schema')).toBeVisible()
  await shot(adminPage, 'L3-08-确认应用暂存schema')
  const grantsAfter = await request.get('/ia/api/v1/admin/grants?activeOnly=false')
  const stillInvalid = (await grantsAfter.json()).data.find((g: { id: number }) => g.id === grantId)
  expect(stillInvalid.invalidated).toBe(true) // 分诊时已失效,确认后不复活
})

test('分诊 breaking → reject:保持旧 schema 生效', async ({ request, adminPage }) => {
  await normalizeSchema(request, V3)
  const before = await request.get(`/ia/api/v1/admin/tools/${normalToolId()}`)
  const shaBefore = (await before.json()).data.schemaSha256

  await request.post(`/ia/api/v1/admin/tools/${normalToolId()}/schema`, { data: { parametersSchema: V4 } })
  await adminPage.goto('/tools')
  await filterToolRow(adminPage, normalTool)
  const row = tableRow(adminPage, normalTool)
  await expect(row.getByText('待重新确认')).toBeVisible()
  const rejectResp = adminPage.waitForResponse((r) => r.url().endsWith('/schema/reject'))
  await row.getByRole('button', { name: '拒绝' }).click()
  const rej = await rejectResp
  expect(rej.status()).toBe(200)
  saveJson('L3-09-reject-响应.json', await rej.json())
  await expect(messageToast(adminPage, '保持旧 schema')).toBeVisible()
  await shot(adminPage, 'L3-09-拒绝暂存变更')

  const after = await request.get(`/ia/api/v1/admin/tools/${normalToolId()}`)
  const afterBody = await after.json()
  expect(afterBody.data.schemaSha256).toBe(shaBefore) // 旧指纹保持
  expect(afterBody.data.revalidateRequired).toBe(false)
  saveJson('L3-09-reject后工具态.json', afterBody)
})

test('停用/启用:停用级联失效授权(tool_disabled),启用恢复可见', async ({ request, adminPage }) => {
  await normalizeSchema(request, V2)
  psql(`DELETE FROM ia_tool_grant WHERE user_id IN (8804, 8803)`) // 防复跑 500(DEF-04)
  const grant = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8804, toolName: normalTool, scope: 'permanent', decisionNote: 'e2e 停用级联预置' },
  })
  expect(grant.status()).toBe(200)
  const grantId = (await grant.json()).data.id as number

  await adminPage.goto('/tools')
  await filterToolRow(adminPage, normalTool)
  const row = tableRow(adminPage, normalTool)
  const disableResp = adminPage.waitForResponse((r) => r.url().endsWith('/disable'))
  await row.getByRole('button', { name: '停用', exact: true }).click()
  await confirmBox(adminPage, '停用')
  const dis = await disableResp
  expect(dis.status()).toBe(200)
  const disBody = await dis.json()
  expect(disBody.data.enabled).toBe(false)
  saveJson('L3-10-停用-响应.json', disBody)
  await expect(messageToast(adminPage, '已停用')).toBeVisible()
  await shot(adminPage, 'L3-10-停用工具')

  // 授权页签:失效原因 = 工具已停用
  await adminPage.getByRole('tab', { name: /用户授权/ }).click()
  await expect(adminPage.locator('.el-table__row').filter({ hasText: '工具已停用' }).first()).toBeVisible()
  await shot(adminPage, 'L3-10-停用级联授权失效展示')

  // 停用状态下授予被拒(400)
  const grantOnDisabled = await request.post('/ia/api/v1/admin/grants', {
    data: { userId: 8803, toolName: normalTool, scope: 'permanent' },
  })
  expect(grantOnDisabled.status()).toBe(400)
  saveJson('L3-10-停用工具授予被拒-响应.json', { status: grantOnDisabled.status(), body: await grantOnDisabled.json() })

  // 重新启用
  await adminPage.getByRole('tab', { name: '工具注册表' }).click()
  const enableResp = adminPage.waitForResponse((r) => r.url().endsWith('/enable'))
  await filterToolRow(adminPage, normalTool)
  await tableRow(adminPage, normalTool).getByRole('button', { name: '启用', exact: true }).click()
  const en = await enableResp
  expect(en.status()).toBe(200)
  expect((await en.json()).data.enabled).toBe(true)
  await expect(messageToast(adminPage, '已启用')).toBeVisible()
  await shot(adminPage, 'L3-11-重新启用工具')
})

test('schema 历史:全链路留痕(applied/pending_review/rejected/silent_refresh)', async ({ request }) => {
  const resp = await request.get(`/ia/api/v1/admin/tools/${normalToolId()}/schema-history`)
  expect(resp.status()).toBe(200)
  const history = (await resp.json()).data as Array<{ triage: string; outcome: string }>
  const outcomes = history.map((h) => `${h.triage}/${h.outcome}`)
  saveJson('L3-12-schema历史.json', history)
  saveText('L3-12-schema历史-结论序列.txt', outcomes.join('\n'))
  // 注册(applied)+ compatible/applied(L3-06;DEF-02 空体/归位现为 silent_refresh)
  // + breaking 待审×2 + 确认 applied + rejected
  expect(outcomes.filter((o) => o === 'breaking/pending_review').length).toBeGreaterThanOrEqual(2)
  expect(outcomes).toContain('breaking/applied')
  expect(outcomes).toContain('breaking/rejected')
  expect(outcomes).toContain('compatible/applied')
})

test('DEF-03 回归:注销→重注册复活生效 + 审计 tool_revived(不再静默占键)', async ({ request }) => {
  // [R2 新增回归] R1 取证: 复活分支 updateById 被 @TableLogic 附加 WHERE deleted=false
  // → 对死行更新 0 行, 响应 200 但库内仍 deleted → 工具永不生效且唯一键被占。
  // 修复: revive 显式 SQL 绕过逻辑删谓词 + 审计 tool_revived。
  const name = 'e2e_revive_tool'
  const fqn = `mcp__${serverKey}__${name}`
  // 防复跑: 物理清理同名行(含历史逻辑删行)与留痕
  psql(`DELETE FROM ia_tool_schema_history WHERE tool_id IN (SELECT id FROM ia_tool_registry WHERE tool_name='${name}')`)
  psql(`DELETE FROM ia_audit_log WHERE tool_fqn='${fqn}'`)
  psql(`DELETE FROM ia_tool_registry WHERE tool_name='${name}'`)
  try {
    // 1) 首次注册
    const reg1 = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName: name, source: 'host_app', description: 'E2E 复活回归(首次)', parametersSchema: V1 },
    })
    expect(reg1.status()).toBe(200)
    const id1 = Number((await reg1.json()).data.id)
    expect(id1, '首次注册拿到活跃行 id').toBeGreaterThan(0)

    // 2) 注销(API 删除 = 逻辑删; 库内死行残留并占唯一键)
    const del = await request.delete(`/ia/api/v1/admin/tools/${id1}`)
    expect(del.status()).toBe(200)
    const deadRow = psql(`SELECT id, deleted FROM ia_tool_registry WHERE id=${id1}`)
    saveText('L3-13-DEF03-注销后死行.txt', deadRow)
    expect(deadRow, '注销后为逻辑删行(deleted=true, 残留占键)').toContain('t')

    // 3) 同名重注册 → 200 且复活(修复前: 200 但库内仍 deleted, 静默失败)
    const reg2 = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName: name, source: 'host_app', description: 'E2E 复活回归(重注册)', parametersSchema: V1 },
    })
    expect(reg2.status()).toBe(200)
    const body2 = await reg2.json()
    expect(body2.data.fqn).toBe(fqn)
    const aliveRow = psql(`SELECT id, deleted, enabled FROM ia_tool_registry WHERE tool_name='${name}' AND deleted=false`)
    saveText('L3-13-DEF03-重注册后活跃行.txt', aliveRow)
    expect(aliveRow, '重注册后存在活跃行且同 id(复活而非新行)').toContain(`${id1}|f`)
    expect(aliveRow, '复活行默认启用').toContain('|t')

    // 4) 工具详情可达 + 分诊可达(toolIdOf 语义: 修复前活跃行不可见 → 404)
    const detail = await request.get(`/ia/api/v1/admin/tools/${id1}`)
    expect(detail.status(), '复活行详情 200(非 404)').toBe(200)
    const triage = await request.post(`/ia/api/v1/admin/tools/${id1}/schema`, { data: { parametersSchema: V1 } })
    expect(triage.status(), '同版分诊 200(unchanged 路径可达)').toBe(200)

    // 5) 审计: tool_revived(fqn 定位, FORCED_POLICY 来源)
    const audit = await request.get(`/ia/api/v1/admin/audit-logs?decision=tool_revived&toolFqn=${encodeURIComponent(fqn)}&pageNo=1&pageSize=10`)
    expect(audit.status()).toBe(200)
    const auditBody = await audit.json()
    saveJson('L3-13-DEF03-审计tool_revived.json', auditBody)
    expect(auditBody.data?.list?.length ?? 0, '复活审计 tool_revived 恰 1 条').toBe(1)
    expect(auditBody.data.list[0].toolFqn ?? auditBody.data.list[0].tool_fqn).toContain(name)
    saveText('L3-13-DEF03-结论.txt',
      '注销→重注册: 200 + 活跃行复活(同 id) + 详情/分诊可达 + 审计 tool_revived(DEF-03 修复验证)。')
  } finally {
    // 物理清理(仅保险 —— 复活路径正常后逻辑删行不复存在; 分册口径「物理清理仅保险」)
    psql(`DELETE FROM ia_tool_schema_history WHERE tool_id IN (SELECT id FROM ia_tool_registry WHERE tool_name='${name}')`)
    psql(`DELETE FROM ia_audit_log WHERE tool_fqn='${fqn}'`)
    psql(`DELETE FROM ia_tool_registry WHERE tool_name='${name}'`)
  }
})
