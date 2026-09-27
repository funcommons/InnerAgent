/**
 * [tmp] demo 业务线全量回归驱动(2026-09-24,只读测试不改产品代码)。
 * 产物:test-report/2026-09-24-01/assets/*.{png,txt} + results.json
 * 口径:PASS=关键图;FAIL=失败时截图+DOM 文本 dump+控制台/网络错误证据链。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const reportDir = path.join(here, '..')
const assetsDir = path.join(reportDir, 'assets')
fs.mkdirSync(assetsDir, { recursive: true })

const BASE = 'http://localhost:9203'
const results = []
let consoleBuf = []   // {type, text}
let httpBuf = []      // {status, url}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') consoleBuf.push({ type: 'console.error', text: m.text().slice(0, 300) })
})
page.on('pageerror', (e) => consoleBuf.push({ type: 'pageerror', text: String(e).slice(0, 300) }))
page.on('response', (r) => {
  if (r.status() >= 400) httpBuf.push({ status: r.status(), url: r.url().replace(BASE, '').slice(0, 160) })
})

async function shot(name) {
  const file = path.join(assetsDir, name)
  await page.screenshot({ path: file, fullPage: false })
  return `assets/${name}`
}

async function dumpDom(name) {
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000))
  const file = path.join(assetsDir, name)
  fs.writeFileSync(file, text)
  return `assets/${name}`
}

async function runCase(id, line, title, fn) {
  const beforeConsole = consoleBuf.length
  const beforeHttp = httpBuf.length
  const entry = { id, line, title, status: 'PASS', notes: [], shots: [], consoleErrors: [], httpErrors: [] }
  const t0 = Date.now()
  try {
    await fn(entry)
  } catch (e) {
    entry.status = 'FAIL'
    entry.notes.push(`异常: ${String(e).slice(0, 400)}`)
    try { entry.shots.push(await shot(`${id}-fail.png`)) } catch { /* ignore */ }
    try { entry.notes.push(`DOM 文本: ${await dumpDom(`${id}-fail-dom.txt`)}`) } catch { /* ignore */ }
  }
  entry.consoleErrors = consoleBuf.slice(beforeConsole)
  entry.httpErrors = httpBuf.slice(beforeHttp)
  if (entry.consoleErrors.length) entry.notes.push(`控制台错误 ${entry.consoleErrors.length} 条(见 consoleErrors)`)
  if (entry.httpErrors.length) entry.notes.push(`HTTP≥400 ${entry.httpErrors.length} 条(见 httpErrors)`)
  entry.ms = Date.now() - t0
  results.push(entry)
  console.log(`[${entry.status}] ${id} ${title} (${(entry.ms / 1000).toFixed(1)}s)`)
}

/** 等待聊天区内文本稳定(模型流式回复结束) */
async function waitReplyStable(maxMs = 90000) {
  const chat = page.locator('[data-testid="ia-chat"] .assistant-window__main')
  await chat.waitFor({ state: 'visible', timeout: 10000 })
  let last = await chat.innerText()
  let stable = 0
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(2000)
    const now = await chat.innerText()
    if (now.length === last.length) {
      stable += 1
      if (stable >= 2) return now
    } else {
      stable = 0
      last = now
    }
  }
  return last
}

async function mountWC(agentType) {
  // §8.7/P2 修复(2026-09-27):SDK 把 pipeline.pendingConfirmation 持久化在
  // inneragent-assistant:* localStorage 键下,跨页面重载原样恢复 asking 态
  // (textarea disabled),L6/L7/L8 因此 31s 超时。挂载前清会话缓存 = 全新会话。
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^(inneragent|fusion)-assistant/.test(key)) localStorage.removeItem(key)
    }
  }).catch(() => { })
  await page.goto(`${BASE}/ia/embed?agentType=${agentType}`)
  await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 10000 })
  const mountBtn = page.locator('[data-testid="embed-mount"]')
  // 深链进入时 selectedAgentType 变化会自动挂载:若 ia-chat 已出现则跳过
  const chat = page.locator('[data-testid="ia-chat"]')
  if (!(await chat.isVisible().catch(() => false))) {
    await mountBtn.click()
  }
  await chat.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(1200)
}

async function sendChat(text) {
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(text)
  const sendBtn = page.locator('[data-testid="ia-chat"] button', { hasText: '发送' })
  await sendBtn.click()
}

// ============================================================
// L0 站点框架
// ============================================================
await runCase('L0-1', '站点框架', '首页可达且渲染品牌区', async (e) => {
  await page.goto(BASE + '/')
  await page.waitForLoadState('domcontentloaded')
  const text = await page.locator('body').innerText()
  if (!/ACME|InnerAgent/i.test(text)) throw new Error('首页未见品牌文案')
  e.shots.push(await shot('L0-1-home.png'))
})

