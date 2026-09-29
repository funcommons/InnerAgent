// verify-ticket-ref.mjs — 工单 @ 引用(通用上下文引用)端到端验证。
// 前置:server 18090(真模型默认)+ demo 前端 9203 + demo 后端 9300;EmbedChat 已接线
// registerTicketReferences;ticket-assistant 提示词已含 {ticketId} 指引(已重导入)。
// 产物:e2e/manual-docs-verify/assets/TR-*.png + stdout 结论。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(here, 'assets')
const BASE = 'http://localhost:9203'
const BACK = 'http://localhost:9300'

const browser = await chromium.launch()
const wire = []
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const shot = (name) => page.screenshot({ path: path.join(ASSETS, name), fullPage: false })
const step = (msg) => console.log(`[TR] ${msg}`)

try {
  // 1. 轻登录(真实 UI 流)
  await page.goto(`${BASE}/login`)
  await page.getByRole('textbox', { name: /演示账号/ }).fill('ticketref-01')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/ia/overview', { timeout: 15000 })
  step('登录 OK')

  // 2. 造一张目标工单(经登录态 token 走宿主 REST)
  const token = await page.evaluate(() => localStorage.getItem('acme-demo:access_token'))
  const created = await fetch(`${BACK}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: '打印机坏了', description: '3楼打印机卡纸,无法出纸', priority: 'high' }),
  }).then((r) => r.json())
  const ticketId = created?.data?.ticketId
  if (!ticketId) throw new Error('建单失败: ' + JSON.stringify(created).slice(0, 160))
  step(`目标工单 ticketId=${ticketId}`)

  // 3. 进嵌入页并挂载 WC(挂载前清 SDK 会话缓存 = 全新会话,沿用回归口径)
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^(inneragent|fusion)-assistant/.test(key)) localStorage.removeItem(key)
    }
  })
  await page.goto(`${BASE}/ia/embed?agentType=ticket-assistant`)
  await page.waitForSelector('[data-testid="embed-agent-type-current"]', { timeout: 10000 })
  const chat = page.locator('[data-testid="ia-chat"]')
  if (!(await chat.isVisible().catch(() => false))) {
    await page.locator('[data-testid="embed-mount"]').click()
  }
  await chat.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(2500) // registerTicketReferences 拉工单 + 组件就绪
  step('WC 挂载 OK')

  // 4. @ 触发引用弹层,断言工单候选出现
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.click()
  await input.pressSequentially('@', { delay: 60 })
  const candidate = page.locator('[data-testid="ia-chat"]').getByText('打印机坏了', { exact: false }).first()
  await candidate.waitFor({ state: 'visible', timeout: 8000 })
  await shot('TR-1-picker-ticket-candidate.png')
  step('@ 弹层出现工单候选 ✓')

  // 5. 点选候选(实体选择语义:确权项目上下文;实体本身经页面注册随 autoReferences 上行)
  await candidate.click()
  await page.keyboard.press('Escape')

  page.on('response', async (r) => {
    if (r.url().includes('/ia/api/v1/runs')) {
      let body = ''
      try { body = (await r.text()).slice(0, 300) } catch {}
      wire.push({ status: r.status(), body })
      console.log(`[TR][wire] POST /runs → ${r.status()} ${body.replace(/\n/g, ' ')}`)
    }
  })
  // 6. 发送引用性提问,等模型(真实 MiniMax + list_tickets)回答
  await input.fill('这张工单现在什么状态？用一句话给结论')
  page.on('request', (r) => {
    if (r.url().includes('/ia/api/v1/runs') && r.method() === 'POST') {
      console.log('[TR][wire] 请求体:', (r.postData() || '').slice(0, 500))
    }
  })
  await page.locator('[data-testid="ia-chat"] button', { hasText: '发送' }).click()
  const main = page.locator('[data-testid="ia-chat"] .assistant-window__main')
  await main.waitFor({ state: 'visible', timeout: 10000 })
  let last = await main.innerText()
  let stable = 0
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500)
    const now = await main.innerText()
    if (now.length === last.length) { stable += 1; if (stable >= 2) break } else stable = 0
    last = now
  }
  const reply = last
  await shot('TR-2-reply-references-ticket.png')

  // 7. 断言:回复确实围绕该工单(标题或状态语义)
  const hit = /打印机/.test(reply) && /(open|处理中|已|状态|high|高)/i.test(reply)
  console.log('[TR] 回复节选:', reply.replace(/\n{2,}/g, '\n').slice(-400))
  if (!hit) throw new Error('回复未体现对目标工单的引用')
  console.log(`[TR] PASS — @ 候选可见、引用上行、回复围绕 ticketId=${ticketId}`)
  console.log('PASS')
} catch (error) {
  await shot('TR-FAIL.png').catch(() => {})
  console.error('[TR] FAIL:', String(error).slice(0, 500))
  console.log('FAIL')
} finally {
  await browser.close()
}
