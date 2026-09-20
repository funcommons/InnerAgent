/**
 * e2e/specs/11-tool-confirm.spec.ts — L10 工具确认 UI 线(核心;demo-host 默认接入 UI +
 * demo-spring-host 18091 六工具 + mock 模型脚本驱动)。
 *
 * 覆盖: 写工具(U2 update_product_brief)确认卡渲染→批准→续流 DONE+宿主状态变化;
 * 拒绝→终态+宿主零执行;SCOPE_RESOLVED CustomEvent(宿主元素监听, detail 断言)+
 * scope 降级 chip 渲染边界(单工具行内确认 vs ≥2 批量确认条);只读工具
 * (U5 list_login_records)直通无确认卡(对照)。
 *
 * 前置: e2e/env.sh up + demo-host(5180) + demo-spring-host(18091) + 六工具已注册
 * (endpointUrl=http://localhost:18091/ia-mcp)。mockScript 经 psql 设置, finally 复位。
 *
 * [R2] DEF-05/07 修复后本线从补偿代理页(RECONNECT_HOST)切回 demo-host 默认接入
 * (baseURL 默认值、无网关补偿):注册目录工具在默认接入下直接可达(DEF-07 回归
 * 口径收严),确认卡/SCOPE_RESOLVED 全链路不再依赖任何请求体剔除补偿。
 */
import {
  test, expect, DEMO_HOST, injectDemoUser, journalApi, openSdkChat, sendChat,
  waitTerminal, shot, saveJournal, saveText, saveJson, psql, cleanupDemoUser,
  uniqueDemoUser, captureScopeResolved, readScopeEvents, setMockScript, hostState,
} from '../helpers/sdk-support'

const SERVER_KEY = 'demo-spring-host'
const FOOTER = '本回复由 mock 模型脚本生成'

interface HostSnapshot {
  briefVersion: number
  brief: string
  flowTemplateCount: number
  invocations: Record<string, number>
  raw: string
}

async function hostSnapshot(): Promise<HostSnapshot> {
  const state = await hostState()
  return {
    briefVersion: state.products?.['88']?.briefVersion ?? 0,
    brief: state.products?.['88']?.brief ?? '',
    flowTemplateCount: state.flowTemplateCount ?? 0,
    invocations: state.invocations ?? {},
    raw: JSON.stringify(state, null, 2),
  }
}