// ============================================================
// L1 登录与会话
// ============================================================
await runCase('L1-1', '登录与会话', '空用户名提交被前端校验拦截', async (e) => {
  await page.goto(BASE + '/login')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForTimeout(800)
  const still = page.url().includes('/login')
  if (!still) throw new Error('空用户名未被拦截,发生了跳转')
  e.shots.push(await shot('L1-1-empty-blocked.png'))
})

await runCase('L1-2', '登录与会话', '轻登录 alice 成功并进入总览', async (e) => {
  await page.getByRole('textbox', { name: /演示账号/ }).fill('alice')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/ia/overview', { timeout: 15000 })
  const text = await page.locator('body').innerText()
  if (!text.includes('alice')) throw new Error('顶栏未显示 alice')
  e.shots.push(await shot('L1-2-login-ok.png'))
})

// ============================================================
// L2 接入总览
// ============================================================
await runCase('L2-1', '接入总览', '五步自检卡渲染齐全', async (e) => {
  await page.waitForSelector('[data-testid="overview-step"]', { timeout: 10000 })
  const n = await page.locator('[data-testid="overview-step"]').count()
  if (n !== 5) throw new Error(`自检卡数量=${n},期望 5`)
  e.shots.push(await shot('L2-1-steps.png'))
})

await runCase('L2-2', '接入总览', '开通状态=已注册且指纹非空', async (e) => {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="server-state"]')
    return el && el.textContent.includes('已注册')
  }, { timeout: 15000 })
  const text = await page.locator('body').innerText()
  if (!/39780d49|signKeyFingerprint/.test(text)) throw new Error('指纹区域未见')
  e.shots.push(await shot('L2-2-registered.png'))
})

await runCase('L2-3', '接入总览', '能力覆盖表渲染(≥16 行且行行有落点)', async (e) => {
  await page.waitForSelector('[data-testid="capability-coverage"]', { timeout: 10000 })
  const rows = page.locator('[data-testid="coverage-row"]')
  const n = await rows.count()
  if (n < 16) throw new Error(`覆盖表仅 ${n} 行`)
  let annotated = 0
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText()
    if (t.includes('内核保障') || (await rows.nth(i).locator('a').count()) > 0) annotated += 1
  }
  if (annotated !== n) throw new Error(`${n - annotated} 行既无链接也无内核保障标注`)
  e.notes.push(`覆盖表 ${n} 行全部有落点`)
  e.shots.push(await shot('L2-3-coverage.png'))
})

// ============================================================
// L3 场景画廊
// ============================================================
await runCase('L3-1', '场景画廊', '五张场景卡+能力矩阵渲染', async (e) => {
  await page.goto(BASE + '/ia/agents')
  await page.waitForSelector('[data-testid^="agent-card-"]', { timeout: 10000 })
  const cards = await page.locator('[data-testid^="agent-card-"]').count()
  if (cards !== 5) throw new Error(`场景卡=${cards},期望 5`)
  if (!(await page.locator('[data-testid="capability-matrix"]').isVisible())) throw new Error('能力矩阵未渲染')
  e.shots.push(await shot('L3-1-gallery.png'))
})

await runCase('L3-2', '场景画廊', '剧本折叠默认收起且可展开', async (e) => {
  const toggle = page.locator('[data-testid="script-toggle-ticket-assistant"]')
  if (!(await toggle.isVisible())) throw new Error('剧本开关未找到')
  const before = await page.locator('[data-testid="script-steps-ticket-assistant"]').getAttribute('style')
  await toggle.click()
  await page.waitForTimeout(400)
  const after = await page.locator('[data-testid="script-steps-ticket-assistant"]').getAttribute('style')
  if ((before ?? '').includes('display: none') === false) throw new Error('默认未收起')
  if ((after ?? '').includes('display: none')) throw new Error('点击后未展开')
  e.shots.push(await shot('L3-2-script-open.png'))
  await toggle.click()
})

await runCase('L3-3', '场景画廊', '「开始对话」深链携带 agentType', async (e) => {
  await page.locator('[data-testid="start-chat-ticket-assistant"]').click()
  await page.waitForURL('**/ia/embed?agentType=ticket-assistant', { timeout: 10000 })
  const current = await page.locator('[data-testid="embed-agent-type-current"]').innerText()
  if (!current.includes('ticket-assistant')) throw new Error(`deep link 后 agentType=${current}`)
  e.shots.push(await shot('L3-3-deeplink.png'))
})

