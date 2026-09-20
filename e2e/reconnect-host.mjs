#!/usr/bin/env node
/**
 * e2e/reconnect-host.mjs — L8 断流重连线专用「可断中转」(测试基建,非产品代码)。
 *
 * 职责(三合一, 同源 18085 免 CORS):
 *   1. 静态托管 e2e/sdk-reconnect-page.html(SDK WC 宿主测试页)+ /sdk/* 直接服务
 *      sdk-js/packages/components/dist 产物(只读引用, 不改产品代码);
 *   2. /ia/* 反向代理 18090(与 e2e/gateway.mjs 同款透传, 支持 SSE chunked 流式);
 *   3. 断流开关:POST /__break?seconds=N → 立刻销毁当前全部活动 socket, 并在 N 秒内
 *      拒绝新连接(SO 直接 destroy), 到期自动恢复 —— 模拟「网关中途断流」。
 *      GET /__state 观测状态; 全部事件写入日志供报告取证。
 *
 * 断流语义与判据:SDK 流式请求收到连接重置 → 走 onError → 自动重连
 * (GET /runs/{id}/events + Last-Event-ID)→ 续流至终态。日志逐行记录:
 *   [open]   新连接(方法 路径)
 *   [reconn] SSE /events 请求携带的 Last-Event-ID(重连游标证据)
 *   [cut]    断流时被销毁的活动 socket
 *   [break]  断流窗口开启/关闭
 * 用法:node e2e/reconnect-host.mjs(端口 IA_RECONNECT_PORT,默认 18085)
 */
import http from 'node:http'
import { existsSync, createReadStream, statSync, appendFileSync, readFileSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.IA_RECONNECT_PORT || 18085)
const SERVER_ORIGIN = process.env.IA_SERVER_ORIGIN || 'http://localhost:18090'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'sdk-js', 'packages', 'components', 'dist')
const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'sdk-reconnect-page.html')
const LOG = process.env.IA_RECONNECT_LOG || '/tmp/ia-e2e-logs/reconnect-host.log'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
}

function log(line) {
  const text = `${new Date().toISOString()} ${line}`
  console.log(text)
  try { appendFileSync(LOG, `${text}\n`) } catch { /* 尽力而为 */ }
}

// ---- 断流状态 ----
let breakUntil = 0 // 0 = 未断流; 否则该时间戳(epoch ms)前拒绝/销毁新连接
let breakAllowRunning = false
const liveSockets = new Set()

function breaking() {
  return Date.now() < breakUntil
}

function cutAll(reason, exclude) {
  for (const socket of [...liveSockets]) {
    if (socket === exclude) continue
    try {
      log(`[cut] destroy socket ${socket.remoteAddress}:${socket.remotePort} (${reason})`)
      socket.destroy()
    } catch { /* 已断 */ }
  }
}

