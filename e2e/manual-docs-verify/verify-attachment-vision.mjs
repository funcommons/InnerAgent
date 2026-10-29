// verify-attachment-vision.mjs — 图片附件→base64 内联上行→SSE DONE 闭环验证。
// 前置:demo 前端 9203 + demo 后端 9300 + server 18090;WC 附件 UI(assistant-attachment-*)已接线。
// 修复点:附件传输形态为 data/base64(不再以 /attachments/{id} 相对 url 上行,此前必 400)。
// 产物:e2e/manual-docs-verify/assets/AV-*.png + stdout 结论(末行 PASS/FAIL;前置不可达 SKIP+exit 2)。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(here, 'assets')
const BASE = 'http://localhost:9203'
const BACK = 'http://localhost:9300'
const SERVER = 'http://localhost:18090'

async function reachable(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4000)
  try { await fetch(url, { signal: ac.signal }); return true } catch { return false } finally { clearTimeout(timer) }
}
for (const [name, url] of [['demo 前端 9203', BASE], ['demo 后端 9300', BACK], ['server 18090', SERVER]]) {
  if (!(await reachable(url))) {
    console.log(`[AV] SKIP — ${name}(${url})不可达,本脚本不判 FAIL`)
    process.exit(2)
  }
}

// ---- 程序化生成测试 PNG(LCG 噪声像素,难压缩,≥20KB;不依赖网络)----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function buildPng(dim) {
  const stride = dim * 4 + 1
  const raw = Buffer.alloc(stride * dim)
  let s = 0x9e3779b9
  for (let y = 0; y < dim; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < dim; x++) {
      s = (s * 1664525 + 1013904223) >>> 0
      const o = y * stride + 1 + x * 4
      raw[o] = s >>> 24; raw[o + 1] = s >>> 16; raw[o + 2] = s >>> 8; raw[o + 3] = 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(dim, 0); ihdr.writeUInt32BE(dim, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}
let dim = 160, png
do { png = buildPng(dim); dim *= 2 } while (png.length < 20 * 1024 && dim <= 1280)
const pngPath = path.join(os.tmpdir(), `av-e2e-${Date.now()}.png`)
fs.writeFileSync(pngPath, png)
fs.mkdirSync(ASSETS, { recursive: true })

const browser = await chromium.launch()
const runsPosts = []   // {url, body}
const runsStatuses = []
const httpErrors = []  // {status, url}
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const shot = (name) => page.screenshot({ path: path.join(ASSETS, name), fullPage: false })
const step = (msg) => console.log(`[AV] ${msg}`)

try {
  // 1. 轻登录(真实 UI 流,沿用 verify-ticket-ref 口径)
  await page.goto(`${BASE}/login`)
  await page.getByRole('textbox', { name: /演示账号/ }).fill('attach-e2e-01')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/ia/overview', { timeout: 15000 })
  step('登录 OK')

  // 2. 进嵌入页挂载 WC(挂载前清 SDK 会话缓存 = 全新会话)
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

  // 3. wire 捕获(上传起即全程记录:POST /runs 请求体/状态 + 任意 HTTP≥400)
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/ia/api/v1/runs')) {
      runsPosts.push({ url: r.url(), body: r.postData() || '' })
    }
  })
  page.on('response', (r) => {
    if (r.url().includes('/ia/api/v1/runs')) {
      runsStatuses.push(r.status())
      console.log(`[AV][wire] POST /runs → ${r.status()}`)
    }
    if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url().replace(BASE, '').slice(0, 160) })
  })

  // 4. UI 默认路径上传图片(隐藏 input 直接 setInputFiles)
  const fileInput = page.locator('[data-testid="ia-chat"] input[data-testid="assistant-attachment-input"]')
  await fileInput.setInputFiles(pngPath)
  const attachWrap = page.locator('[data-testid="ia-chat"] [data-testid="assistant-attachments"]')
  await attachWrap.waitFor({ state: 'visible', timeout: 20000 })
  const chip = attachWrap.locator('[data-testid^="assistant-attachment-"]').first()
  await chip.waitFor({ state: 'visible', timeout: 10000 })
  step(`附件 chip 出现 ✓(png ${(png.length / 1024).toFixed(1)}KB)`)
  await shot('AV-1-chip.png')

  // 5. 携附件发送,等 SSE 流稳定收敛(= DONE,沿用 stability 轮询口径)
  const input = page.locator('[data-testid="ia-chat"] textarea')
  await input.fill('这张截图里是什么？一句话')
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
  await shot('AV-2-reply.png')

  // 6. 断言:POST /runs=200;multimodalInputs 以 data/base64 上行(无 /attachments/ 相对 url 残留)
  if (!runsStatuses.includes(200)) throw new Error(`POST /runs 状态非 200: ${JSON.stringify(runsStatuses)}`)
  const posts = runsPosts.map((p) => { try { return JSON.parse(p.body) } catch { return null } }).filter(Boolean)
  const withInputs = posts.find((b) => Array.isArray(b.multimodalInputs) && b.multimodalInputs.length > 0)
  if (!withInputs) throw new Error('POST /runs 请求体未携带 multimodalInputs')
  const bad = withInputs.multimodalInputs.filter((m) =>
    m.transport !== 'base64' || typeof m.data !== 'string' || m.data.length < 100
    || /\/attachments\//.test(String(m.url ?? '')))
  if (bad.length) {
    throw new Error('multimodalInputs 非 data/base64 传输: ' + JSON.stringify(
      bad.map(({ transport, url, data }) => ({ transport, url, dataLen: String(data ?? '').length }))).slice(0, 220))
  }
  step(`multimodalInputs=${withInputs.multimodalInputs.length} 条全为 base64(data ${(withInputs.multimodalInputs[0].data.length / 1024).toFixed(1)}KB)✓`)

  // 7. 断言:SSE 收敛到回复;全程无 4xx/5xx
  if (reply.trim().length < 10) throw new Error(`回复过短(${reply.trim().length} 字符),SSE 疑似未达 DONE`)
  console.log('[AV] 回复节选:', reply.replace(/\n{2,}/g, '\n').slice(-400))
  if (httpErrors.length) throw new Error('全程出现 HTTP≥400: ' + JSON.stringify(httpErrors).slice(0, 300))

  console.log('[AV] PASS — chip 可见、POST /runs=200、multimodalInputs 全 base64 上行、SSE 稳定收敛、全程无 4xx/5xx')
  console.log('PASS')
} catch (error) {
  await shot('AV-FAIL.png').catch(() => {})
  console.error('[AV] FAIL:', String(error).slice(0, 500))
  console.log('FAIL')
  process.exitCode = 1 // CI 按 exit code 判 FAIL;用 exitCode 让 finally 清理照常执行
} finally {
  fs.rmSync(pngPath, { force: true })
  await browser.close()
}
