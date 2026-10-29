// verify-kb-citations.mjs — KB 命中→回复下方「引用资料」折叠区→展开可见文档标题/锚点 闭环验证。
// 前置:demo 前端 9203 + demo 后端 9300 + server 18090;demo 库已有 provision.sh 播种的 3 篇 KB 文档。
// 语义:平台按用户消息检索 appId 域内 active 文档(topK=4),命中才注入并在 DONE 事件带 kbCitations;
//       引用仅 live 会话可见(挂载前清会话缓存)。mock 模型话术固定 → 只断言引用区,不断言回复内容。
// 产物:e2e/manual-docs-verify/assets/KB-*.png + stdout 结论(末行 PASS/FAIL;前置不满足 SKIP+exit 2)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(here, 'assets')
const BASE = 'http://localhost:9203'
const BACK = 'http://localhost:9300'
const SERVER = 'http://localhost:18090'
const ADMIN_KEY = 'test-key'
// 命中查询:「G3 Pro」「开锁方式」为种子文档 ACME产品FAQ.md 独有名词(provision.sh 播种),必然命中。
const QUERY = 'ACME G3 Pro 智能门锁支持哪些开锁方式?'
const TITLE_FRAGMENT = 'ACME产品FAQ'

async function reachable(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4000)
  try { await fetch(url, { signal: ac.signal }); return true } catch { return false } finally { clearTimeout(timer) }
}
for (const [name, url] of [['demo 前端 9203', BASE], ['demo 后端 9300', BACK], ['server 18090', SERVER]]) {
  if (!(await reachable(url))) {
    console.log(`[KB] SKIP — ${name}(${url})不可达,本脚本不判 FAIL`)
    process.exit(2)
  }
}