// ============================================================
// L4 嵌入对话·WC 直挂
// ============================================================
await runCase('L4-1', '嵌入对话·WC', '挂载成功:WC 聊天组件出现', async (e) => {
  await mountWC('ticket-assistant')
  e.shots.push(await shot('L4-1-mounted.png'))
})

await runCase('L4-2', '嵌入对话·WC', 'SSE 真模型流式回复(MiniMax-M3)', async (e) => {
  await sendChat('你好,请用一句话介绍你能帮我做什么。')
  const reply = await waitReplyStable(90000)
  if (reply.trim().length < 20) throw new Error(`回复过短(${reply.length} 字符),疑似未收到流式回复`)
  e.notes.push(`回复长度 ${reply.length} 字符`)
  e.shots.push(await shot('L4-2-sse-reply.png'))
})

await runCase('L4-3', '嵌入对话·WC', 'Enter=换行不误发送,点「发送」才提交', async (e) => {
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.click()
  await input.type('回归-第一行')
  await input.press('Enter')
  await input.type('回归-第二行')
  const value = await input.inputValue()
  if (!value.includes('\n')) throw new Error('Enter 未产生换行')
  await page.waitForTimeout(2500)
  e.notes.push('Enter 后未触发发送(无新回复),值含换行')
  e.shots.push(await shot('L4-3-enter-newline.png'))
  const sendBtn = page.locator('[data-testid="ia-chat"] button', { hasText: '发送' })
  await sendBtn.click()
  const reply = await waitReplyStable(60000)
  if (reply.trim().length < 10) throw new Error('点发送后未收到回复')
  e.shots.push(await shot('L4-3-sent-ok.png'))
})

await runCase('L4-4', '嵌入对话·WC', '销毁后重新挂载可用', async (e) => {
  await page.locator('[data-testid="embed-destroy"]').click()
  await page.waitForTimeout(600)
  if (await page.locator('[data-testid="ia-chat"]').isVisible().catch(() => false)) {
    throw new Error('销毁后 ia-chat 仍在')
  }
  await page.locator('[data-testid="embed-mount"]').click()
  await page.waitForSelector('[data-testid="ia-chat"]', { timeout: 20000 })
  e.shots.push(await shot('L4-4-remount.png'))
})

// ============================================================
// L5 确认流(WRITE 工具)
// ============================================================
async function findConfirmButton() {
  // 候选:确认/批准类按钮(class 含 confirm 或文本)
  const candidates = [
    page.locator('[data-testid="ia-chat"] button[class*="confirm-approve"]').first(),
    page.locator('[data-testid="ia-chat"] [class*="confirm-bar"] button').first(),
    page.locator('[data-testid="ia-chat"] button', { hasText: /确认执行|确认|批准/ }).first(),
  ]
  for (const c of candidates) {
    if (await c.isVisible().catch(() => false)) return c
  }
  return null
}

// [2026-09-27] 工单标题带时间戳:L5-3 标题匹配即天然新鲜度断言
// (演示后台工单计数器在重启后会重置,数字比对跨重启不可靠)
const REG_TICKET_TITLE = `回归测试工单A-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`

await runCase('L5-1', '确认流(WRITE 工具)', '建单意图触发确认卡(WRITE 先确认)', async (e) => {
  await mountWC('ticket-assistant')
  await sendChat(`帮我建一张工单:标题=${REG_TICKET_TITLE},描述=Playwright 全量回归创建,优先级=high`)

  const confirmInUi = async () => {
    // 确认卡:只认「允许/批准」类按钮(2026-09-27 修复:此前 byClass 匹配到
    // class 含 confirm 的卡片容器并点击,按钮原样未动,确认从未提交)
    const byText = page.locator('[data-testid="ia-chat"] .assistant-messages button', { hasText: /确认执行|确认提交|批准|允许/ }).first()
    if (await byText.isVisible().catch(() => false)) return byText
    const byClass = page.locator('[data-testid="ia-chat"] .assistant-messages button[class*="confirm"]').first()
    if (await byClass.isVisible().catch(() => false)) return byClass
    return null
  }

  // 第一段:等首轮回复稳态后,若仍无确认卡,再发确认消息促其发起工具调用
  await waitReplyStable(120000)
  let confirmBtn = await confirmInUi()
  let clarified = false
  if (!confirmBtn) {
    clarified = true
    await sendChat('确认,信息无误,请立即按上述内容提交建单。')
    const t0 = Date.now()
    while (Date.now() - t0 < 90000 && !confirmBtn) {
      confirmBtn = await confirmInUi()
      if (confirmBtn) break
      await page.waitForTimeout(2000)
    }
  }
  if (!confirmBtn) {
    const text = await page.locator('[data-testid="ia-chat"] .assistant-window__main').innerText()
    throw new Error(`90s 内未出现确认卡;消息区尾部: ${text.slice(-300)}`)
  }
  e.notes.push(clarified ? '经一轮澄清后出现确认卡' : '直接出现确认卡')
  e.shots.push(await shot('L5-1-confirm-card.png'))
  await confirmBtn.click()
  const reply = await waitReplyStable(90000)
  if (!/工单|T-?\d+|已创建|创建成功/.test(reply)) {
    throw new Error(`确认后回复未见工单信息,尾部: ${reply.slice(-300)}`)
  }
  e.notes.push('确认后收到工单回复')
  e.shots.push(await shot('L5-2-confirm-executed.png'))
})

