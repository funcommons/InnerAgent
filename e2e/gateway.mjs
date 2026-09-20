#!/usr/bin/env node
/**
 * e2e/gateway.mjs — 管理站「真服务模式」网关(测试基建,非产品代码)。
 *
 * 背景:web/ 的 vite dev 模式挂 msw mock(web/src/main.ts 仅 import.meta.env.DEV
 * 分支启用 worker),测真实集成必须绕开。做法:
 *   1. cd web && pnpm build → dist(生产构建不含 msw 分支);
 *   2. 本进程以 node http 静态服务 web/dist(18081,SPA history 路由回退 index.html);
 *   3. /ia/* 反向代理到 InnerAgent 主服务 18090(同源,无 CORS 问题)。
 *
 * 不改 vite.config.ts、不改任何产品代码。用法:node e2e/gateway.mjs
 */
import http from 'node:http'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const PORT = Number(process.env.GATEWAY_PORT || 18081)
const SERVER_ORIGIN = process.env.IA_SERVER_ORIGIN || 'http://localhost:18090'
const DIST = process.env.WEB_DIST || join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function sendFile(res, filePath) {
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ---- /ia/* 反代到主服务 18090(保留方法/头/体;流式 SSE 也走这里) ----
  if (url.pathname === '/ia' || url.pathname.startsWith('/ia/')) {
    const proxied = http.request(
      `${SERVER_ORIGIN}${url.pathname}${url.search}`,
      { method: req.method, headers: { ...req.headers, host: 'localhost:18090' } },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers)
        up.pipe(res)
      },
    )
    proxied.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json;charset=UTF-8' })
      res.end(JSON.stringify({ code: 502, msg: `upstream unavailable: ${err.message}`, data: null }))
    })
    req.pipe(proxied)
    return
  }

  // ---- 静态文件 + SPA history 回退 ----
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(DIST, safePath)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath)
    return
  }
  // SPA 回退(无扩展名的路径一律回 index.html,由 vue-router 接管)
  const indexFile = join(DIST, 'index.html')
  if (existsSync(indexFile)) {
    sendFile(res, indexFile)
    return
  }
  res.writeHead(404)
  res.end('not found: build web/dist first (cd web && pnpm build)')
})

server.listen(PORT, () => {
  console.log(`[gateway] web dist: ${DIST}`)
  console.log(`[gateway] upstream: ${SERVER_ORIGIN}`)
  console.log(`[gateway] listening http://localhost:${PORT}`)
})
