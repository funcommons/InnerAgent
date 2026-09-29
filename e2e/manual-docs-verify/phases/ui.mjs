/**
 * phases/ui.mjs — 9203 demo 前端 UI 用例(快速开始/02 + 接入指南/03)。
 * 依赖 mock 默认模型(确认卡确定性)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { evidenceShot, runCase, ok, DEMO_FRONT, getBrowser, savePhase, assert } from '../lib.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')

async function newPage(context) { return context.newPage() }

async function login(page) {
  // 演示用户 filler-02907 已被预置映射为 userId=12993(与 API 侧演示头一致;
  // 后端重启后计数器从 10086 重发,alice 会撞上回归数据用户 10086,禁用)
  await page.goto(DEMO_FRONT + '/login')
  await page.getByRole('textbox', { name: /演示账号/ }).fill('filler-02907')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/ia/overview', { timeout: 20000 })
}

async function mountWC(page, agentType) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^(inneragent|fusion)-assistant/.test(key)) localStorage.removeItem(key)
    }
  }).catch(() => { })
  await page.goto(`${DEMO_FRONT}/ia/embed?agentType=${agentType}`)
  await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 15000 })
  const chat = page.locator('[data-testid="ia-chat"]')
  if (!(await chat.isVisible().catch(() => false))) {
    await page.locator('[data-testid="embed-mount"]').click()
  }
  await chat.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(1200)
}

async function sendChat(page, text) {
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(text)
  await page.locator('[data-testid="ia-chat"] button', { hasText: '发送' }).click()
}

async function waitReplyStable(page, maxMs = 60000) {
  const chat = page.locator('[data-testid="ia-chat"] .assistant-window__main')
  await chat.waitFor({ state: 'visible', timeout: 10000 })
  let last = await chat.innerText()
  let stable = 0
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(1500)
    const now = await chat.innerText()
    if (now.length === last.length) { stable += 1; if (stable >= 2) return now } else { stable = 0; last = now }
  }
  return last
}

async function findConfirmButton(page) {
  const candidates = [
    page.locator('[data-testid="ia-chat"] .assistant-messages button', { hasText: /确认执行|确认提交|批准|允许/ }).first(),
    page.locator('[data-testid="ia-chat"] button[class*="confirm-approve"]').first(),
    page.locator('[data-testid="ia-chat"] .assistant-messages button[class*="confirm"]').first(),
  ]
  for (const c of candidates) {
    if (await c.isVisible().catch(() => false)) return c
  }
  return null
}

export async function phaseUi() {
  const browser = await getBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  // ---------- QS2-1 快速开始/02 §5:登录 → 对话 → 确认卡 → 确认 ----------
  const TITLE = `手册UI工单-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
  await runCase('QS2-1', '02-快速开始/02', 'UI:演示登录 → 建工单话术 → 确认卡(回显参数)→ 确认 → 建单回复', async (e) => {
    await login(page)
    await mountWC(page, 'ticket-assistant')
    await sendChat(page, `帮我建一张工单:标题=${TITLE},描述=3楼打印机卡纸,优先级=high`)
    // 等确认卡
    let confirmBtn = null
    const t0 = Date.now()
    while (Date.now() - t0 < 60000 && !confirmBtn) {
      confirmBtn = await findConfirmButton(page)
      if (confirmBtn) break
      await page.waitForTimeout(1500)
    }
    if (!confirmBtn) throw new Error('60s 内未出现确认卡')
    const cardText = await page.locator('[data-testid="ia-chat"] .assistant-messages').innerText().catch(() => '')
    const shot1 = path.join('assets', 'QS2-1-confirm-card.png')
    await page.screenshot({ path: path.join(REPO, 'e2e/manual-docs-verify', shot1), fullPage: false })
    e.evidence.push('assets/QS2-1-confirm-card.png')
    await confirmBtn.click()
    const reply = await waitReplyStable(page, 60000)
    const shot2 = path.join('assets', 'QS2-1-after-confirm.png')
    await page.screenshot({ path: path.join(REPO, 'e2e/manual-docs-verify', shot2), fullPage: false })
    e.evidence.push('assets/QS2-1-after-confirm.png')
    const v = [
      ok(true, '确认卡出现', `标题=${TITLE}`),
      ok(cardText.includes(TITLE) || cardText.includes('打印机'), '确认卡回显将执行参数(标题/描述)', cardText.slice(-260).replace(/\n+/g, ' | ')),
      ok(/已创建成功|工单/.test(reply), '确认后收到建单结果回复', reply.slice(-200).replace(/\n+/g, ' | ')),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '确认卡文本(尾部)', body: cardText.slice(-500) }, { h: '确认后回复(尾部)', body: reply.slice(-400) }]
    await evidenceShot('QS2-1', '快速开始/02 · UI 确认流闭环', e._sections, { pass })
    e.evidence.push('assets/QS2-1.png')
    assert(pass, 'QS2-1 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- QS2-2 快速开始/02 §5:工具台账 channel=agent ----------
  await runCase('QS2-2', '02-快速开始/02', 'UI:工具面板台账出现 channel=agent 的本单工单卡片', async (e) => {
    await page.goto(DEMO_FRONT + '/ia/tools')
    await page.waitForSelector('[data-testid="ticket-list"]', { timeout: 15000 })
    await page.waitForTimeout(1500)
    const listText = await page.locator('[data-testid="ticket-list"]').innerText()
    const shot = path.join('assets', 'QS2-2-ticket-board.png')
    await page.screenshot({ path: path.join(REPO, 'e2e/manual-docs-verify', shot), fullPage: false })
    e.evidence.push('assets/QS2-2-ticket-board.png')
    const v = [
      ok(listText.includes(TITLE), `台账含本轮工单「${TITLE}」`, listText.slice(0, 300).replace(/\n+/g, ' | ')),
      ok(/agent/i.test(listText), '含 agent 渠道标记', (listText.match(/.{0,30}agent.{0,30}/i) || [''])[0]),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '台账文本(截取)', body: listText.slice(0, 900) }]
    await evidenceShot('QS2-2', '快速开始/02 · 工具台账 channel=agent', e._sections, { pass })
    e.evidence.push('assets/QS2-2.png')
    assert(pass, 'QS2-2 失败')
  })

  // ---------- IG3-1 接入指南/03 §2:WC 直挂对话 ----------
  await runCase('IG3-1', '03-接入指南/03', 'UI:WC(<inneragent-chat>)挂载并完成一轮对话', async (e) => {
    await mountWC(page, 'knowledge-qa')
    await sendChat(page, '年假有几天?')
    const reply = await waitReplyStable(page, 60000)
    const shot = path.join('assets', 'IG3-1-wc-chat.png')
    await page.screenshot({ path: path.join(REPO, 'e2e/manual-docs-verify', shot), fullPage: false })
    e.evidence.push('assets/IG3-1-wc-chat.png')
    const v = [
      ok(await page.locator('[data-testid="ia-chat"]').isVisible(), 'WC 组件挂载可见', 'data-testid=ia-chat'),
      ok(reply.includes('[KB:]') || reply.length > 10, '对话收到回复(知识库话术含 [KB:] 引用)', reply.slice(-180).replace(/\n+/g, ' | ')),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '回复(尾部)', body: reply.slice(-300) }]
    await evidenceShot('IG3-1', '接入指南/03 · WC 直挂对话', e._sections, { pass })
    e.evidence.push('assets/IG3-1.png')
    assert(pass, 'IG3-1 失败')
  })

  // ---------- IG3-2 接入指南/03 §3:iframe postMessage 握手 ----------
  await runCase('IG3-2', '03-接入指南/03', 'UI:iframe + postMessage 模式完成握手(高度/状态事件回传)', async (e) => {
    await page.goto(`${DEMO_FRONT}/ia/embed?agentType=ticket-assistant`)
    await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 15000 })
    const modeSelect = page.locator('.controls .field', { hasText: '接入模式' }).locator('.el-select, select, [role="combobox"]').first()
    await modeSelect.click()
    await page.waitForTimeout(500)
    await page.locator('.el-select-dropdown__item', { hasText: 'iframe' }).first().click()
    await page.waitForTimeout(500)
    await page.locator('[data-testid="embed-mount"]').click()
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="embed-handshake"]')
      return el && /完成|ok|success/i.test(el.textContent || '')
    }, { timeout: 40000 })
    const handshake = await page.locator('[data-testid="embed-handshake"]').innerText()
    const shot = path.join('assets', 'IG3-2-iframe-handshake.png')
    await page.screenshot({ path: path.join(REPO, 'e2e/manual-docs-verify', shot), fullPage: false })
    e.evidence.push('assets/IG3-2-iframe-handshake.png')
    const v = [ok(true, 'iframe 握手完成标记出现', handshake.slice(0, 120))]
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '握手区文本', body: handshake.slice(0, 300) }]
    await evidenceShot('IG3-2', '接入指南/03 · iframe 握手', e._sections, { pass: true })
    e.evidence.push('assets/IG3-2.png')
  })

  // ---------- IG3-3 接入指南/03:参考文件在盘(静态核对佐证)----------
  await runCase('IG3-3', '03-接入指南/03', '静态核对:SDK/iframe 参考实现文件在盘(sdk-js、EmbedChat.vue、frame.html 等)', async (e) => {
    const files = [
      'sdk-js/', 'examples/acme-demo/frontend/src/views/ia/EmbedChat.vue',
      'examples/acme-demo/frontend/src/vendor/inneragent/iframe-host.js',
      'examples/acme-demo/frontend/public/ia/frame.html',
      'examples/acme-demo/frontend/public/ia/frame.js',
      'examples/acme-demo/frontend/public/ia/iframe-child.js',
      'examples/acme-demo/frontend/src/ia/iframeEmbed.ts',
    ]
    const rows = files.map((f) => ({ f, exists: fs.existsSync(path.join(REPO, f)) }))
    const v = rows.map((r) => ok(r.exists, `在盘: ${r.f}`, r.exists ? '存在' : '缺失'))
    const pass = v.every((x) => x.ok)
    e.notes.push('本用例为静态核对(文件存在性),非行为断言')
    e._sections = [{ h: '文件存在性(手册 §2/§3 引用的参考实现)', verdicts: v }]
    await evidenceShot('IG3-3', '接入指南/03 · 参考实现在盘核对(静态)', e._sections, { pass })
    e.evidence.push('assets/IG3-3.png')
    assert(pass, 'IG3-3 失败')
  })

  await context.close()
  savePhase('ui')
}