await runCase('L5-3', '确认流(WRITE 工具)', '确认流工单落台账(channel=agent)', async (e) => {
  await page.goto(BASE + '/ia/tools')
  await page.waitForSelector('[data-testid="ticket-list"]', { timeout: 10000 })
  const listText = await page.locator('[data-testid="ticket-list"]').innerText()
  if (!listText.includes(REG_TICKET_TITLE)) {
    throw new Error(`台账未见本 round 工单「${REG_TICKET_TITLE}」(标题唯一,无跨轮假阳性)`)
  }
  if (!listText.includes('Agent') && !listText.includes('agent')) throw new Error('未见 agent 渠道标记')
  e.notes.push(`台账含本 round 工单「${REG_TICKET_TITLE}」`)
  e.shots.push(await shot('L5-3-ticket-agent.png'))
})

// ============================================================
// L6 KB 检索(knowledge-qa)
// ============================================================
await runCase('L6-1', 'KB 检索', 'knowledge-qa 回答携带 [KB:] 引用标记', async (e) => {
  await mountWC('knowledge-qa')
  await sendChat('年假有几天?')
  const reply = await waitReplyStable(90000)
  if (!reply.includes('[KB:')) {
    throw new Error(`回复未携带 [KB:] 引用标记,尾部: ${reply.slice(-300)}`)
  }
  e.shots.push(await shot('L6-1-kb-citation.png'))
})

// ============================================================
// L7 Skill 注入(report-writer)
// ============================================================
await runCase('L7-1', 'Skill 注入', 'report-writer 技能场景正常回复', async (e) => {
  await mountWC('report-writer')
  await sendChat('请按报告规范写一段 Q3 销售总结的开头,主题是华东区回款。')
  const reply = await waitReplyStable(90000)
  if (reply.trim().length < 30) throw new Error(`回复过短(${reply.length} 字符)`)
  e.shots.push(await shot('L7-1-skill-reply.png'))
})

// ============================================================
// L8 子 Agent 编排(ops-analyst)
// ============================================================
await runCase('L8-1', '子 Agent 编排', 'ops-analyst 双层编排正常回复', async (e) => {
  await mountWC('ops-analyst')
  await sendChat('请汇总当前工单情况并给出一句运营建议。')
  const reply = await waitReplyStable(120000)
  if (reply.trim().length < 20) throw new Error(`回复过短(${reply.length} 字符)`)
  e.shots.push(await shot('L8-1-subagent.png'))
})

// ============================================================
// L9 工具调用演示页
// ============================================================
await runCase('L9-1', '工具调用演示', '表单直建工单(channel=direct)', async (e) => {
  await page.goto(BASE + '/ia/tools')
  await page.waitForSelector('[data-testid="ticket-list"]', { timeout: 10000 })
  const before = await page.locator('[data-testid="ticket-list"] .ticket-row').count()
  await page.getByPlaceholder('工单标题,例如:登录页在 Chrome 下白屏').fill('直连回归工单B')
  await page.getByPlaceholder('详情描述(可选):复现步骤、影响范围…').fill('ToolsBoard 表单直建')
  await page.locator('[data-testid="ticket-submit"]').click()
  await page.waitForTimeout(1500)
  const after = await page.locator('[data-testid="ticket-list"] .ticket-row').count()
  if (after !== before + 1) throw new Error(`工单行数 ${before}→${after},未 +1`)
  const listText = await page.locator('[data-testid="ticket-list"]').innerText()
  if (!listText.includes('直连回归工单B')) throw new Error('列表未见新工单')
  e.shots.push(await shot('L9-1-direct-ticket.png'))
})

