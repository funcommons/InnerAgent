/**
 * e2e/specs/14-p3-sdk.spec.ts — R3 新增:修 P0~P3 批次 SDK 侧优化验证
 * (SDK 交接 5 条;对应 99-优化建议.md 条目见各用例注释)。
 *
 * 覆盖: 断流静默提示(#5:assistant-reconnecting 可见 + retry 抑制 + 恢复清除) /
 * 单工具确认卡 scope chip 降级形态(#11/#13) / 消息区附件气泡与历史回放(#12) /
 * 15MB url 回退提示(#15/#8) / demo-host agentType=demo 请求体断言(#24/#20)。
 *
 * 前置: e2e/env.sh up + sdk-js dist + demo-host(5180) + reconnect-host(18085)
 * + demo-spring-host(18091 六工具)。mockScript 经 psql 设置, finally 复位。
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test, expect, DEMO_HOST, RECONNECT_HOST, injectDemoUser, journalApi, openSdkChat, sendChat,
  waitTerminal, shot, saveJournal, saveText, saveJson, psql, cleanupDemoUser, uniqueDemoUser,
  setMockScript,
} from '../helpers/sdk-support'

/** 断流开关(复用 spec 09 的可断中转;此处本地实现避免跨文件依赖) */
async function breakProxy(seconds: number, allowRunning = false): Promise<void> {
  const res = await fetch(`${RECONNECT_HOST}/__break?seconds=${seconds}${allowRunning ? '&allow=running' : ''}`, { method: 'POST' })
  if (!res.ok) throw new Error(`/__break ${res.status}`)
}

