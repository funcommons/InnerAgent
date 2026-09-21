/**
 * e2e/specs/15-r4-regression.spec.ts — R4 定点复测(DEF-08/09 修复验证轮)。
 *
 * R3 唯一失败面:DEF-08(ia_app.circuit_limits_json JSONB 列 + MySQL 形
 * JsonbTypeHandler → 任何 ia_app UPDATE 500,含公钥轮换 REGRESSED)与
 * DEF-09(deliveries 查询缺省 status NPE 500)。修复:b04b4fa(V15 JSONB→TEXT
 * + resume 定向显式 SET 连带修复)/ 612f979(status 空值护栏)/ 8715822
 * (演示身份不再注入管理面,引导 key 通道 operator 记 admin)。
 *
 * 覆盖(R4 复测清单,新断言均标注 [R4]):
 *  - R4-01/02:熔断 limits 三写端点之一 PUT 保存 → GET/UI 回读一致(DEF-08 面;
 *    UI 通道截图取证「回读一致」);
 *  - R4-03:UI 紧急停用 → 停用中新 run 403 → resume;**加宽断言:resume 后
 *    GET state 的 stoppedAt/stopReason 为空**(b04b4fa 连带修复:整行
 *    updateById 跳过 null 从未清空,改定向 LambdaUpdateWrapper);
 *  - R4-04:terminate-run 对运行中 run 200 + 审计 run-terminated/forced-policy
 *    + **operator=admin(引导 key 通道,OBS-R3-1 修复)**;
 *  - R4-05:webhook config PUT 保存 → GET 回读一致(DEF-08 面);test 未配
 *    url → 400;
 *  - R4-06:deliveries 不带 status → 200 非空(DEF-09 面);status=FAILED
 *    过滤生效;UI 首载(无状态选择)表格渲染。
 *
 * 前置:e2e/env.sh up(18090/18081);R4-04 需 mock 模型(psql 设 mockScript,
 * 内置 get_current_time 工具,无需 demo-spring-host);数据自建前置 + finally
 * 物理清理。
 */
import {
  test, expect, psql, saveJson, saveText, shot, messageToast, unique,
} from '../helpers/support'
import { setMockScript, cleanupDemoUser, uniqueDemoUser } from '../helpers/sdk-support'

/** 起 demo run(SSE 挂起不消费,服务端自行推进);返回响应 Promise */
function startDemoRun(request: import('@playwright/test').APIRequestContext, user: number, message: string) {
  return request.fetch('/ia/api/v1/runs', {
    method: 'post',
    headers: { 'X-IA-Demo-User': String(user) },
    // toolExecutionMode 必填(Bean Validation 在紧急停用守卫之前,缺失会 400 抢跑)
    data: { message, agentType: 'demo', toolExecutionMode: 'DEFAULT' },
    timeout: 120_000,
  })
}