// ---- 前置自检:解析 acme-demo appId(缺省 2),确认 ≥1 篇 active KB 文档,否则 SKIP(需先跑 provision.sh)----
let APP_ID = 2
let EXPECTED_TITLE = TITLE_FRAGMENT
try {
  const res = await fetch(`${SERVER}/ia/api/v1/admin/apps`, { headers: { 'X-IA-Admin-Key': ADMIN_KEY } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const app = ((await res.json())?.data ?? []).find((a) => a.appKey === 'acme-demo')
  if (app?.id) APP_ID = app.id
} catch (e) {
  console.log(`[KB] SKIP — admin 应用列表不可用(${String(e).slice(0, 120)}),无法确认 KB 前置`)
  process.exit(2)
}
try {
  const res = await fetch(`${SERVER}/ia/api/v1/admin/kb/documents?appId=${APP_ID}&pageNo=1&pageSize=100`, {
    headers: { 'X-IA-Admin-Key': ADMIN_KEY },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const activeDocs = ((await res.json())?.data?.list ?? []).filter((d) => d.status === 'active')
  if (!activeDocs.length) {
    console.log(`[KB] SKIP — appId=${APP_ID} 无 active KB 文档,请先跑 examples/acme-demo/seeds/provision.sh 播种`)
    process.exit(2)
  }
  EXPECTED_TITLE = activeDocs.map((d) => d.title).find((t) => t.includes(TITLE_FRAGMENT)) ?? TITLE_FRAGMENT
  console.log(`[KB] 前置 OK:appId=${APP_ID},active 文档 ${activeDocs.length} 篇(${activeDocs.map((d) => d.title).join(' / ')})`)
} catch (e) {
  console.log(`[KB] SKIP — admin KB 文档列表不可用(${String(e).slice(0, 120)})`)
  process.exit(2)
}
fs.mkdirSync(ASSETS, { recursive: true })

const browser = await chromium.launch()
const runsStatuses = []
const httpErrors = [] // {status, url}
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const shot = (name) => page.screenshot({ path: path.join(ASSETS, name), fullPage: false })
const step = (msg) => console.log(`[KB] ${msg}`)

try {
  // 1. 登录(真实 UI 流,沿用 verify-attachment-vision 口径)
  await page.goto(`${BASE}/login`)
  await page.getByRole('textbox', { name: /演示账号/ }).fill('kb-e2e-01')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/ia/overview', { timeout: 15000 })
  step('登录 OK')

  // 2. 进嵌入页挂载 WC(挂载前清 SDK 会话缓存 = 全新 live 会话;引用仅 live 会话可见)
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
  await page.waitForTimeout(2500)
  step('WC 挂载 OK')

  // 3. wire 捕获(发送起全程记录:POST /runs 状态 + 任意 HTTP≥400)
  page.on('response', (r) => {
    if (r.url().includes('/ia/api/v1/runs') && r.request().method() === 'POST') {
      runsStatuses.push(r.status())
      console.log(`[KB][wire] POST /runs → ${r.status()}`)
    }
    if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url().replace(BASE, '').slice(0, 160) })
  })

  // 4. 发送命中性查询,等 SSE 流稳定收敛(= DONE,沿用 stability 轮询口径)
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.fill(QUERY)
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
  if (last.trim().length < 10) throw new Error(`回复过短(${last.trim().length} 字符),SSE 疑似未达 DONE`)
  step('回复流稳定收敛(mock 话术,不作为断言对象)')

  // 5. 断言:引用区出现(默认折叠)→ 折叠头文案「引用资料 · N」→ 点击展开 → 列表可见标题/锚点
  const box = page.locator('[data-testid="ia-chat"] [data-testid="assistant-kb-citations"]')
  await box.waitFor({ state: 'visible', timeout: 15000 })
  const toggle = box.locator('[data-testid="assistant-kb-citations-toggle"]')
  const toggleText = (await toggle.innerText()).replace(/\s+/g, ' ').trim()
  if (!toggleText.includes('引用资料 ·')) throw new Error(`折叠头文案不含「引用资料 ·」: "${toggleText}"`)
  const cited = Number((toggleText.match(/引用资料 · (\d+)/) || [])[1])
  if (!(cited >= 1)) throw new Error(`折叠头计数异常(应「引用资料 · N」且 N≥1): "${toggleText}"`)
  if ((await toggle.getAttribute('aria-expanded')) !== 'false') throw new Error('初始应为折叠态(aria-expanded=false)')
  await shot('KB-1-collapsed.png')
  step(`引用区折叠态 OK:「${toggleText}」`)

  await toggle.click()
  await box.locator('[data-testid="assistant-kb-citations-list"]').waitFor({ state: 'visible', timeout: 5000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') throw new Error('展开后 aria-expanded 应为 true')
  const items = box.locator('[data-testid^="assistant-kb-citation-"]')
  const count = await items.count()
  if (count < 1) throw new Error('展开后引用列表项为 0')
  const firstText = (await items.first().innerText()).replace(/\s+/g, ' ').trim()
  if (!firstText.includes(EXPECTED_TITLE)) {
    throw new Error(`首条引用不含文档标题「${EXPECTED_TITLE}」: "${firstText.slice(0, 120)}"`)
  }
  await shot('KB-2-expanded.png')
  step(`展开态 OK:列表 ${count} 项,首条「${firstText.slice(0, 80)}」`)

  // 6. wire 断言:POST /runs=200;全程无 4xx/5xx
  if (!runsStatuses.includes(200)) throw new Error(`POST /runs 状态非 200: ${JSON.stringify(runsStatuses)}`)
  if (httpErrors.length) throw new Error('全程出现 HTTP≥400: ' + JSON.stringify(httpErrors).slice(0, 300))

  console.log('[KB] PASS — KB 命中注入、回复下方「引用资料」折叠区出现并展开、可见文档标题/锚点、POST /runs=200、全程无 4xx/5xx')
  console.log('PASS')
} catch (error) {
  await shot('KB-FAIL.png').catch(() => {})
  console.error('[KB] FAIL:', String(error).slice(0, 500))
  console.log('FAIL')
  process.exitCode = 1 // CI 按 exit code 判 FAIL;用 exitCode 让 finally 清理照常执行
} finally {
  await browser.close()
}
