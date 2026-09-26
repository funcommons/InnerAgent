/**
 * [tmp] L5 确认流专项复测(2026-09-24):
 * 验证「确认流退出触发器」系统提示词修复后,L5-1/L5-3 是否转 PASS。
 *
 * 输出:
 *   e2e/l5-results.json: { id, status, ms, notes, shots, error }
 *   e2e/l5-assets/*.png: 关键截图
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.join(here, 'l5-assets')
fs.mkdirSync(assetsDir, { recursive: true })

const BASE = 'http://localhost:9203'
const results = []
const consoleBuf = []
const httpBuf = []

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
  return `l5-assets/${name}`
}

async function dumpDom(name) {
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000))
  const file = path.join(assetsDir, name)
  fs.writeFileSync(file, text)
  return `l5-assets/${name}`
}

async function runCase(id, title, fn) {
  const t0 = Date.now()
  const entry = { id, title, status: 'PASS', ms: 0, notes: [], shots: [], consoleErrors: [], httpErrors: [] }
  try {
    await fn(entry)
  } catch (e) {
    entry.status = 'FAIL'
    entry.error = String(e?.message ?? e).slice(0, 400)
    entry.shots.push(await shot(`${id}-fail.png`))
    entry.dump = await dumpDom(`${id}-fail-dom.txt`)
  } finally {
    entry.ms = Date.now() - t0
    entry.consoleErrors = consoleBuf.slice(-10)
    entry.httpErrors = httpBuf.slice(-10)
    results.push(entry)
  }
}

async function mountWC(agentType) {
  await page.goto(`${BASE}/ia/embed?agentType=${agentType}`)
  await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 10000 })
  const mountBtn = page.locator('[data-testid="embed-mount"]')
  const chat = page.locator('[data-testid="ia-chat"]')
  // 强制点 mount:深链自动挂载常常只创建 WC element,textarea 未渲染;
  // 显式 click 触发完整 SDK init 流程
  await mountBtn.click()
  await chat.waitFor({ state: 'visible', timeout: 20000 })
  // 等 SDK 内部 textarea 就绪(由 SDK 完成 mount + 状态初始化;不设太短否则
  // L5 verify 立即 sendChat 时 textarea 还在 disabled 初始态)。
  // 注:textarea 在 shadow DOM 内,document.querySelector 不穿透,需穿两层取。
  await page.waitForFunction(
    () => {
      const wc = document.querySelector('inneragent-chat')
      return !!wc?.shadowRoot?.querySelector('textarea')
    },
    null,
    { timeout: 60000 },
  )
  await page.waitForTimeout(500)
}

async function sendChat(text) {
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.waitFor({ state: 'visible', timeout: 10000 })
  // 等 SDK 初始化完成:IA_READY 后 textarea 才 enabled(disabled = !ready)。
  // shadow DOM 内元素:穿 inneragent-chat.shadowRoot
  await page.waitForFunction(
    () => {
      const wc = document.querySelector('inneragent-chat')
      const ta = wc?.shadowRoot?.querySelector('textarea')
      return ta && !ta.disabled
    },
    null,
    { timeout: 30000 },
  )
  await input.fill(text)
  const sendBtn = page.locator('[data-testid="ia-chat"] button', { hasText: '发送' })
  await sendBtn.click()
}

/** 等聊天区文本稳定(模型流式回复结束)— 复制 9204 的实现 */
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

// ============================================================
// 前置:登录 alice
// ============================================================
console.log('[setup] login alice…')
await page.goto(BASE + '/login')
await page.getByRole('textbox', { name: /演示账号/ }).fill('alice')
await page.getByRole('button', { name: '登 录' }).click()
await page.waitForURL('**/ia/overview', { timeout: 15000 })
console.log('[setup] overview ok')

console.log('[setup] mountWC(ticket-assistant)…')
await mountWC('ticket-assistant')
console.log('[setup] chat mounted')

