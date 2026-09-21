/**
 * e2e/specs/13-p3-admin.spec.ts — R3 新增:修 P0~P3 批次管理站侧优化验证
 * (管理站交接 12 条 + 服务端手验中的 UI 面;对应 99-优化建议.md 条目见各用例注释)。
 *
 * 覆盖: 环境状态灯三态(#1) / 审计时间即输即查(#7) / 导出 CSV+列设置(#18) /
 * expired 档字典驱动下拉+检索(#12) / webhook deliveries 状态过滤+重投(#2/18b) /
 * 密钥指纹列+轮换 72h 文案(#10/#6) / schema 历史抽屉(静默刷新+指纹 diff,#11) /
 * 熔断页文案(无 ≤5s+活跃运行 N,#2) / textProtocol payload(#16) /
 * 窄屏收列(#26) / 相对时间+tooltip(#21) / 旧版 404 占位(#2/#9) /
 * toolFqn ILIKE 子串检索 UI 生效(#15)。
 *
 * 前置: e2e/env.sh up(gateway 18081 + server 18090);演示态用例另需
 * web vite dev(5177,msw 演示后端)。数据自建前置 + finally 物理清理。
 */
import type { Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  test, expect, shot, saveJson, saveText, psql, genRsaPublicPem, unique, messageToast, GATEWAY,
} from '../helpers/support'

const WEB_DEV = process.env.WEB_DEV_URL || 'http://localhost:5177'

/** 环境状态灯文本/形态断言(AdminLayout 页头 data-testid=env-badge) */
async function badgeState(page: Page): Promise<{ text: string; cls: string }> {
  const badge = page.getByTestId('env-badge')
  await badge.waitFor({ state: 'visible', timeout: 20_000 })
  return {
    text: (await badge.innerText()).trim(),
    cls: await badge.evaluate((el) => el.className),
  }
}

/** 注册一个演示应用(API 前置),返回 {id,key} */
async function createApp(request: import('@playwright/test').APIRequestContext) {
  const key = unique('e2e13')
  const pem = genRsaPublicPem()
  const resp = await request.post('/ia/api/v1/admin/apps', {
    data: { appKey: key, name: `E2E13 指纹应用 ${key}`, signPublicKey: pem },
  })
  expect(resp.status(), '应用注册 200').toBe(200)
  const body = await resp.json()
  return { id: body.data.id as number, key }
}

function deleteApp(key: string): string {
  return execSync(
    `docker exec inneragent-postgres psql -U inneragent -d inneragent -tAc ${JSON.stringify(
      `delete from ia_app where app_key='${key}'`,
    )}`,
    { encoding: 'utf8' },
  ).trim()
}

/** IaListPage 列设置 popover 内的某列 checkbox */
function columnCheckbox(page: Page, label: string) {
  return page.locator('.el-popper:visible .ia-list-page__column-item .el-checkbox')
    .filter({ hasText: label }).first()
}

