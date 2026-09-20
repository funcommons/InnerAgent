/**
 * e2e/specs/08-sdk-chat.spec.ts — L7 SDK 对话链路(demo-host + <inneragent-chat>)。
 *
 * 覆盖: Shadow DOM 双向隔离(宿主样式不渗入/组件样式不外泄/主题令牌穿透)、
 * 发消息流式增量渲染(中间态+终态)、消息历史(刷新后会话保留)、
 * 新会话/切换会话、取消运行(CANCELLED)、错误输入(空消息/超长)。
 *
 * 前置: e2e/env.sh up(18090/18081) + sdk-js dist 构建 + demo-host vite dev(5180)。
 * 隔离: 每用例独立演示用户(X-IA-Demo-User 注入), finally 物理清理(psql)。
 */
import {
  test, expect, DEMO_HOST, RECONNECT_HOST, injectDemoUser, journalApi, openSdkChat, sendChat,
  captureSse, readSseCaptured,
  waitTerminal, liveContentLength, shot, saveJournal, saveText, psql, cleanupDemoUser, uniqueDemoUser,
} from '../helpers/sdk-support'

const MESSAGE = '现在几点了?'
const FOOTER = '本回复由 mock 模型脚本生成'

test.describe('L7 SDK 对话链路', () => {

  test('L7-01 Shadow DOM 双向隔离与主题令牌穿透', async ({ page }, testInfo) => {
    await openSdkChat(page, DEMO_HOST, { requireModels: false })

    // 1) 组件内容位于 Shadow DOM 内
    const shadowReady = await page.evaluate(() => {
      const el = document.querySelector('inneragent-chat')
      return { hasShadowRoot: !!el?.shadowRoot, nestedWindow: !!el?.shadowRoot?.querySelector('[data-testid="assistant-window"]') }
    })
    expect(shadowReady.hasShadowRoot, 'WC 存在 shadowRoot').toBe(true)
    expect(shadowReady.nestedWindow, '组件窗口渲染于 shadowRoot 内').toBe(true)

    // 2) 宿主样式不渗入: 组件内主按钮不受宿主「绿色虚线按钮」全局样式污染
    const probe = async (testid: string) => page.getByTestId(testid).evaluate((el) => {
      const s = getComputedStyle(el)
      return { background: s.backgroundColor, borderStyle: s.borderTopStyle, borderWidth: s.borderTopWidth, color: s.color }
    })
    const newChatBtn = await probe('assistant-new-conversation')
    expect(newChatBtn.background, '组件按钮背景非宿主绿色 #2e7d32').not.toBe('rgb(46, 125, 50)')
    expect(newChatBtn.borderStyle, '组件按钮边框非宿主虚线').not.toBe('dashed')
    const inputStyle = await page.getByTestId('assistant-input').evaluate((el) => {
      const s = getComputedStyle(el)
      return { borderColor: s.borderTopColor, borderWidth: s.borderTopWidth }
    })
    expect(inputStyle.borderColor, '组件输入框边框非宿主品红 #ff00ff').not.toBe('rgb(255, 0, 255)')

    // 3) 组件样式不外泄: 宿主按钮/段落保持宿主样式
    const hostBtn = await page.locator('#host-button').evaluate((el) => {
      const s = getComputedStyle(el)
      return { background: s.backgroundColor, borderStyle: s.borderTopStyle, borderWidth: s.borderTopWidth, color: s.color }
    })
    expect(hostBtn.background, '宿主按钮保持绿色').toBe('rgb(46, 125, 50)')
    expect(hostBtn.borderStyle, '宿主按钮保持虚线').toBe('dashed')
    expect(hostBtn.color, '宿主按钮字色保持黄色').toBe('rgb(255, 255, 0)')
    const hostP = await page.locator('.host-card p').first().evaluate((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, fontStyle: s.fontStyle }
    })
    expect(hostP.color, '宿主段落保持红色').toBe('rgb(204, 0, 0)')

    await shot(page, 'L7-01-ShadowDOM隔离-初始(宿主绿虚线+组件SDK样式)', testInfo)

    // 4) 主题令牌穿透 Shadow 边界: 宿主元素覆写 --ia-primary → 组件内继承值实时变化
    //    (探针 = 组件内元素上的 CSS 自定义属性计算值: --ia-primary(:host 默认)与
    //     --app-primary(组件映射)都应跟随宿主覆写; demo-host 处 DEF-05 态输入框禁用,
    //     故用继承值而非聚焦边框做判据)
    const themeBefore = await page.getByTestId('assistant-new-conversation').evaluate((el) => {
      const s = getComputedStyle(el)
      return { iaPrimary: s.getPropertyValue('--ia-primary').trim(), appPrimary: s.getPropertyValue('--app-primary').trim() }
    })
    expect(themeBefore.iaPrimary, '默认令牌 #409eff').toBe('#409eff')
    await page.locator('#toggle-theme').click()
    await expect(page.locator('#theme-label')).toHaveText(/紫色/)
    const themed = await page.getByTestId('assistant-new-conversation').evaluate((el) => {
      const s = getComputedStyle(el)
      return { iaPrimary: s.getPropertyValue('--ia-primary').trim(), appPrimary: s.getPropertyValue('--app-primary').trim() }
    })
    expect(themed.iaPrimary, '宿主覆写穿透 Shadow 边界(--ia-primary=#7c3aed)').toBe('#7c3aed')
    expect(themed.appPrimary, '组件内 --app-* 映射同步生效').toBe('#7c3aed')
    // 宿主按钮不受令牌影响(仍是宿主绿)
    const hostBtnAfter = await page.locator('#host-button').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(hostBtnAfter).toBe('rgb(46, 125, 50)')
    await shot(page, 'L7-01-主题令牌穿透(紫色实时换肤,宿主按钮不受影响)', testInfo)
  })

  test('L7-02 发消息→SSE 流式增量渲染(中间态+终态)', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    // 页面内 fetch 包装捕获 POST /runs 的 SSE 响应体(事件 id 序列证据;
    // Playwright response.text() 对流式响应取不到 body, 故用 in-page 包装)
    await captureSse(page)

    await openSdkChat(page, RECONNECT_HOST)
    await sendChat(page, MESSAGE)

    // 运行中: 停止按钮可见(非取消中)
    await page.getByTestId('assistant-stop').waitFor({ state: 'visible', timeout: 20_000 })
    // 流式中间态 1: 出现内容增量
    const liveContent = page.locator('[data-testid^="assistant-content-"]')
    await liveContent.first().waitFor({ state: 'visible', timeout: 20_000 })
    const len1 = await liveContentLength(page)
    await shot(page, 'L7-02-流式中间态1(工具chip+首段增量)', testInfo)

    // 流式中间态 2: 1.5s 后内容长度增长(增量渲染证据)
    await page.waitForTimeout(1500)
    const len2 = await liveContentLength(page)
    await shot(page, 'L7-02-流式中间态2(增量增长)', testInfo)
    expect(len2, '流式增量: 内容长度增长').toBeGreaterThan(len1)

    const state = await waitTerminal(page, 60_000)
    expect(state, '运行到达已完成终态').toBe('已完成')
    await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER)
    // 工具 chip 渲染(get_current_time)
    await expect(page.locator('.assistant-timeline__tool').first()).toContainText('get_current_time')
    await shot(page, 'L7-02-终态(已完成+全文+工具chip)', testInfo)

    // SSE 证据: 事件 id 序列严格递增且与库一致
    let sseCaptures = await readSseCaptured(page)
    for (let i = 0; i < 10 && !sseCaptures.some((c) => c.body); i++) {
      await page.waitForTimeout(500)
      sseCaptures = await readSseCaptured(page)
    }
    const sseText = sseCaptures.map((c) => c.body ?? '').join('\n\n')
    expect(sseText, 'SSE 响应已捕获').toContain('outputType')
    saveText('L7-02-run-SSE全量.txt', sseText)
    const ids = [...sseText.matchAll(/^id:.+:(\d+)$/gm)].map((m) => Number(m[1]))
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i], `SSE id 严格递增(${ids[i - 1]}→${ids[i]})`).toBeGreaterThan(ids[i - 1])
    }
    saveText('L7-02-run-SSE-id序列.txt', ids.join(','))
    // 库层: run 完成态
    const run = psql(`select run_id, status from ia_agent_run where user_id=${user} order by id desc limit 1`)
    saveText('L7-02-psql-run.txt', run)
    expect(run).toContain('COMPLETED')
    saveJournal(journal, `L7-02-api-journal-user${user}.txt`)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L7-03 消息历史: 刷新页面后会话保留与回放', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    await openSdkChat(page, RECONNECT_HOST)
    await sendChat(page, MESSAGE)
    expect(await waitTerminal(page), '首轮到达已完成').toBe('已完成')

    // 刷新页面(SDK 从 localStorage 恢复选中会话 + 服务端历史回放)
    await openSdkChat(page, RECONNECT_HOST)
    // 会话导航项存在且标题为消息前 50 字
    const navItem = page.locator('.assistant-nav__item').filter({ hasText: MESSAGE }).first()
    await expect(navItem).toBeVisible({ timeout: 20_000 })
    await expect(navItem).toContainText('已完成')
    // 历史回放: 用户气泡 + 助手全文
    await expect(page.getByTestId('assistant-user-bubble')).toContainText(MESSAGE, { timeout: 20_000 })
    await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER)
    await shot(page, 'L7-03-刷新后会话保留(历史回放)', testInfo)

    saveJournal(journal, `L7-03-api-journal-user${user}.txt`)
    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L7-04 新会话与切换会话', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)

    await openSdkChat(page, RECONNECT_HOST)
    const msgA = 'E2E切换甲:现在几点了?'
    await sendChat(page, msgA)
    expect(await waitTerminal(page), '会话甲完成').toBe('已完成')

    // 新建会话
    await page.getByTestId('assistant-new-conversation').click()
    await expect(page.getByTestId('assistant-welcome')).toBeVisible({ timeout: 10_000 })
    const msgB = 'E2E切换乙:现在几点了?'
    await sendChat(page, msgB)
    expect(await waitTerminal(page), '会话乙完成').toBe('已完成')
    await shot(page, 'L7-04-会话乙完成(列表含两条)', testInfo)

    // 列表两条会话,标题互异
    const itemA = page.locator('.assistant-nav__item').filter({ hasText: msgA }).first()
    const itemB = page.locator('.assistant-nav__item').filter({ hasText: msgB }).first()
    await expect(itemA).toBeVisible()
    await expect(itemB).toBeVisible()

    // 切回甲: 用户气泡为甲消息
    await itemA.click()
    await expect(page.getByTestId('assistant-user-bubble')).toContainText(msgA, { timeout: 15_000 })
    await expect(page.getByTestId('assistant-user-bubble')).not.toContainText(msgB)
    // 再切回乙
    await itemB.click()
    await expect(page.getByTestId('assistant-user-bubble')).toContainText(msgB, { timeout: 15_000 })
    await expect(page.getByTestId('assistant-user-bubble')).not.toContainText(msgA)
    await shot(page, 'L7-04-切换回会话乙(消息集互异)', testInfo)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L7-05 取消运行: 终态 CANCELLED 渲染', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    await openSdkChat(page, RECONNECT_HOST)
    await sendChat(page, MESSAGE)
    // 运行中立即停止
    const stop = page.getByTestId('assistant-stop')
    await stop.waitFor({ state: 'visible', timeout: 20_000 })
    await stop.click()
    // 取消中态
    await page.getByTestId('assistant-cancelling').waitFor({ state: 'visible', timeout: 10_000 })
    await shot(page, 'L7-05-取消中(按钮变取消中)', testInfo)

    expect(await waitTerminal(page, 60_000), '取消到达终态').toBe('已取消')
    await shot(page, 'L7-05-终态已取消渲染', testInfo)

    const run = psql(`select run_id, status from ia_agent_run where user_id=${user} order by id desc limit 1`)
    saveText('L7-05-psql-run.txt', run)
    expect(run, '库层 run 状态 CANCELLED').toContain('CANCELLED')
    saveJournal(journal, `L7-05-api-journal-user${user}.txt`)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L7-06 错误输入: 空消息禁用与超长消息', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)

    await openSdkChat(page, RECONNECT_HOST)

    // 空消息: 发送按钮禁用(UI 反馈)
    const send = page.getByTestId('assistant-send')
    await expect(send).toBeDisabled()
    // 纯空白同样禁用
    await page.getByTestId('assistant-input').fill('    ')
    await expect(send, '纯空白输入发送按钮仍禁用').toBeDisabled()
    await shot(page, 'L7-06-空消息发送禁用', testInfo)

    // 超长消息(100_000 字符): 观察 UI 行为(发送是否成功/有无反馈/是否崩溃)
    const longText = `E2E超长输入 ${'甲'.repeat(100_000)}`
    await page.getByTestId('assistant-input').fill(longText)
    await expect(send).toBeEnabled()
    await send.click()
    // 记录实际行为: 等待终态或错误反馈(超时前 60s)
    let outcome = 'no-terminal'
    try {
      outcome = await waitTerminal(page, 90_000)
    } catch {
      outcome = 'timeout-no-terminal'
    }
    const errVisible = await page.getByTestId('assistant-message-error').isVisible().catch(() => false)
    const alertVisible = await page.getByTestId('assistant-composer-alert').isVisible().catch(() => false)
    saveText('L7-06-超长输入结果.txt', `outcome=${outcome} messageError=${errVisible} composerAlert=${alertVisible}`)
    await shot(page, 'L7-06-超长输入后UI状态', testInfo)
    // 验收口径: UI 不崩溃; 到达终态或给出明确错误反馈
    expect(outcome === '已完成' || errVisible || alertVisible, '超长输入: 到达终态或明确反馈').toBe(true)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })
  test('L7-07 DEF-05 取证: 默认 baseURL 下 SDK http 层双重拼接 → 模型/会话全 404', async ({ page }, testInfo) => {
    // demo-host 按 README 口径接入: baseURL='/ia/api/v1'(SDK 默认值)。
    // SDK http.* 调用点(me/conversations/attachments/runs 查询端)自带
    // `${getBaseURL()}${path}`, 与 client.ts request() 内部拼接叠加 → 双重前缀。
    const notFound: Array<{ url: string; status: number }> = []
    page.on('response', (resp) => {
      if (resp.url().includes('/ia/')) notFound.push({ url: resp.url(), status: resp.status() })
    })
    await openSdkChat(page, DEMO_HOST, { requireModels: false })
    await page.waitForTimeout(2500)

    const doubled = notFound.filter((e) => e.url.includes('/ia/api/v1/ia/api/v1/'))
    saveText('L7-07-DEF05-双重拼接404请求.json', JSON.stringify(notFound, null, 2))
    expect(doubled.length, '存在双重前缀请求(/ia/api/v1/ia/api/v1/*)').toBeGreaterThan(0)
    expect(doubled.every((e) => e.status === 404), '双重前缀请求全部 404').toBe(true)
    // UI 后果: 模型列表加载失败 → 输入区错误提示 + 发送不可用
    const alert = page.getByTestId('assistant-composer-alert')
    await expect(alert).toContainText('请求的资源不存在', { timeout: 10_000 })
    await expect(page.getByTestId('assistant-send')).toBeDisabled()
    await shot(page, 'L7-07-DEF05-demo-host默认接入-模型404-发送禁用', testInfo)
  })
})