await runCase('L9-2', '工具调用演示', 'Webhook 事件流渲染(事件或空态)', async (e) => {
  const empty = page.locator('[data-testid="webhook-empty"]')
  const hasEvents = (await empty.count()) === 0
  if (!hasEvents) {
    const t = await empty.innerText()
    if (t.trim().length === 0) throw new Error('空态文案为空')
    e.notes.push('事件流为空态(合理:未配置事件窗口内无投递)')
  } else {
    e.notes.push('事件流有数据')
  }
  e.shots.push(await shot('L9-2-webhook-events.png'))
})

// ============================================================
// L10 管理台嵌入
// ============================================================
await runCase('L10-1', '管理台嵌入', 'iframe 登录并落定义页(独立管理员会话)', async (e) => {
  await page.goto(BASE + '/ia/admin')
  await page.waitForSelector('[data-testid="ia-admin-frame"]', { timeout: 15000 })
  // §8.12-5 flake 加固(2026-09-27):iframe attach 与导航到 18081 存在时差,
  // 立即 find 会落空 —— 轮询等 frame URL 就位
  let frame = null
  const frameT0 = Date.now()
  while (Date.now() - frameT0 < 15000) {
    frame = page.frames().find((f) => f.url().startsWith('http://localhost:18081'))
    if (frame) break
    await page.waitForTimeout(300)
  }
  if (!frame) throw new Error('15s 内未找到 18081 iframe')
  await frame.getByPlaceholder('管理员用户名').fill('admin')
  await frame.getByPlaceholder('管理员密码').fill('Admin#12345')
  await frame.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForTimeout(3000)
  const url = frame.url()
  if (!url.includes('/definitions')) throw new Error(`iframe 未落定义页: ${url}`)
  const rows = await frame.locator('.el-table__row').count()
  if (rows === 0) throw new Error('定义页无数据行')
  e.notes.push(`定义页 ${rows} 行`)
  e.shots.push(await shot('L10-1-admin-embed.png'))
})

// ============================================================
// L11 体验台(playground)
// ============================================================
await runCase('L11-1', '体验台', '签发 embed token 并可视化 claims', async (e) => {
  await page.goto(BASE + '/playground')
  await page.waitForSelector('[data-testid="pg-form"], [data-testid="pg-console"]', { timeout: 10000 })
  // 若已在会话态可能直接展示;否则提交表单
  if (await page.locator('[data-testid="pg-empty"]').isVisible().catch(() => false) ||
      (await page.locator('[data-testid="pg-submit"]').count()) > 0) {
    const user = page.locator('[data-testid="pg-form"] input')
    if (await user.count()) await user.first().fill('alice')
    await page.locator('[data-testid="pg-submit"]').click()
  }
  await page.waitForSelector('[data-testid="pg-signed-ok"], [data-testid="pg-console"]', { timeout: 20000 })
  const text = await page.locator('body').innerText()
  if (!text.includes('sub') || !text.includes('exp')) throw new Error('claims(sub/exp)未可视化')
  if (!text.includes('acme-demo')) throw new Error('claims 未含 iss=acme-demo')
  e.shots.push(await shot('L11-1-playground.png'))
})

// ============================================================
// L12 iframe postMessage 模式
// ============================================================
await runCase('L12-1', '嵌入·iframe 模式', '切换 iframe 模式并完成握手', async (e) => {
  await page.goto(BASE + '/ia/embed?agentType=ticket-assistant')
  await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 10000 })
  // 模式选择(FcSelect):点击后选「iframe postMessage」
  const modeSelect = page.locator('.controls .field', { hasText: '接入模式' }).locator('.el-select, select, [role="combobox"]').first()
  await modeSelect.click()
  await page.waitForTimeout(400)
  await page.locator('.el-select-dropdown__item', { hasText: 'iframe' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="embed-mount"]').click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="embed-handshake"]')
    return el && /完成|ok|success/i.test(el.textContent || '')
  }, { timeout: 30000 })
  e.notes.push('握手完成')
  e.shots.push(await shot('L12-1-iframe-handshake.png'))
})

// ============================================================
// L1-3 登出(最后执行)
// ============================================================
await runCase('L1-3', '登录与会话', '登出回到登录页', async (e) => {
  // 打开用户菜单/登出入口:直接访问 logout 路由亦可,但走 UI 更真实
  await page.goto(BASE + '/logout')
  await page.waitForTimeout(1500)
  if (!page.url().includes('/login')) throw new Error(`登出后 URL=${page.url()}`)
  e.shots.push(await shot('L1-3-logout.png'))
})

fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(results, null, 2))
const pass = results.filter(r => r.status === 'PASS').length
console.log(`\n[summary] ${pass}/${results.length} PASS → ${reportDir}`)
await browser.close()