test.describe('L10 工具确认 UI 线', () => {

  test('L10-01 写工具确认·批准: 确认卡→允许→DONE+宿主简介版本+1', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const brief = `E2E-R1-L10-批准路径简介-${Date.now().toString(36)}`
    const before = await hostSnapshot()
    saveText('L10-01-宿主状态-前.json', before.raw)

    setMockScript(`{"mockScript":[{"tool":"mcp__${SERVER_KEY}__update_product_brief","args":{"productId":"88","brief":"${brief}"}}]}`)
    try {
      await openSdkChat(page, DEMO_HOST)
      // 宿主元素监听 SCOPE_RESOLVED(组件挂载后注册)
      await captureScopeResolved(page)

      await sendChat(page, '把商品 88 的简介更新为优化版')
      // 确认卡渲染: 行内确认(工具名/等待确认倒计时)
      const confirmCard = page.locator('[data-testid^="assistant-confirm-"]').first()
      await confirmCard.waitFor({ state: 'visible', timeout: 60_000 })
      const toolRow = page.locator('[data-testid^="assistant-tool-"]').filter({ hasText: 'update_product_brief' }).first()
      await expect(toolRow).toContainText('update_product_brief')
      await expect(page.locator('[data-testid^="assistant-tool-"]').filter({ hasText: '等待确认' }).first()).toBeVisible()
      await shot(page, 'L10-02-写工具确认卡(工具名+等待确认+允许拒绝)', testInfo)

      // SCOPE_RESOLVED CustomEvent detail 断言
      const scopeEvents = await readScopeEvents(page)
      saveJson('L10-03-SCOPE_RESOLVED-detail.json', scopeEvents)
      expect(scopeEvents.length, 'SCOPE_RESOLVED 恰派发一次(同确认批去重生效)').toBe(1)
      const detail = scopeEvents[0] as any
      expect(String(detail.conversationId)).toBeTruthy()
      expect(String(detail.runId)).toBeTruthy()
      expect(String(detail.replyId)).toBeTruthy()
      expect(detail.tools.length, 'detail.tools 携带待确认工具').toBe(1)
      expect(String(detail.tools[0].toolName)).toContain('update_product_brief')
      expect(detail.tools[0].scope, 'detail 携带 scope').toBeTruthy()
      expect(detail.tools[0].scope.degraded, '平台未实现 resolve_scope → scope 降级(degraded=true)').toBe(true)
      expect(detail.tools[0].scope.resolved).toBe(false)
      expect(String(detail.tools[0].scope.summary), '降级携带稳定原因文案').toContain('resolve_scope')

      // scope 降级 chip: 记录实际渲染位置(批量确认条才渲染 → 单工具场景缺失观察)
      const batchBar = page.getByTestId('assistant-batch-approval')
      const scopeChip = page.getByTestId('assistant-confirm-scope')
      const scopeRender = {
        singleToolConfirmCard: true,
        batchApprovalBarVisible: await batchBar.isVisible().catch(() => false),
        scopeChipVisible: await scopeChip.isVisible().catch(() => false),
      }
      saveJson('L10-04-scope-chip渲染观察.json', scopeRender)
      expect(scopeRender.batchApprovalBarVisible, '单工具确认: 批量确认条不渲染(≥2 工具才出现)').toBe(false)

      // 批准
      await page.locator('[data-testid^="assistant-approve-"]').first().click()
      expect(await waitTerminal(page, 90_000), '批准后续流至 DONE(已完成)').toBe('已完成')
      await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER, { timeout: 20_000 })
      await expect(page.locator('[data-testid^="assistant-tool-"]').filter({ hasText: '已完成' }).first()).toBeVisible()
      await shot(page, 'L10-05-批准后续流至DONE(工具行已完成)', testInfo)

      // 宿主状态变化: 简介更新 + 版本 +1 + 调用计数 +1
      const after = await hostSnapshot()
      saveText('L10-01-宿主状态-后.json', after.raw)
      expect(after.brief, '宿主简介已更新为批准文案').toBe(brief)
      expect(after.briefVersion, `简介版本 ${before.briefVersion}→${after.briefVersion}(+1)`).toBe(before.briefVersion + 1)
      expect((after.invocations.update_product_brief ?? 0) - (before.invocations.update_product_brief ?? 0), '宿主写工具恰执行一次').toBe(1)

      // 审计: allowed(live-confirm)
      const audit = psql(`select decision, decision_source, tool_fqn from ia_audit_log where user_id=${user} and decision='allowed' and decision_source='live-confirm'`)
      saveText('L10-06-psql-审计行.txt', audit)
      expect(audit, '恰 1 条 allowed(live-confirm) 审计行').toContain('update_product_brief')
      saveJournal(journal, `L10-01-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('L10-07 写工具确认·拒绝: 拒绝→终态+宿主零执行', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const templateName = `E2E-R1-L10-拒绝流程-${Date.now().toString(36)}`
    const before = await hostSnapshot()
    saveText('L10-07-宿主状态-前.json', before.raw)

    setMockScript(`{"mockScript":[{"tool":"mcp__${SERVER_KEY}__copy_flow_template","args":{"sourceTemplateId":"3432","newTemplateName":"${templateName}","extraNode":"用户退款审核"}}]}`)
    try {
      await openSdkChat(page, DEMO_HOST)
      await captureScopeResolved(page)

      await sendChat(page, '以流程模板 3432 为底稿复制新流程模板')
      const confirmCard = page.locator('[data-testid^="assistant-confirm-"]').first()
      await confirmCard.waitFor({ state: 'visible', timeout: 60_000 })
      await shot(page, 'L10-08-拒绝路径-确认卡渲染', testInfo)

      // 拒绝
      await page.locator('[data-testid^="assistant-reject-"]').first().click()
      const state = await waitTerminal(page, 90_000)
      saveText('L10-09-拒绝路径终态.txt', state)
      expect(state, '拒绝路径到达终态(模型收尾作答 → 已完成)').toBe('已完成')
      // 工具行呈现已拒绝
      await expect(page.locator('[data-testid^="assistant-tool-"]').filter({ hasText: '已拒绝' }).first()).toBeVisible({ timeout: 15_000 })
      await shot(page, 'L10-09-拒绝后终态(工具行已拒绝)', testInfo)

      // 宿主零执行
      const after = await hostSnapshot()
      saveText('L10-07-宿主状态-后.json', after.raw)
      expect(after.flowTemplateCount, `流程模板数不变(${before.flowTemplateCount}→${after.flowTemplateCount})`).toBe(before.flowTemplateCount)
      expect(after.raw).not.toContain(templateName)
      expect((after.invocations.copy_flow_template ?? 0) - (before.invocations.copy_flow_template ?? 0), 'copy_flow_template 宿主调用计数不变(确认在宿主之前拦截)').toBe(0)

      // 审计: denied(live-confirm)
      const audit = psql(`select decision, decision_source, tool_fqn from ia_audit_log where user_id=${user} and decision='denied' and decision_source='live-confirm'`)
      saveText('L10-10-psql-审计行.txt', audit)
      expect(audit, '恰 1 条 denied(live-confirm) 审计行').toContain('copy_flow_template')
      saveJournal(journal, `L10-07-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('L10-11 两轮脚本(读直通+写确认)与 scope chip 渲染边界', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const brief = `E2E-R1-L10-两轮脚本-${Date.now().toString(36)}`

    setMockScript(`{"mockScript":[
      {"tool":"mcp__${SERVER_KEY}__get_product_brief","args":{"productId":"88"}},
      {"tool":"mcp__${SERVER_KEY}__update_product_brief","args":{"productId":"88","brief":"${brief}"}}
    ]}`)
    try {
      await openSdkChat(page, DEMO_HOST)
      await captureScopeResolved(page)
      await sendChat(page, '先查商品 88 简介,再把简介更新为优化版')

      // 第 0 轮(只读 get_product_brief, 注解 readOnlyHint=true)应直通: 直接完成,
      // 不产生确认;确认卡属于第 1 轮写工具(update_product_brief)
      const confirmCard = page.locator('[data-testid^="assistant-confirm-"]').first()
      await confirmCard.waitFor({ state: 'visible', timeout: 90_000 })
      const readRow = page.locator('.assistant-timeline__tool').filter({ hasText: 'get_product_brief' }).first()
      await expect(readRow, '只读工具已直通完成(未被询问)').toContainText('已完成')
      const readAsked = await page.locator('.assistant-timeline__tool')
        .filter({ hasText: 'get_product_brief' }).filter({ hasText: '等待确认' }).count()
      saveJson('L10-11-只读直通观察.json', {
        readToolAwaiting: readAsked,
        note: 'readOnlyHint=true 注解工具在 DEFAULT 档位直通(对照 M1 旅程 U5);确认卡仅属于写工具',
      })
      expect(readAsked, '只读工具未被询问确认(直通)').toBe(0)

      // 确认卡属于写工具
      await expect(page.locator('.assistant-timeline__tool').filter({ hasText: 'update_product_brief' }).filter({ hasText: '等待确认' }).first()).toBeVisible()
      await shot(page, 'L10-12-第二轮写工具确认卡', testInfo)
      const scopeChipVisible = await page.getByTestId('assistant-confirm-scope').isVisible().catch(() => false)
      const batchVisible = await page.getByTestId('assistant-batch-approval').isVisible().catch(() => false)
      saveJson('L10-12-scope-chip两轮观察.json', {
        scopeChipVisible,
        batchApprovalBarVisible: batchVisible,
        note: 'scope 数据随事件下发(SCOPE_RESOLVED detail 可证), 但行内单工具确认卡无 scope 渲染位',
      })
      expect(scopeChipVisible, '单工具行内确认场景无 scope chip(仅 ≥2 批量条渲染)').toBe(false)

      // 批准写工具, 等待收尾
      await page.locator('[data-testid^="assistant-approve-"]').first().click()
      expect(await waitTerminal(page, 90_000)).toBe('已完成')
      await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER, { timeout: 20_000 })
      await shot(page, 'L10-13-两轮脚本完成(读直通+写批准)', testInfo)

      const scopeEvents = await readScopeEvents(page)
      saveJson('L10-11-SCOPE_RESOLVED-两轮.json', scopeEvents)
      expect(scopeEvents.length, '仅写确认批派发 SCOPE_RESOLVED(恰一次)').toBe(1)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('L10-14 只读工具直通对照: U5 list_login_records 无确认卡', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const before = await hostSnapshot()
    saveText('L10-14-宿主状态-前.json', before.raw)

    setMockScript(`{"mockScript":[{"tool":"mcp__${SERVER_KEY}__list_login_records","args":{"userId":"${user}","days":30}}]}`)
    try {
      await openSdkChat(page, DEMO_HOST)
      await captureScopeResolved(page)

      await sendChat(page, '查一下最近 30 天的登录记录')
      // 运行中窗口内轮询: 确认卡始终不出现(只读直通)
      let confirmSeen = false
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        if (await page.locator('[data-testid^="assistant-confirm-"]').count() > 0) { confirmSeen = true; break }
        if (await page.getByTestId('assistant-message-error').isVisible().catch(() => false)) break
        if ((await waitTerminalSafe(page)) === '已完成') break
        await page.waitForTimeout(400)
      }
      expect(confirmSeen, '只读工具全程无确认卡(与写工具对照)').toBe(false)
      const state = await waitTerminal(page, 90_000)
      expect(state, '只读直通到达 DONE(已完成)').toBe('已完成')
      await expect(page.locator('[data-testid^="assistant-tool-"]').filter({ hasText: 'list_login_records' }).first()).toBeVisible({ timeout: 15_000 })
      await shot(page, 'L10-15-只读工具直通至DONE(无确认卡)', testInfo)

      const scopeEvents = await readScopeEvents(page)
      saveJson('L10-16-只读直通-SCOPE_RESOLVED.json', scopeEvents)
      expect(scopeEvents.length, '只读直通无 SCOPE_RESOLVED 派发').toBe(0)

      // 宿主执行证据 + 无确认审计
      const after = await hostSnapshot()
      saveText('L10-14-宿主状态-后.json', after.raw)
      expect((after.invocations.list_login_records ?? 0) - (before.invocations.list_login_records ?? 0), '宿主只读工具恰执行一次').toBe(1)
      const audit = psql(`select count(*) from ia_audit_log where user_id=${user}`)
      saveText('L10-16-psql-审计行数.txt', audit)
      expect(audit, '只读 run 无确认审计行').toBe('0')
      saveJournal(journal, `L10-14-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })
})

/** waitTerminal 的非抛错变体(轮询用) */
async function waitTerminalSafe(page: import('@playwright/test').Page): Promise<string> {
  const { terminalState } = await import('../helpers/sdk-support')
  return terminalState(page)
}