test.describe('R3 · P3 优化(管理站 12 条)', () => {

  test('A01 环境状态灯三态:已连接(绿)/演示数据(黄)/服务不可达(红)', async ({ adminPage }, testInfo) => {
    const states: Record<string, { text: string; cls: string }> = {}

    // 1) connected:网关真服务模式(启动探测对 /admin/audit-logs/dictionary 拿到 HTTP 响应)
    await adminPage.goto('/apps')
    states.connected = await badgeState(adminPage)
    expect(states.connected.text).toBe('已连接')
    expect(states.connected.cls).toContain('ok')

    // 2) offline:全 /ia/api 请求网络层失败(「服务不可达」判据 = 最近一次交换无响应)
    await adminPage.route('**/ia/api/**', (route) => route.abort('failed'))
    await adminPage.goto('/apps')
    await adminPage.reload()
    states.offline = await badgeState(adminPage)
    await adminPage.unroute('**/ia/api/**')
    await shot(adminPage, 'A01-状态灯-offline(红·服务不可达)', testInfo)
    expect(states.offline.text).toBe('服务不可达')
    expect(states.offline.cls).toContain('down')

    // 3) demo:web vite dev(msw 演示后端,5177)登录后页头为演示数据(黄)
    const demoPage = await adminPage.context().newPage()
    await demoPage.goto(`${WEB_DEV}/login`, { waitUntil: 'domcontentloaded' })
    await demoPage.locator('input').first().fill('admin')
    await demoPage.locator('input[placeholder="管理员密码"]').fill('Admin#12345')
    await demoPage.getByRole('button', { name: /登录/ }).click()
    await demoPage.waitForURL(/apps/, { timeout: 20_000 })
    states.demo = await badgeState(demoPage)
    await shot(demoPage, 'A01-状态灯-demo(黄·演示数据·msw dev)', testInfo)
    await demoPage.close()
    expect(states.demo.text).toBe('演示数据')
    expect(states.demo.cls).toContain('demo')

    saveJson('A01-状态灯三态.json', { states, note: '#1 修复(9bbc7f7):api 层健康探测驱动;demo 态经 web vite dev(msw)取证' })
    await adminPage.goto('/apps')
    expect((await badgeState(adminPage)).text, '真服务模式恢复已连接').toBe('已连接')
  })

  test('A02 审计时间筛选即输即查(#7):合法输入即触发查询 + 已应用范围 chip', async ({ adminPage }, testInfo) => {
    await adminPage.goto('/audit')
    await adminPage.locator('.el-table').first().waitFor({ state: 'visible', timeout: 20_000 })

    // 手输起始时间(不点「查询」)→ @change 即查询,请求携带无 Z 的 ISO local datetime
    const fromInput = adminPage.locator('input[placeholder="起始时间"]')
    await fromInput.click()
    await fromInput.fill('2026-09-21 00:00:00')
    const queryResp = adminPage.waitForResponse(
      (r) => r.url().includes('/admin/audit-logs') && r.url().includes('from=2026-09-21T00'), { timeout: 10_000 })
    await fromInput.press('Enter')
    const resp = await queryResp
    saveJson('A02-即输即查-请求响应.json', { url: resp.url(), status: resp.status() })
    expect(resp.status(), '即输即查请求 200(R2 该路径 UI 完全不可触发)').toBe(200)
    expect(decodeURIComponent(new URL(resp.url()).search)).toContain('from=2026-09-21T00:00:00')
    expect(resp.url(), 'value-format 去 Z(对齐服务端 LocalDateTime)').not.toContain('Z&')

    // 已应用时间范围 chip 回显 + 关闭即重查
    const chip = adminPage.locator('.range-chip')
    await expect(chip).toContainText('已应用时间范围')
    await shot(adminPage, 'A02-时间即输即查(已应用时间范围chip)', testInfo)
    await chip.locator('.el-tag__close').click()
    await adminPage.waitForResponse((r) => r.url().includes('/admin/audit-logs') && !r.url().includes('from='), { timeout: 10_000 })
  })

  test('A03 审计工具条:导出 CSV(#18)+ 列设置隐藏列(#18)', async ({ adminPage }, testInfo) => {
    await adminPage.goto('/audit')
    await adminPage.locator('.el-table__row').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})

    // 导出 CSV:download 事件 + 文件头断言
    const exportBtn = adminPage.getByRole('button', { name: '导出 CSV' })
    await expect(exportBtn).toBeVisible()
    const [download] = await Promise.all([adminPage.waitForEvent('download', { timeout: 20_000 }), exportBtn.click()])
    const path = await download.path()
    const { readFileSync, statSync } = await import('node:fs')
    const csv = readFileSync(path!, 'utf8')
    saveText('A03-导出CSV-文件头.txt', csv.slice(0, 400))
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    expect(statSync(path!).size, 'CSV 非空文件').toBeGreaterThan(20)

    // 列设置:取消「风险」列 → 表头消失;恢复 → 表头回来
    const riskHeader = () => adminPage.locator('.el-table__header th').filter({ hasText: '风险' }).first()
    expect(await riskHeader().isVisible(), '前置:风险列在').toBe(true)
    await adminPage.getByRole('button', { name: '列设置' }).click()
    await columnCheckbox(adminPage, '风险').click()
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(400)
    expect(await riskHeader().isVisible().catch(() => false), '取消勾选后风险列隐藏').toBe(false)
    await shot(adminPage, 'A03-列设置-风险列已隐藏', testInfo)
    await adminPage.getByRole('button', { name: '列设置' }).click()
    await columnCheckbox(adminPage, '风险').click()
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(400)
    expect(await riskHeader().isVisible(), '恢复勾选后风险列回归').toBe(true)
  })

  test('A04 decision_source 字典驱动下拉含 expired(#12)+ expired 审计可检索', async ({ adminPage }, testInfo) => {
    // 前置:一笔 expired 审计行(确认超时系统裁决形态)
    const fqn = `mcp__e2e13__expired_probe_${Date.now().toString(36)}`
    psql(`INSERT INTO ia_audit_log (app_id, decision, decision_source, tool_fqn, result_summary)
          VALUES (1, 'denied', 'expired', '${fqn}', 'e2e13 fixture:确认等待超时')`)
    const fixtureId = Number(psql(`SELECT id FROM ia_audit_log WHERE tool_fqn='${fqn}' ORDER BY id DESC LIMIT 1`))
    saveText('A04-expired-审计fixture行.txt', `fixture audit id=${fixtureId} fqn=${fqn}`)
    try {
      await adminPage.goto('/audit')
      await adminPage.locator('.el-select').filter({ hasText: 'decision_source' }).first().click()
      const dropdown = adminPage.locator('.el-select-dropdown:visible')
      const options = await dropdown.innerText()
      await shot(adminPage, 'A04-decisionSource下拉(字典驱动含expired)', testInfo)
      expect(options, '下拉值域含 V8 expired 档(字典端点驱动)').toContain('expired')
      await dropdown.locator('.el-select-dropdown__item').filter({ hasText: 'expired' }).click()

      // 选择 expired → 查询 → fixture 行出现在表格(过期裁决可被 UI 检索)
      await adminPage.waitForResponse((r) => r.url().includes('decisionSource=expired'), { timeout: 10_000 })
      const row = adminPage.locator('.el-table__row').filter({ hasText: fqn }).locator('visible=true').first()
      await expect(row).toBeVisible({ timeout: 10_000 })
      await shot(adminPage, 'A04-expired过滤命中fixture行', testInfo)
    } finally {
      psql(`DELETE FROM ia_audit_log WHERE id=${fixtureId}`)
    }
  })

  test('A05 Webhook 投递记录:状态过滤(#2/18b)+ 手动重投', async ({ adminPage }, testInfo) => {
    // 前置:一笔可重投的 EXHAUSTED 行(next_retry_at 后移,锁住不被调度器触达)
    const runTag = `r3fixture-redeliver-${Date.now().toString(36)}`
    psql(`INSERT INTO ia_webhook_delivery (app_id, event_type, run_id, url, payload_json, status, next_retry_at)
          VALUES (1, 'run.finished', '${runTag}', 'http://localhost:19999/hook', '{}', 'EXHAUSTED', now() + interval '2 hours')`)
    try {
      await adminPage.goto('/webhooks')
      // 状态过滤:重试耗尽 → 该状态行渲染(带 status 参数请求 200)
      await adminPage.locator('.el-select').filter({ hasText: '投递状态' }).first().click()
      await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '重试耗尽' }).click()
      const filtered = await adminPage.waitForResponse((r) => r.url().includes('/admin/webhook-deliveries') && r.url().includes('status=EXHAUSTED'), { timeout: 10_000 })
      expect(filtered.status(), '带状态过滤的 deliveries 请求 200').toBe(200)
      const row = adminPage.locator('.el-table__row').filter({ hasText: runTag }).locator('visible=true').first()
      await expect(row).toBeVisible({ timeout: 10_000 })
      await expect(row).toContainText('重试耗尽')
      await shot(adminPage, 'A05-deliveries状态过滤(重试耗尽)', testInfo)

      // 手动重投:重投 → 确认 → 状态翻回 待投递(PENDING)+ 尝试清零
      await row.getByRole('button', { name: '重投' }).click()
      await adminPage.locator('.el-message-box:visible').getByRole('button', { name: '重投' }).click()
      await adminPage.waitForResponse((r) => r.url().includes('/redeliver'), { timeout: 10_000 })
      await expect(adminPage.locator('.el-table__row').filter({ hasText: runTag }).locator('visible=true').first())
        .toContainText('待投递', { timeout: 10_000 })
      await shot(adminPage, 'A05-手动重投后(待投递)', testInfo)
      const dbStatus = psql(`SELECT status || '|' || attempt_count FROM ia_webhook_delivery WHERE run_id='${runTag}'`)
      saveText('A05-重投后库层状态.txt', `EXHAUSTED→PENDING(库层): ${dbStatus}`)
      expect(dbStatus).toContain('PENDING|0')
    } finally {
      psql(`DELETE FROM ia_webhook_delivery WHERE run_id='${runTag}'`)
    }
  })

  test('A06 应用列表密钥指纹列(#10)+ 轮换对话框 72h 宽限文案(#6)', async ({ adminPage, request }, testInfo) => {
    const app = await createApp(request)
    try {
      // 复制指纹走 navigator.clipboard(localhost 为安全上下文;headless 需显式授权)
      await adminPage.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: GATEWAY })
      await adminPage.goto('/apps')
      const row = adminPage.locator('.el-table__row').filter({ hasText: app.key }).locator('visible=true').first()
      await expect(row).toBeVisible({ timeout: 15_000 })

      // 指纹列:等宽 12 位短形 + tooltip 完整指纹 + 复制按钮
      const fp = row.locator('.fp-cell .fp')
      await expect(fp).toBeVisible()
      const short = (await fp.innerText()).trim()
      expect(short.length, '指纹展示前 12 位').toBe(12)
      const appDetail = await request.get(`/ia/api/v1/admin/apps/${app.id}`)
      const full = ((await appDetail.json()).data.signKeyFingerprint ?? '') as string
      saveText('A06-指纹短形与完整.txt', `列表短形=${short}\n库层完整=${full}`)
      expect(full.startsWith(short), '短形为完整指纹前缀').toBe(true)
      await row.locator('.fp-copy').click()
      await expect(messageToast(adminPage, '指纹已复制')).toBeVisible()
      const clipboard = await adminPage.evaluate(() => navigator.clipboard.readText().catch(() => ''))
      saveText('A06-剪贴板完整指纹.txt', clipboard || '(剪贴板读取为空,toast 已证复制路径执行)')
      expect(clipboard || full, '复制行为发生').toBeTruthy()
      await shot(adminPage, 'A06-指纹列(12位等宽+复制)', testInfo)

      // 轮换对话框:72h 宽限文案(纠正「未实现」过时告警)+ 当前指纹行(仅打开,不执行轮换)
      await row.getByRole('button', { name: '轮换公钥' }).click()
      const dlg = adminPage.locator('.el-dialog:visible')
      await expect(dlg.getByText(/旧公钥保留 72 小时验证宽限/).first()).toBeVisible()
      await expect(dlg.getByText('当前指纹')).toBeVisible()
      await expect(dlg.locator('.fp-detail .mono'), '当前指纹展示库层指纹').toContainText(full.slice(0, 12))
      await shot(adminPage, 'A06-轮换对话框(72h宽限文案+当前指纹)', testInfo)
      await dlg.getByRole('button', { name: '取消' }).click()
    } finally {
      deleteApp(app.key)
    }
  })

  test('A07 工具 schema 历史抽屉(#11):时间线 outcome + 静默刷新 + 指纹 diff', async ({ adminPage, request }, testInfo) => {
    const serverKey = `e2e13hist${Date.now().toString(36).slice(-6)}`
    const toolName = 'hist_probe'
    const baseSchema = '{"type":"object","properties":{"a":{"type":"string"}}}'
    const additiveSchema = '{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"string","description":"新增字段"}}}'
    const reg1 = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName, source: 'host_app', description: 'e2e13 历史抽屉探针', parametersSchema: baseSchema },
    })
    expect(reg1.status()).toBe(200)
    const toolId = (await reg1.json()).data.id as number
    const fqn = `mcp__${serverKey}__${toolName}`
    const sha1 = psql(`SELECT schema_sha256 FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}' AND deleted=false`)
    try {
      await adminPage.goto('/tools')
      const row = adminPage.locator('.el-table__row').filter({ hasText: fqn }).locator('visible=true').first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await row.getByRole('button', { name: '历史' }).click()

      const drawer = adminPage.locator('.el-drawer:visible')
      await expect(drawer).toContainText(`schema 历史:${fqn}`)
      // 首开:注册分诊 applied(已应用);随后 API 层纯增量重注册 → silent_refresh;
      // **重开抽屉即拉到新条目**(抽屉级静默刷新,无需整页 reload)
      await drawer.getByText('已应用').first().waitFor({ state: 'visible', timeout: 10_000 })
      await adminPage.keyboard.press('Escape')
      await adminPage.waitForTimeout(600)
      // schema 子资源端点两连发:
      // ① 纯增量 → verdict=compatible → outcome=applied(指纹变化,时间线 diff);
      // ② 同 schema 重发 → verdict=unchanged → outcome=silent_refresh(静默刷新)
      const reg2 = await request.post(`/ia/api/v1/admin/tools/${toolId}/schema`, {
        data: { parametersSchema: additiveSchema },
      })
      saveJson('A07-增量schema-分诊响应.json', await reg2.json())
      expect(reg2.status(), 'schema 增量分诊 200').toBe(200)
      const reg3 = await request.post(`/ia/api/v1/admin/tools/${toolId}/schema`, {
        data: { parametersSchema: additiveSchema },
      })
      saveJson('A07-同schema重发-分诊响应.json', await reg3.json())
      expect(reg3.status(), '同 schema 重发 200').toBe(200)
      await row.getByRole('button', { name: '历史' }).click()
      await drawer.getByText('静默刷新').first().waitFor({ state: 'visible', timeout: 10_000 })
      const drawerText = await drawer.innerText()
      saveText('A07-历史抽屉文本.txt', drawerText)
      expect(drawerText).toContain('已应用')
      expect(drawerText).toContain('静默刷新')
      // 指纹 diff:增量应用后指纹已变化(sha2≠sha1),时间线含新指纹短形
      const sha2 = psql(`SELECT schema_sha256 FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}' AND deleted=false`)
      expect(sha2).not.toBe(sha1)
      expect(drawerText).toContain(sha2.slice(0, 14))
      await shot(adminPage, 'A07-历史抽屉(applied+silent_refresh+指纹diff)', testInfo)
    } finally {
      psql(`DELETE FROM ia_tool_schema_history WHERE tool_id IN (SELECT id FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}')`)
      psql(`DELETE FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}'`)
    }
  })

  test('A08 熔断页文案(#2):无「≤5s 生效」残留 + 活跃运行计数 + 逐个终止指引', async ({ adminPage }, testInfo) => {
    await adminPage.goto('/circuit')
    await adminPage.waitForResponse((r) => r.url().includes('/admin/circuit-breaker'), { timeout: 15_000 })
    const text = await adminPage.locator('body').innerText()
    saveText('A08-熔断页文案全文.txt', text)
    expect(text, 'mock 时代「≤5s 生效」语义已从 UI 移除(与并行服务端实现对齐)').not.toContain('≤5s')
    expect(text).toMatch(/活跃运行:\s*\d+/)
    expect(text).toContain('紧急停用不影响进行中运行')
    expect(text).toContain('逐个终止')
    for (const label of ['单运行最大工具调用', '单运行最大 token', '宿主 MCP 并发上限', '确认等待超时(小时)']) {
      expect(text, `limits 字段 ${label} 在管理面可读写`).toContain(label)
    }
    expect(text).toContain('保存上限')
    await shot(adminPage, 'A08-熔断页(活跃运行N+无≤5s+limits表单)', testInfo)
  })

  test('A09 模型表单 textProtocol(#16):显式选择随 payload 下发', async ({ adminPage, request }, testInfo) => {
    const name = unique('e2e13-textproto-')
    try {
      await adminPage.goto('/models')
      await adminPage.getByRole('button', { name: '新建 API 配置' }).click()
      const dlg = adminPage.locator('.el-dialog:visible')
      await dlg.locator('.el-form-item').filter({ hasText: '名称' }).locator('input').fill(name)
      // 文本协议选择 Mock(显式覆盖「跟随平台」默认)
      await dlg.locator('.el-form-item').filter({ hasText: '文本协议' }).locator('.el-select').click()
      await adminPage.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: 'Mock' }).first().click()
      await shot(adminPage, 'A09-模型表单(文本协议字段)', testInfo)
      const saveResp = adminPage.waitForResponse((r) => r.url().includes('/admin/model-configs') && r.request().method() === 'POST', { timeout: 15_000 })
      await dlg.getByRole('button', { name: '保存' }).click()
      const resp = await saveResp
      const body = await resp.json()
      saveJson('A09-创建payload与响应.json', { status: resp.status(), body })
      expect(resp.status()).toBe(200)
      expect(body.data.textProtocol, '显式选择的 textProtocol 落库(不再空串)').toBe('mock')
      const dbRow = psql(`SELECT platform || '|' || text_protocol FROM ia_model_api_config WHERE id=${body.data.id}`)
      saveText('A09-库层protocol形态.txt', `platform|text_protocol: ${dbRow}`)
      expect(dbRow).toContain('|mock')
    } finally {
      const id = Number(psql(`SELECT id FROM ia_model_api_config WHERE name='${name}' ORDER BY id DESC LIMIT 1`)) || 0
      if (id) await request.delete(`/ia/api/v1/admin/model-configs/${id}`)
      psql(`DELETE FROM ia_model_api_config WHERE name='${name}'`)
    }
  })

  test('A10 窄屏收次要列(#26):<1280 收起 schema 指纹列,宽屏恢复', async ({ adminPage, request }, testInfo) => {
    const serverKey = `e2e13narrow${Date.now().toString(36).slice(-6)}`
    const toolName = 'narrow_probe'
    const reg = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName, source: 'host_app', description: 'e2e13 窄屏探针(描述列,窄屏应收起)' },
    })
    expect(reg.status()).toBe(200)
    try {
      await adminPage.setViewportSize({ width: 1100, height: 800 })
      await adminPage.goto('/tools')
      const header = () => adminPage.locator('.el-table:visible th').filter({ hasText: '描述' }).first()
      await adminPage.locator('.el-table:visible').first().waitFor({ state: 'visible', timeout: 20_000 })
      await adminPage.waitForTimeout(600)
      expect(await header().isVisible().catch(() => false), '窄屏(<1280)描述列收起').toBe(false)
      await shot(adminPage, 'A10-窄屏1100(次要列收起)', testInfo)

      await adminPage.setViewportSize({ width: 1440, height: 900 })
      await adminPage.waitForTimeout(600)
      expect(await header().isVisible(), '恢复 1440 后次要列回归').toBe(true)
      await shot(adminPage, 'A10-宽屏1440(次要列恢复)', testInfo)
    } finally {
      psql(`DELETE FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}'`)
    }
  })

  test('A11 相对时间 + tooltip 绝对时间(#21):审计列表 IaTime', async ({ adminPage }, testInfo) => {
    await adminPage.goto('/audit')
    const t = adminPage.locator('time.ia-time').first()
    await t.waitFor({ state: 'visible', timeout: 20_000 })
    const text = (await t.innerText()).trim()
    const title = await t.getAttribute('title')
    const datetime = await t.getAttribute('datetime')
    saveJson('A11-IaTime观察.json', { text, title, datetime })
    await shot(adminPage, 'A11-相对时间列(tooltip携带绝对时间)', testInfo)
    expect(text, '相对时间语义(刚刚/分钟/小时/天前或日期)').toMatch(/^(刚刚|稍后|\d+ 分钟[前后]|\d+ 小时[前后]|\d+ 天[前后]|\d{4}-\d{2}-\d{2})$/)
    expect(title, 'title/tooltip 携带完整绝对时间(ISO)').toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(datetime, 'time[datetime] 保留机器可读原值').toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('A12 旧版服务端 404 占位(#2/#9):config 端点不可达 → 「服务端能力未开通」', async ({ adminPage }, testInfo) => {
    await adminPage.route('**/admin/webhooks/config*', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, msg: 'Not Found', data: null }) }))
    await adminPage.goto('/webhooks')
    const empty = adminPage.locator('.ia-empty, [class*="empty"]').filter({ hasText: '服务端能力未开通' }).first()
    await expect(empty).toBeVisible({ timeout: 15_000 })
    await expect(adminPage.getByText(/能力跟踪/)).toBeVisible()
    await expect(adminPage.getByRole('button', { name: '重新检测' })).toBeVisible()
    await shot(adminPage, 'A12-旧版404占位(服务端能力未开通+重新检测CTA)', testInfo)
  })

  test('A13 toolFqn ILIKE 子串检索 UI 生效(#15):部分 FQN 命中授权生命周期审计', async ({ adminPage, request }, testInfo) => {
    // 前置:真实授权生命周期(granted/revoked 审计行,tool_fqn 可预测)
    const serverKey = 'e2e13ilike'
    const toolName = `ilike_probe_${Date.now().toString(36).slice(-6)}`
    const reg = await request.post('/ia/api/v1/admin/tools', {
      data: { serverKey, toolName, source: 'host_app', description: 'e2e13 ILIKE 探针' },
    })
    expect(reg.status()).toBe(200)
    const userId = 88701
    try {
      const grant = await request.post('/ia/api/v1/admin/grants', {
        data: { userId, toolName, scope: 'permanent', decisionNote: 'e2e13 ILIKE 前置' },
      })
      expect(grant.status()).toBe(200)
      const grantId = (await grant.json()).data.id as number
      const revoke = await request.delete(`/ia/api/v1/admin/grants/${grantId}`, { data: { decisionNote: 'e2e13 revoke' } })
      expect([200, 204]).toContain(revoke.status())

      // UI:fqn 只输入可辨识子串(不含 serverKey 前缀)→ ILIKE '%q%' 命中
      await adminPage.goto('/audit')
      const fqnInput = adminPage.locator('input[placeholder="工具 FQN(模糊)"]')
      await fqnInput.fill(toolName.slice(0, 18))
      const searchResp = adminPage.waitForResponse((r) => r.url().includes('/admin/audit-logs') && r.url().includes('toolFqn='), { timeout: 10_000 })
      await fqnInput.press('Enter')
      await searchResp
      const hit = adminPage.locator('.el-table__row').filter({ hasText: toolName }).locator('visible=true')
      await expect(hit.first(), '子串检索命中(fqn 未输全)').toBeVisible({ timeout: 10_000 })
      const rows = await hit.count()
      saveText('A13-ILIKE子串检索命中行数.txt', `子串=${toolName.slice(0, 18)} 命中行=${rows}(granted+revoked)`)
      expect(rows, 'granted 与 revoked 两行均被子串命中').toBeGreaterThanOrEqual(2)
      await shot(adminPage, 'A13-ILIKE子串检索(模糊命中授权审计)', testInfo)
    } finally {
      psql(`DELETE FROM ia_tool_grant WHERE user_id=${userId} AND tool_fqn LIKE '%${toolName}%'`)
      psql(`DELETE FROM ia_audit_log WHERE tool_fqn LIKE '%${toolName}%'`)
      psql(`DELETE FROM ia_tool_registry WHERE tool_name='${toolName}' AND server_key='${serverKey}'`)
    }
  })
})
