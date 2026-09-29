/**
 * lib.mjs — manual-docs-verify 共享库(只读测试,不改产品代码/文档)。
 * 提供: SSE 消费、证据 HTML 渲染+截图、管理面/平台 API 封装、DB 查询(docker psql)。
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ASSETS = path.join(here, 'assets')
export const SERVER = 'http://localhost:18090'
export const GATEWAY = 'http://localhost:18081'
export const DEMO_FRONT = 'http://localhost:9203'
export const DEMO_BACK = 'http://localhost:9300'
export const ECHO_MCP = 'http://localhost:9401'
export const ADMIN_KEY = 'test-key'
export const DEMO_USER = '12993'
export const OTHER_USER = '12994' // 仅用于越权读取断言(不产生数据)

fs.mkdirSync(ASSETS, { recursive: true })

// ---------------- DB ----------------
import { execFileSync } from 'node:child_process'
export function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'inneragent-postgres', 'psql', '-U', 'inneragent', '-d', 'inneragent', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim()
}

// ---------------- HTTP ----------------
export async function api(method, url, { headers = {}, body, timeoutMs = 30000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, headers: Object.fromEntries(res.headers), text, json }
  } finally { clearTimeout(timer) }
}

export function adminHeaders(extra = {}) { return { 'X-IA-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json', ...extra } }
export function demoHeaders(user = DEMO_USER, extra = {}) { return { 'X-IA-Demo-User': String(user), 'Content-Type': 'application/json', ...extra } }

// ---------------- SSE ----------------
/**
 * 消费 POST /runs(或 GET /runs/{id}/events)的 SSE 流。
 * opts.deadlineMs 总时限;opts.stopWhen(ev) 返回 true 即断开;opts.maxEvents 限帧。
 * 返回 { httpStatus, contentType, events: [{t, id, event, data, comment}], closedByServer, aborted }
 */
export async function consumeSSE(url, { method = 'POST', headers, body, deadlineMs = 120000, stopWhen, maxEvents = 500, breakAfterEventMs, onEvent } = {}) {
  const ac = new AbortController()
  const events = []
  let httpStatus = 0, contentType = '', closedByServer = false, aborted = false
  const timer = setTimeout(() => { aborted = true; ac.abort() }, deadlineMs)
  const t0 = Date.now()
  let lastEventAt = t0
  try {
    const res = await fetch(url, { method, signal: ac.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined })
    httpStatus = res.status
    contentType = res.headers.get('content-type') || ''
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { closedByServer = true; break }
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2)
        if (!raw.trim()) continue
        const ev = { t: Date.now() - t0 }
        if (raw.startsWith(':') || raw.startsWith(' :')) { ev.comment = raw; events.push(ev); lastEventAt = Date.now(); continue }
        for (const line of raw.split('\n')) {
          if (line.startsWith('id:')) ev.id = line.slice(3).trim()
          else if (line.startsWith('event:')) ev.event = line.slice(6).trim()
          else if (line.startsWith('data:')) { try { ev.data = JSON.parse(line.slice(5).trim()) } catch { ev.dataRaw = line.slice(5).trim() } }
        }
        events.push(ev); lastEventAt = Date.now()
        if (onEvent) {
          try { const ctrl = await onEvent(ev); if (ctrl === 'stop') { aborted = true; ac.abort(); return finish() } } catch { /* 钩子异常不中断流 */ }
        }
        if (stopWhen && stopWhen(ev)) { aborted = true; ac.abort(); return finish() }
        if (events.length >= maxEvents) { aborted = true; ac.abort(); return finish() }
        if (breakAfterEventMs !== undefined && Date.now() - lastEventAt >= breakAfterEventMs) { aborted = true; ac.abort(); return finish() }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e
  } finally { clearTimeout(timer) }
  return finish()
  function finish() { clearTimeout(timer); return { httpStatus, contentType, events, closedByServer, aborted } }
}

export function parseId(ev) {
  if (!ev?.id) return null
  const m = /^(.+):(\d+)$/.exec(ev.id)
  return m ? { runId: m[1], seq: Number(m[2]) } : null
}

/** embed 身份(9300 演示登录 → embed token;filler-02907 预置映射 userId=12993)。 */
let embedCache = null
export async function embedAuth() {
  if (embedCache) return embedCache
  const login = await api('POST', `${DEMO_BACK}/api/demo/login`, { headers: { 'Content-Type': 'application/json' }, body: { username: 'filler-02907' }, timeoutMs: 10000 })
  assert(login.json?.data?.token, 'demo 登录失败: ' + JSON.stringify(login.json).slice(0, 120))
  const tok = await api('GET', `${DEMO_BACK}/api/ia/embed-token`, { headers: { Authorization: `Bearer ${login.json.data.token}` }, timeoutMs: 10000 })
  assert(tok.json?.data?.token, 'embed token 签发失败: ' + JSON.stringify(tok.json).slice(0, 120))
  embedCache = { Authorization: `Bearer ${tok.json.data.token}` }
  return embedCache
}

/** 发起一次运行。payload.__auth='embed' 走 embed token(app 34 场景代理);默认演示头(app 1)。 */
export async function startRun(payload, opts = {}) {
  const headers = payload.__auth === 'embed' ? await embedAuth() : demoHeaders(payload.__user || DEMO_USER)
  return consumeSSE(`${SERVER}/ia/api/v1/runs`, {
    headers,
    body: (({ __user, __auth, ...rest }) => rest)(payload),
    ...opts,
  })
}