test.describe('R4 · DEF-08/09 修复定点复测', () => {

  test('R4-01 [R4] DEF-08 面:PUT limits 部分合并保存 → GET 回读一致 + 库层 TEXT 列', async ({ request }) => {
    const put = await request.put('/ia/api/v1/admin/circuit-breaker/limits', {
      data: { limits: { maxToolCallsPerRun: 44, mcpQps: 33 } },
    })
    expect(put.status(), 'DEF-08 修复:PUT limits 200(R3 为 500)').toBe(200)
    const putBody = await put.json()
    expect(putBody.data.maxToolCallsPerRun).toBe(44)
    expect(putBody.data.mcpQps).toBe(33)
    expect(putBody.data.maxTokensPerRun, '部分合并:未提交字段保持原值').toBe(300000)

    const state = (await (await request.get('/ia/api/v1/admin/circuit-breaker')).json()).data
    saveJson('R4-01-limits-PUT与GET回读.json', { put: putBody.data, get: state.limits })
    expect(state.limits, 'GET 回读与 PUT 响应一致').toEqual(putBody.data)

    // 库层:V15 列型 text + JSON 文本含新值
    const colType = psql(`SELECT data_type FROM information_schema.columns WHERE table_name='ia_app' AND column_name='circuit_limits_json'`)
    const dbJson = psql(`SELECT circuit_limits_json FROM ia_app WHERE id=1`)
    saveText('R4-01-库层circuit_limits_json.txt', `列型=${colType}\n库层值=${dbJson}`)
    expect(colType, 'V15:circuit_limits_json 列型为 text').toBe('text')
    expect(JSON.parse(dbJson).maxToolCallsPerRun).toBe(44)
  })

  test('R4-02 [R4] 熔断页 UI 保存上限 → API 回读一致(「回读一致」UI 截图通道)', async ({ adminPage, request }) => {
    await adminPage.goto('/circuit')
    await adminPage.waitForResponse((r) => r.url().includes('/admin/circuit-breaker') && r.request().method() === 'GET')
    const item = adminPage.locator('.el-form-item').filter({ hasText: '单运行最大工具调用' }).first()
    await item.locator('input').fill('45')
    const putResp = adminPage.waitForResponse((r) => r.url().includes('/circuit-breaker/limits') && r.request().method() === 'PUT')
    await adminPage.getByRole('button', { name: '保存上限' }).click()
    const resp = await putResp
    expect(resp.status(), 'UI 保存上限(PUT limits)200').toBe(200)
    await expect(messageToast(adminPage, '资源上限已保存')).toBeVisible()
    const saved = (await resp.json()).data
    expect(saved.maxToolCallsPerRun).toBe(45)

    const state = (await (await request.get('/ia/api/v1/admin/circuit-breaker')).json()).data
    saveJson('R4-02-UI保存-API回读.json', { uiPut: saved, apiReadback: state.limits })
    expect(state.limits.maxToolCallsPerRun, 'API 回读 = UI 保存值').toBe(45)
    await shot(adminPage, 'R4-02-熔断页-UI保存limits(API回读一致)')
  })

  test('R4-03 [R4] DEF-08 面:UI 紧急停用 → 新 run 403 → resume;stoppedAt/stopReason 清空(加宽)', async ({ adminPage, request }, testInfo) => {
    await adminPage.goto('/circuit')
    await adminPage.waitForResponse((r) => r.url().includes('/admin/circuit-breaker') && r.request().method() === 'GET')

    // ① UI 紧急停用(DEF-08 面:R3 该 PUT 500,只能 psql 直设)
    await adminPage.locator('.el-form-item').filter({ hasText: '停用原因' }).locator('input')
      .fill('R4 复测:停用守卫取证')
    const stopResp = adminPage.waitForResponse((r) => r.url().includes('/emergency-stop') && r.request().method() === 'POST')
    await adminPage.getByRole('button', { name: '紧急停用' }).click()
    await adminPage.locator('.el-message-box:visible').getByRole('button', { name: '确认停用' }).click()
    const stop = await stopResp
    expect(stop.status(), 'DEF-08 修复:emergency-stop 200(R3 为 500)').toBe(200)
    await expect(adminPage.locator('.el-tag').filter({ hasText: '已紧急停用' }).first()).toBeVisible()
    await shot(adminPage, 'R4-03-紧急停用中(UI停用态)', testInfo)

    // ② 停用中新 run 403(守卫挂在 run 发起唯一入口)
    const user = uniqueDemoUser()
    const denied = await startDemoRun(request, user, 'R4 复测:停用期新 run 应被拒')
    expect(denied.status(), '停用中新 run 403').toBe(403)
    const deniedBody = await denied.json()
    saveJson('R4-03-停用中起run-403.json', deniedBody)
    expect(deniedBody.msg).toContain('应用已紧急停用')
    expect(deniedBody.msg, '403 文案回显停用原因').toContain('R4 复测:停用守卫取证')

    // ③ UI 恢复
    const resumeResp = adminPage.waitForResponse((r) => r.url().includes('/resume') && r.request().method() === 'POST')
    await adminPage.getByRole('button', { name: '恢复运行接入' }).click()
    const resume = await resumeResp
    expect(resume.status(), 'DEF-08 修复:resume 200(R3 为 500)').toBe(200)
    await expect(messageToast(adminPage, '已恢复运行接入')).toBeVisible()

    // ④ [R4 加宽断言] resume 后 GET state 的 stoppedAt/stopReason 为空
    // (b04b4fa 连带修复:整行 updateById 按 MP 缺省策略跳过 null,清空从未落库;
    //  改定向 LambdaUpdateWrapper 显式 SET —— 断言不加宽该修复会漏)
    const state = (await (await request.get('/ia/api/v1/admin/circuit-breaker')).json()).data
    saveJson('R4-03-resume后-state.json', state)
    expect(state.emergencyStopped).toBe(false)
    expect(state.stoppedAt, '[R4 加宽] resume 后 stoppedAt 清空(V14 DDL 恢复契约)').toBeNull()
    expect(state.stopReason, '[R4 加宽] resume 后 stopReason 清空').toBeNull()
    const dbRow = psql(`SELECT circuit_stopped || '|' || coalesce(circuit_stopped_at::text, 'NULL') || '|' || coalesce(circuit_stop_reason, 'NULL') FROM ia_app WHERE id=1`)
    saveText('R4-03-resume后-库层行.txt', `stopped|stopped_at|stop_reason = ${dbRow}`)
    expect(dbRow, '库层恢复态:开关 false + 两列 NULL').toBe('false|NULL|NULL')

    // ⑤ 事件流:emergency-stop / resume 均 operator=admin(引导 key 通道,8715822)
    const ops = state.recentEvents.slice(0, 4).map((e: any) => `${e.type}:${e.operator}`)
    saveText('R4-03-事件流operator.txt', ops.join('\n'))
    expect(ops.join('|'), 'emergency-stop 事件 operator=admin').toContain('emergency-stop:admin')
    expect(ops.join('|'), 'resume 事件 operator=admin').toContain('resume:admin')
    await shot(adminPage, 'R4-03-恢复后(运行中+事件流admin)', testInfo)
    cleanupDemoUser(user)
  })

  test('R4-04 [R4] terminate-run 运行中 run:200 + 审计 forced-policy + operator=admin', async ({ request }, testInfo) => {
    const user = uniqueDemoUser()
    // 内置 get_current_time ×10 拉长 run 存活期(R3 用 4 轮≈8s;无需 demo-spring-host)
    setMockScript('{"mockScript":[' + Array(10).fill('{"tool":"get_current_time","args":{}}').join(',') + ']}')
    try {
      const runRespPromise = startDemoRun(request, user, 'R4 复测:强制终止目标 run')
      runRespPromise.catch(() => {}) /* 终止后流被断开,不视为失败 */

      let runId = ''
      for (let i = 0; i < 80; i++) {
        runId = psql(`SELECT run_id FROM ia_agent_run WHERE user_id=${user} AND status='RUNNING' ORDER BY id DESC LIMIT 1`)
        if (runId) break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(runId, 'mock 模型 run 已起并处于 RUNNING').toBeTruthy()
      saveText('R4-04-目标run.txt', `runId=${runId} user=${user}`)
      testInfo.attach('target-runId', { body: runId })

      const term = await request.post('/ia/api/v1/admin/circuit-breaker/terminate-run', {
        data: { runId, reason: 'R4 复测:管理员强制终止' },
      })
      expect(term.status(), 'terminate-run 对运行中 run 200').toBe(200)
      const termBody = await term.json()
      saveJson('R4-04-terminate-run-200.json', termBody)
      expect(termBody.data.type).toBe('run-terminated')
      expect(termBody.data.operator, '[R4] 引导 key 通道 operator=admin(OBS-R3-1 修复;R3 为 demo-user)').toBe('admin')

      // run → CANCELLED(终止链收敛)
      let status = ''
      for (let i = 0; i < 40; i++) {
        status = psql(`SELECT status FROM ia_agent_run WHERE run_id='${runId}'`)
        if (status === 'CANCELLED') break
        await new Promise((r) => setTimeout(r, 300))
      }
      expect(status, 'run 终态 CANCELLED').toBe('CANCELLED')

      // 库层:ia_circuit_event operator + ia_audit_log run-terminated/forced-policy
      const ev = psql(`SELECT type || '|' || operator FROM ia_circuit_event WHERE run_id='${runId}'`)
      saveText('R4-04-库层circuit_event.txt', `type|operator = ${ev}`)
      expect(ev, '事件表 operator=admin').toBe('run-terminated|admin')
      const audit = psql(`SELECT decision || '|' || decision_source || '|' || result_summary FROM ia_audit_log WHERE run_id='${runId}' AND decision='run-terminated'`)
      saveText('R4-04-审计run-terminated.txt', `decision|decision_source|result_summary = ${audit}`)
      expect(audit, '审计 forced-policy + 操作者 admin 入摘要').toContain('run-terminated|forced-policy|管理员强制终止(admin)')
      await runRespPromise.catch(() => null)
    } finally {
      setMockScript('')
      cleanupDemoUser(user)
    }
  })

  test('R4-05 [R4] DEF-08 面:webhook config PUT 保存 → GET 回读一致;test 未配 url → 400', async ({ request }) => {
    // 前置:未配置 url 形态经 psql 置空——OBS-R4-1:PUT url:'' 响应 url=null 但
    // 库层不清(MP updateById 跳过 null,与 b04b4fa 修复的 resume 同族),API 无
    // 清空路径,故「未配 url」只能以库层 fixture 表达(取证 R4-05-OBS-R4-1-*.txt)
    psql(`UPDATE ia_app SET webhook_url = NULL WHERE id=1`)
    const testEmpty = await request.post('/ia/api/v1/admin/webhooks/config/test')
    expect(testEmpty.status(), '未配置 url 时 test → 400').toBe(400)
    const testBody = await testEmpty.json()
    saveJson('R4-05-config-test-未配url-400.json', testBody)
    expect(testBody.msg).toContain('尚未配置 Webhook 回调地址')

    const url = `https://e2e-r4-${Date.now().toString(36)}.example.com/hook`
    const put = await request.put('/ia/api/v1/admin/webhooks/config', {
      data: { url, enabled: false, events: ['run.finished', 'run.failed'] },
    })
    expect(put.status(), 'DEF-08 修复:PUT config 200(R3 为 500)').toBe(200)
    const putBody = await put.json()
    expect(putBody.data.url).toBe(url)
    expect(putBody.data.enabled).toBe(false)
    expect(putBody.data.events).toEqual(['run.finished', 'run.failed'])

    const cfg = (await (await request.get('/ia/api/v1/admin/webhooks/config')).json()).data
    saveJson('R4-05-config-PUT与GET回读.json', { put: putBody.data, get: cfg })
    expect(cfg.url, 'GET 回读 url 一致').toBe(url)
    expect(cfg.enabled).toBe(false)
    const dbUrl = psql(`SELECT webhook_url FROM ia_app WHERE id=1`)
    saveText('R4-05-库层webhook_url.txt', `ia_app.webhook_url = ${dbUrl}`)
    expect(dbUrl).toBe(url)

    // OBS-R4-1 取证:PUT url:'' 响应称已清(url:null),GET/库层仍旧值
    const clearAttempt = await request.put('/ia/api/v1/admin/webhooks/config', {
      data: { url: '', enabled: false, events: ['run.finished', 'run.failed'] },
    })
    expect(clearAttempt.status()).toBe(200)
    const staleGet = (await (await request.get('/ia/api/v1/admin/webhooks/config')).json()).data
    saveText('R4-05-OBS-R4-1-空url不清.txt', JSON.stringify({
      putResponseUrl: (await clearAttempt.json()).data.url,
      getAfterPut: staleGet.url,
      dbUrl: psql(`SELECT webhook_url FROM ia_app WHERE id=1`),
      note: 'PUT url:"" 响应 url=null 但库层不清(MP updateById 跳过 null);与 b04b4fa 修复的 resume 清空缺陷同族,移交台账',
    }, null, 2))

    // 清场:库层复位 V14 缺省形(url 空;enabled/events 回默认)
    psql(`UPDATE ia_app SET webhook_url = NULL, webhook_enabled = TRUE,
          webhook_events = 'run.finished,run.failed,run.cancelled' WHERE id=1`)
  })

  test('R4-06 [R4] DEF-09:deliveries 不带 status → 200 非空;status=FAILED 过滤生效;UI 首载渲染', async ({ request, adminPage }, testInfo) => {
    // fixture:一笔 FAILED 行(锁 next_retry_at,保证 FAILED 过滤有命中)
    const tag = unique('r4fix-failed-')
    psql(`INSERT INTO ia_webhook_delivery (app_id, event_type, run_id, url, payload_json, status, next_retry_at)
          VALUES (1, 'run.finished', '${tag}', 'http://localhost:19999/hook', '{}', 'FAILED', now() + interval '2 hours')`)
    try {
      const all = await request.get('/ia/api/v1/admin/webhook-deliveries')
      expect(all.status(), 'DEF-09 修复:无 status → 200(R3 为 NPE 500)').toBe(200)
      const allBody = await all.json()
      expect(allBody.data.list.length, '全量投递记录非空(UI 首载形态)').toBeGreaterThan(0)
      saveJson('R4-06-deliveries-无status.json', { total: allBody.data.total, count: allBody.data.list.length, first: allBody.data.list[0] })

      const failed = await request.get('/ia/api/v1/admin/webhook-deliveries?status=FAILED')
      expect(failed.status()).toBe(200)
      const failedBody = await failed.json()
      const statuses = [...new Set(failedBody.data.list.map((r: any) => r.status))]
      saveJson('R4-06-deliveries-FAILED过滤.json', { total: failedBody.data.total, statuses, hasFixture: failedBody.data.list.some((r: any) => r.runId === tag) })
      expect(statuses, '过滤生效:命中行仅 FAILED').toEqual(['FAILED'])
      expect(failedBody.data.list.some((r: any) => r.runId === tag), 'fixture 行被 FAILED 过滤命中').toBe(true)

      // UI 首载(未选状态过滤,即 R3 命中 500 的形态)→ 表格渲染数据行
      const firstLoad = adminPage.waitForResponse((r) => r.url().includes('/admin/webhook-deliveries') && !r.url().includes('status='), { timeout: 15_000 })
      await adminPage.goto('/webhooks')
      const resp = await firstLoad
      expect(resp.status(), 'UI 首载 deliveries(无 status)200').toBe(200)
      await expect(adminPage.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
      await shot(adminPage, 'R4-06-webhooks页-首载全量deliveries(200非空)', testInfo)
    } finally {
      psql(`DELETE FROM ia_webhook_delivery WHERE run_id='${tag}'`)
    }
  })

  test.afterAll(async () => {
    // 复位熔断域到 §4.7 默认值(本 spec 各用例改写过 44/45/33)
    psql(`UPDATE ia_app SET circuit_limits_json = '{"maxToolCallsPerRun":32,"maxTokensPerRun":300000,"maxRunDurationMinutes":30,"toolRetryLimit":2,"mcpConcurrency":8,"mcpQps":20,"confirmTimeoutHours":24}' WHERE id=1`)
  })
})