function forwardRequest(pathname, url, req, res, started, headers, body) {
  const proxied = http.request(
    `${SERVER_ORIGIN}${pathname}${url.search}`,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
      up.on('end', () => log(`[done] ${req.method} ${pathname} (${Date.now() - started}ms)`))
    },
  )
  proxied.on('error', (err) => {
    log(`[uperr] ${req.method} ${pathname} ${err.message}`)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json;charset=UTF-8' })
    }
    try { res.end(JSON.stringify({ code: 502, msg: `upstream unavailable: ${err.message}`, data: null })) } catch { /* socket gone */ }
  })
  if (body != null) proxied.write(body)
  else req.pipe(proxied)
  req.on('error', () => {})
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ---- 断流窗口: 请求直接销毁(不回 5xx, 模拟物理断链);allow=running 白名单
  //      放行 GET /runs/running(元信息面仍在 → DEF-06「断流期间运行完成」确定性取证) ----
  if (breaking()) {
    const allowRunning = breakAllowRunning
    const isRunningProbe = req.method === 'GET' && url.pathname === '/runs/running'
    if (!(allowRunning && isRunningProbe)) {
      log(`[drop] ${req.method} ${req.url} (断流窗口内, 连接直接销毁)`)
      res.socket?.destroy()
      return
    }
    log(`[pass] ${req.method} ${req.url} (断流白名单放行)`)
  }

  // ---- 断流控制面 ----
  if (url.pathname === '/__break') {
    const seconds = Math.min(Number(url.searchParams.get('seconds') || 5), 30)
    const controlSocket = req.socket // 断流控制连接自身不销毁(否则应答送不回去)
    breakAllowRunning = url.searchParams.get('allow') === 'running'
    breakUntil = Date.now() + seconds * 1000
    cutAll(`break ${seconds}s`, controlSocket)
    log(`[break] 断流窗口开启 ${seconds}s(活动 socket 已全部销毁)`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ breaking: true, seconds, resumeAt: new Date(breakUntil).toISOString() }))
    return
  }
  if (url.pathname === '/__state') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      breaking: breaking(),
      resumeInMs: Math.max(0, breakUntil - Date.now()),
      liveSockets: liveSockets.size,
    }))
    return
  }

  // ---- SDK 补偿层: baseURL='' 形态下 SDK http 层请求的裸路径重写 ----
  // 背景(DEF-05 取证): SDK http.* 调用点自带 `${getBaseURL()}${path}`, 与
  // request() 内部再次拼接 baseURL → 默认 '/ia/api/v1' 下双重前缀 404。
  // 本中转允许页面以 baseURL='' 接入(裸路径 /me /conversations /attachments /runs),
  // 在网关层重写到真实 API 根, 使功能线可测; 缺陷本体仍按 DEF-05 记录修复。
  const SDK_BARE_PREFIX = /^\/(me|conversations|attachments|runs)(\/|$|\?)/
  let pathname = url.pathname
  if (SDK_BARE_PREFIX.test(pathname)) {
    const rewritten = `/ia/api/v1${pathname}${url.search}`
    log(`[rewrite] ${req.method} ${pathname}${url.search} → ${rewritten}`)
    pathname = `/ia/api/v1${pathname}`
  }

  // ---- /ia/* 反代 18090(保留方法/头/体; SSE 流式透传) ----
  if (url.pathname === '/ia' || url.pathname.startsWith('/ia/') || pathname.startsWith('/ia/')) {
    const started = Date.now()
    log(`[open] ${req.method} ${pathname}${url.search}`
      + (req.headers['last-event-id'] ? ` Last-Event-ID=${req.headers['last-event-id']}` : ''))
    if (pathname.endsWith('/events') && req.headers['last-event-id']) {
      log(`[reconn] SSE 重连游标 Last-Event-ID=${req.headers['last-event-id']}`)
    }
    // DEF-07 补偿已移除: 服务端已把 enabledMcpTools 空数组视作「未指定」
    // (默认可见性, 注册目录按策略), SDK 空引用下发 [] 不再屏蔽注册工具。
    // 本中转恢复纯透传, /runs 请求体原样转发 —— 即 R2 的无补偿回归口径。
    forwardRequest(pathname, url, req, res, started, { ...req.headers, host: 'localhost:18090' }, null)
    return
  }

  // ---- 静态: /sdk/* → sdk-js dist 产物; /vendor/* → 裸名模块映射; / → WC 宿主测试页 ----
  let filePath = null
  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = PAGE
  } else if (url.pathname.startsWith('/sdk/')) {
    filePath = join(DIST, normalize(url.pathname.slice('/sdk/'.length)).replace(/^(\.\.[/\\])+/, ''))
    if (!filePath.startsWith(DIST)) filePath = null
  } else if (url.pathname === '/vendor/vue.esm-browser.js') {
    filePath = join(REPO, 'sdk-js', 'node_modules', 'vue', 'dist', 'vue.esm-browser.js')
  } else if (url.pathname === '/vendor/pinia.esm-browser.js') {
    filePath = join(REPO, 'sdk-js', 'node_modules', 'pinia', 'dist', 'pinia.esm-browser.js')
  } else if (url.pathname === '/vendor/devtools-api-stub.js') {
    filePath = join(REPO, 'e2e', 'vendor', 'devtools-api-stub.js')
  }
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
    createReadStream(filePath).pipe(res)
    return
  }
  res.writeHead(404)
  res.end('not found')
})

// 追踪活动 socket(断流时统一销毁; 服务端 socket 不追)
server.on('connection', (socket) => {
  liveSockets.add(socket)
  socket.on('close', () => liveSockets.delete(socket))
  socket.on('error', () => liveSockets.delete(socket))
})

server.listen(PORT, () => {
  log(`[boot] reconnect-host listening http://localhost:${PORT} (upstream ${SERVER_ORIGIN})`)
  log(`[boot] page=${PAGE}`)
  log(`[boot] sdk dist=${DIST} exists=${existsSync(join(DIST, 'inneragent-chat.js'))}`)
})