// ---------------- 运行收口(不留挂起) ----------------
export async function settleRun(runId, replyId) {
  // 先尝试 confirm/expire(幂等),失败再 cancel
  if (replyId) {
    const r = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm/expire`, {
      headers: demoHeaders(), body: { replyId },
    })
    if (r.status === 200) return { via: 'expire', res: r }
  }
  const c = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/cancel`, { headers: demoHeaders(), body: {} })
  return { via: 'cancel', res: c }
}

// ---------------- 证据渲染 ----------------
let browser
export async function getBrowser() {
  if (!browser) browser = await chromium.launch()
  return browser
}
export async function closeBrowser() { if (browser) { await browser.close(); browser = undefined } }

/** esc */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

/**
 * 渲染证据 HTML 页(请求/响应关键 JSON、断言结果)并截图。
 * caseId 形如 QS1-2;title 中文说明;sections: [{h, kind: 'json'|'text'|'table'|'verdict', body}]
 * verdict: {label, ok, detail}
 */
export async function evidenceShot(caseId, title, sections, { pass, fullPage = true } = {}) {
  const parts = []
  parts.push(`<h1>${esc(caseId)} <span class="title">${esc(title)}</span></h1>`)
  parts.push(`<div class="meta">InnerAgent 手册回归 · ${new Date().toISOString()} · server ${SERVER}</div>`)
  if (pass !== undefined) {
    parts.push(`<div class="verdict ${pass ? 'ok' : 'bad'}">${pass ? 'PASS' : 'FAIL'}</div>`)
  }
  for (const s of sections) {
    parts.push(`<h2>${esc(s.h || '')}</h2>`)
    if (s.verdicts) {
      parts.push('<table class="v"><tr><th>断言</th><th>结果</th><th>实测/说明</th></tr>')
      for (const v of s.verdicts) {
        parts.push(`<tr><td>${esc(v.label)}</td><td class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'PASS' : 'FAIL'}</td><td class="mono small">${esc(v.detail ?? '')}</td></tr>`)
      }
      parts.push('</table>')
    }
    if (s.body !== undefined) {
      const cls = s.kind === 'json' ? 'mono json' : s.kind === 'table' ? '' : 'mono'
      parts.push(`<pre class="${cls}">${esc(typeof s.body === 'string' ? s.body : JSON.stringify(s.body, null, 2))}</pre>`)
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font:13px/1.5 -apple-system,'PingFang SC','Helvetica Neue',sans-serif;margin:24px;max-width:1180px;color:#1a1a1a}
    h1{font-size:20px;border-bottom:2px solid #2563eb;padding-bottom:8px}
    h1 .title{font-size:15px;color:#555;font-weight:normal;margin-left:10px}
    h2{font-size:14px;margin:18px 0 6px;color:#2563eb}
    .meta{color:#888;font-size:12px;margin:6px 0 2px}
    .verdict{display:inline-block;margin-top:8px;padding:3px 14px;border-radius:4px;font-weight:700;color:#fff}
    .verdict.ok{background:#16a34a}.verdict.bad{background:#dc2626}
    pre{background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:10px;overflow:auto;max-height:420px;font-size:11.5px}
    pre.json{background:#0d1117;color:#c9d1d9;border-color:#0d1117}
    table.v{border-collapse:collapse;width:100%;margin:4px 0}
    table.v td,table.v th{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}
    table.v th{background:#f6f8fa}
    td.ok{color:#16a34a;font-weight:700}td.bad{color:#dc2626;font-weight:700}
    .mono{font-family:ui-monospace,Menlo,monospace}.small{font-size:11px}
  </style>` + parts.join('\n')
  const htmlFile = path.join(ASSETS, `${caseId}.html`)
  fs.writeFileSync(htmlFile, html)
  const b = await getBrowser()
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto('file://' + htmlFile)
  await page.waitForTimeout(250)
  const png = path.join(ASSETS, `${caseId}${pass === false ? '-fail' : ''}.png`)
  await page.screenshot({ path: png, fullPage })
  await page.close()
  return path.relative(here, png)
}

// ---------------- 用例登记 ----------------
export const results = []
let savedUpTo = 0
export function savePhase(name) {
  const slice = results.slice(savedUpTo)
  savedUpTo = results.length
  const dir = path.join(here, 'state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(slice, null, 2))
}
export async function runCase(id, doc, title, fn) {
  const entry = { id, doc, title, status: 'PASS', notes: [], evidence: [] }
  const t0 = Date.now()
  try {
    await fn(entry)
    if (!entry.evidence.length) entry.notes.push('警告: 无证据文件')
  } catch (e) {
    entry.status = 'FAIL'
    entry.notes.push(`异常: ${String(e && e.message || e).slice(0, 500)}`)
    // 失败兜底证据: 尽力渲染一张证据页 + dump
    try {
      const dump = `case ${id} ${title}\nerror: ${String(e && e.stack || e).slice(0, 2000)}\nnotes: ${entry.notes.join(' | ')}`
      fs.writeFileSync(path.join(ASSETS, `${id}-fail-dump.txt`), dump)
      entry.evidence.push(await evidenceShot(`${id}-fail`, `${title}(失败)`, [
        { h: '错误', body: dump }, ...(entry._sections || []),
      ], { pass: false }))
    } catch { /* ignore */ }
  }
  entry.ms = Date.now() - t0
  results.push(entry)
  console.log(`[${entry.status}] ${id} (${doc}) ${title} (${(entry.ms / 1000).toFixed(1)}s)${entry.notes.length ? ' | ' + entry.notes.join(' | ').slice(0, 220) : ''}`)
  return entry
}

export function assert(cond, msg) { if (!cond) throw new Error(msg) }
export function ok(v, label, detail) { return { label, ok: !!v, detail: detail === undefined ? '' : String(detail).slice(0, 300) } }