// ============================================================
// L5-1: 第二轮「确认」消息后,≤90s 内调起 create_ticket 弹确认卡
// ============================================================
await runCase('L5-1', '建单意图触发确认卡(确认流退出触发器已生效)', async (e) => {
  console.log('[L5-1] 第 1 轮: 发建单请求')
  await sendChat('帮我建一张工单:标题=回归测试工单A,描述=Playwright 全量回归创建,优先级=high')

  // 等模型首轮稳态
  const first = await waitReplyStable(120000)
  if (first.trim().length < 10) throw new Error(`首轮回复过短:${first.length} 字符`)
  e.notes.push(`首轮长度 ${first.length} 字符;尾部: ${first.slice(-80).replace(/\n/g, ' ')}`)
  e.shots.push(await shot('L5-1-after-first-turn.png'))

  console.log('[L5-1] 第 2 轮: 发确认消息(命中退出触发器)')
  await sendChat('确认,信息无误,请立即按上述内容提交建单。')

  // 等第二轮稳态,然后判断是否包含确认卡信号
  const second = await waitReplyStable(90000)
  e.notes.push(`第二轮长度 ${second.length} 字符;尾部: ${second.slice(-100).replace(/\n/g, ' ')}`)
  e.shots.push(await shot('L5-1-second-turn.png'))
  if (!/确认执行|批准|Allow|Confirm|确认提交|确认建单|允许|拒绝|create_ticket/.test(second)) {
    throw new Error(`第二轮未出现确认卡信号: 尾部=${second.slice(-300)}`)
  }
  e.shots.push(await shot('L5-1-confirm-card.png'))
})

// ============================================================
// L5-3: 批准后工单落台账(channel=agent)
// ============================================================
await runCase('L5-3', '确认流工单落台账(channel=agent)', async (e) => {
  // 点 SDK 容器内的「确认执行/批准」按钮
  const clicked = await page.evaluate(() => {
    const wc = document.querySelector('inneragent-chat')
    const root = wc?.shadowRoot
    if (!root) return false
    const buttons = Array.from(root.querySelectorAll('button'))
    const confirmBtn = buttons.find((b) => /确认执行|批准|Allow|Confirm|确认提交|允许/.test((b.textContent || '').trim()))
    if (confirmBtn) {
      confirmBtn.click()
      return true
    }
    return false
  })
  e.notes.push(clicked ? '已点确认执行' : '未找到确认执行按钮(可能 UI 已自动批准)')

  // 轮询工具页直至 agent 渠道出现目标工单(2026-09-27 改造:
  // 原一次性断言在恢复执行完成前就加载列表,时序性误报)。
  const deadline = Date.now() + 60000
  let ticketSeen = false
  let lastError = null
  while (Date.now() < deadline && !ticketSeen) {
    try {
      await page.goto(`${BASE}/ia/tools`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-testid="ticket-list"]', { timeout: 10000 })
      const filter = page.locator('[data-testid="filter-agent"]')
      if (await filter.count()) await filter.click()
      await page.waitForTimeout(1500)
      ticketSeen = await page.evaluate(() => {
        // 已点 filter-agent:列表本身即 agent 渠道(行内渠道标签是自定义
        // FcTag,无 el-tag class,旧 tag 选择器恒空导致时序外误报)
        const items = Array.from(document.querySelectorAll('[data-testid="ticket-list"] .ticket-row'))
        return items.some((el) => /回归测试工单A|Playwright 全量回归/.test(el.textContent || ''))
      })
    } catch (err) {
      lastError = err
    }
    if (!ticketSeen) await page.waitForTimeout(3000)
  }
  e.shots.push(await shot('L5-3-tools-board.png'))
  if (!ticketSeen) {
    throw new Error('60s 内 tools 页 agent 渠道未出现「回归测试工单A」' + (lastError ? `;last=${String(lastError?.message ?? last).slice(0, 120)}` : ''))
  }
  e.notes.push('回归测试工单A 已落台账 channel=agent')
})

await browser.close()

fs.writeFileSync(path.join(here, 'l5-results.json'), JSON.stringify(results, null, 2))
const summary = results.map((r) => `${r.status === 'PASS' ? '✓' : '✗'} ${r.id} (${r.ms}ms) ${r.title}${r.notes.length ? ' — ' + r.notes.join(' | ') : ''}${r.error ? ' — ' + r.error : ''}`).join('\n')
console.log('\n========== L5 复测结果 ==========')
console.log(summary)
console.log(`PASS: ${results.filter((r) => r.status === 'PASS').length}/${results.length}`)
console.log(`报告: ${path.join(here, 'l5-results.json')}`)
console.log(`截图: ${assetsDir}`)