async function waitProxyRecovered(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await (await fetch(`${RECONNECT_HOST}/__state`)).json() as { breaking: boolean }
      if (!state.breaking) return
    } catch { /* 恢复探测中 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('断流窗口未恢复')
}

/** 1x1 红色 PNG(合法图片字节) */
const PNG_1PX_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('R3 · P3 优化(SDK 5 条)', () => {

  test('B01 断流静默提示(#5):重连横幅可见、手动重试被抑制、恢复后清除', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    // 4 轮只读工具拉长 run 存活期(~8s,断流窗内 run 仍活着 → 走「可恢复传输错误」分支)
    setMockScript('{"mockScript":[{"tool":"get_current_time","args":{}},{"tool":"get_current_time","args":{}},{"tool":"get_current_time","args":{}},{"tool":"get_current_time","args":{}}]}')
    try {
      await openSdkChat(page, RECONNECT_HOST)
      await sendChat(page, 'E2E-R3 断流静默提示')
      await page.locator('[data-testid^="assistant-content-"]').first().waitFor({ state: 'visible', timeout: 30_000 })

      // 8s 断流(销毁连接+拒绝新连接)
      await breakProxy(8)
      await page.waitForTimeout(2000)

      // 横幅可见且文案正确;错误态/重试按钮被抑制(reconnecting 时 store 不给 errorMessage)
      const banner = page.getByTestId('assistant-reconnecting')
      await banner.waitFor({ state: 'visible', timeout: 15_000 })
      const bannerText = (await banner.innerText()).trim()
      const errorVisible = await page.getByTestId('assistant-message-error').isVisible().catch(() => false)
      const retryVisible = await page.getByTestId('assistant-retry').isVisible().catch(() => false)
      saveJson('B01-断流中-静默提示观察.json', { bannerText, errorVisible, retryVisible })
      await shot(page, 'B01-断流中-静默提示(自动重连中·无重试按钮)', testInfo)
      expect(bannerText, '非阻断横幅文案').toContain('自动重连中')
      expect(errorVisible, '断流瞬间不再暴露原始 network error').toBe(false)
      expect(retryVisible, '手动重试按钮被抑制(自愈型故障无需手动干预)').toBe(false)

      // 恢复 → 自动续流至终态;横幅清除、无错误残留
      await waitProxyRecovered()
      expect(await waitTerminal(page, 120_000), '断流恢复后运行收敛到已完成').toBe('已完成')
      expect(await banner.isVisible().catch(() => false), '恢复后重连横幅清除').toBe(false)
      expect(await page.getByTestId('assistant-message-error').isVisible().catch(() => false), '终态无错误残留').toBe(false)
      await shot(page, 'B01-恢复后-横幅清除(已完成)', testInfo)

      saveJournal(journal, `B01-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('B02 单工具确认卡 scope chip 降级形态(#11):degraded 弱警示可见', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const brief = `E2E-R3-B02-${Date.now().toString(36)}`

    setMockScript(`{"mockScript":[{"tool":"mcp__demo-spring-host__update_product_brief","args":{"productId":"88","brief":"${brief}"}}]}`)
    try {
      await openSdkChat(page, DEMO_HOST)
      await sendChat(page, '把商品 88 的简介更新为优化版')

      const confirmCard = page.locator('[data-testid^="assistant-confirm-"]').first()
      await confirmCard.waitFor({ state: 'visible', timeout: 60_000 })
      const scopeChip = page.getByTestId('assistant-confirm-scope')
      await scopeChip.waitFor({ state: 'visible', timeout: 15_000 })
      const chipText = (await scopeChip.innerText()).trim()
      const chipTitle = await scopeChip.getAttribute('title')
      const chipDegraded = await scopeChip.evaluate((el) => el.className.includes('is-degraded'))
      saveJson('B02-单工具scope-chip.json', { chipText, chipTitle, chipDegraded })
      await shot(page, 'B02-单工具确认卡(scope chip 降级)', testInfo)
      expect(chipText, '降级形态文案(单工具卡内可见,R2 时缺失)').toContain('约束范围降级')
      expect(chipDegraded, 'is-degraded 弱警示样式').toBe(true)
      expect(String(chipTitle), 'summary 作 title 弱提示(归一自 SCOPE_RESOLVED detail)').toContain('resolve_scope')

      // 批准 → 续流完成(确认流不被 chip 阻塞)
      await page.locator('[data-testid^="assistant-approve-"]').first().click()
      expect(await waitTerminal(page, 90_000)).toBe('已完成')
      saveJournal(journal, `B02-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('B03 消息区附件气泡(#12):img[src$="/attachments/{id}"] + 历史回放一致', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    setMockScript('{"mockScript":[{"tool":"mcp__demo-spring-host__get_product_brief","args":{"productId":"88"}}]}')
    try {
      await openSdkChat(page, DEMO_HOST)
      const pngPath = join(tmpdir(), `e2e-r3-b03-${user}.png`)
      writeFileSync(pngPath, PNG_1PX_RED)
      await page.getByTestId('assistant-attachment-input').setInputFiles(pngPath)
      await page.getByTestId('assistant-attachments').locator('[data-testid^="assistant-attachment-"]').first()
        .waitFor({ state: 'visible', timeout: 30_000 })

      const text = 'E2E-R3-B03 看看这张图'
      await sendChat(page, text)
      expect(await waitTerminal(page, 60_000), '携带附件的运行到达已完成').toBe('已完成')

      // 发送后用户气泡渲染附件(缩略图 <img>,src 指向 resourceUrl /attachments/{id})
      const bubble = page.getByTestId('assistant-user-bubble')
      await expect(bubble).toContainText(text)
      const attachments = page.getByTestId('assistant-user-attachments')
      await expect(attachments).toBeVisible()
      const img = attachments.locator('img').first()
      await img.waitFor({ state: 'visible', timeout: 15_000 })
      const src = await img.getAttribute('src')
      const attRow = psql(`select id from ia_agent_attachment where user_id=${user} order by id desc limit 1`)
      saveJson('B03-气泡附件img.json', { src, attachmentRowId: attRow })
      await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
      expect(src, 'img src 以 /attachments/{id} 结尾(resourceUrl 解析)').toMatch(new RegExp(`/attachments/${attRow}$`))
      await shot(page, 'B03-发送后用户气泡附件缩略图', testInfo)

      // 历史回放:刷新后同一附件路径渲染(回放共用 messageAttachments 入口)
      await openSdkChat(page, DEMO_HOST)
      const replayImg = page.getByTestId('assistant-user-attachments').locator('img').first()
      await replayImg.waitFor({ state: 'visible', timeout: 20_000 })
      const replaySrc = await replaySrcOf(page)
      saveJson('B03-历史回放附件img.json', { replaySrc })
      expect(replaySrc, '回放 img src 与首发一致(/attachments/{id})').toBe(src)
      await shot(page, 'B03-历史回放附件渲染一致', testInfo)

      saveJournal(journal, `B03-api-journal-user${user}.txt`)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('B04 15MB 附件 url 回退提示(#15):chip 小字「大文件将以 URL 引用传输」', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    try {
      await openSdkChat(page, DEMO_HOST)
      const big15 = join(tmpdir(), `e2e-r3-b04-${user}.png`)
      writeFileSync(big15, Buffer.alloc(15 * 1024 * 1024, 7))
      await page.getByTestId('assistant-attachment-input').setInputFiles(big15)
      const chip = page.getByTestId('assistant-attachments').locator('[data-testid^="assistant-attachment-"]').first()
      await chip.waitFor({ state: 'visible', timeout: 30_000 })
      const hint = page.getByTestId('assistant-attachment-url-hint')
      await hint.waitFor({ state: 'visible', timeout: 15_000 })
      const hintText = (await hint.innerText()).trim()
      saveText('B04-回退提示文案.txt', hintText)
      await shot(page, 'B04-15MB回退提示(URL引用传输小字)', testInfo)
      expect(hintText, '回退发生时有明示(不再静默)').toContain('URL 引用传输')

      // 库层佐证:transport=url
      const row = psql(`select transport || '|' || size_bytes from ia_agent_attachment where user_id=${user} order by id desc limit 1`)
      saveText('B04-库层transport.txt', `transport|size_bytes: ${row}`)
      expect(row).toContain('url|')
      saveJournal(journal, `B04-api-journal-user${user}.txt`)
    } finally {
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  test('B05 demo-host agentType=demo 请求体断言(#24):/runs 携带 demo 且无 enabledMcpTools', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const runBodies: Array<Record<string, unknown>> = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/ia\/api\/v1\/runs$/.test(req.url())) {
        try { runBodies.push(JSON.parse(req.postData() ?? '{}')) } catch { /* 尽力而为 */ }
      }
    })

    try {
      await openSdkChat(page, DEMO_HOST)
      await sendChat(page, 'E2E-R3-B05 默认接入请求体探测')
      expect(await waitTerminal(page, 60_000)).toBe('已完成')
      expect(runBodies.length, '捕获到 POST /runs 请求体').toBeGreaterThanOrEqual(1)
      const body = runBodies[0]
      saveJson('B05-demo-host-runs请求体.json', { agentType: body.agentType, keys: Object.keys(body), enabledMcpTools: (body as any).enabledMcpTools })
      expect(String(body.agentType), 'demo-host 示例声明的 agentType 随请求体下发(beaa822)').toBe('demo')
      expect(body, '不再下发 enabledMcpTools 空数组(DEF-07 三分法语义)').not.toHaveProperty('enabledMcpTools')
      await shot(page, 'B05-demo-host默认接入(agentType=demo)', testInfo)
      saveJournal(journal, `B05-api-journal-user${user}.txt`)
    } finally {
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })
})

/** 历史回放 img src(重新挂载后从 DOM 取) */
async function replaySrcOf(page: import('@playwright/test').Page): Promise<string | null> {
  const img = page.getByTestId('assistant-user-attachments').locator('img').first()
  return img.getAttribute('src')
}
