/**
 * [new] iframe 宿主接入演示 — createIframeEmbed (P4/W15)。
 *
 * 契约要点:
 * - tokenGetter 是 token 通道唯一来源: SDK 在 child 首次请求与 401 失效时
 *   经消息桥调用它; 本演示恒返回 null (联调依赖服务端匿名演示头
 *   X-IA-Demo-User, 见 demo-host 说明)。生产接入替换为宿主签发回调,
 *   例如: async () => fetch('/host/embed-token', { credentials: 'include' })
 *     .then(r => r.text())
 * - src 只给页面地址 (frame.html); **绝不**把 token 拼进 URL —— SDK 对
 *   token 形 query 参数直接抛错。
 */

function log(message) {
  const box = document.getElementById('log')
  const line = document.createElement('div')
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
  box.prepend(line)
}

async function bootstrap() {
  const { createIframeEmbed } = await import(
    '../../sdk-js/packages/iframe/dist/iframe-host.js'
  )

  const embed = createIframeEmbed({
    // iframe 指向同源被嵌页; 真实部署可为独立域 (服务端需配 CORS, 见差距清单)
    src: './frame.html',
    appKey: 'demo-iframe-host',
    agentType: 'demo',
    tokenGetter: async () => null, // 本地联调: 服务端匿名演示头兜底
    container: document.getElementById('ia-frame').parentElement,
    iframeAttrs: {
      id: 'ia-frame',
      allow: 'clipboard-write',
      // 生产建议: sandbox="allow-scripts allow-same-origin allow-forms"
      // (child 为第一方 SDK 代码; 同源服务时 allow-same-origin 必须, 否则
      //  同源 /ia 反代与 localStorage 均不可用)
    },
    onEvent: (event) => {
      log(`${event.kind}${event.status ? `:${event.status}` : ''}${event.message ? `:${event.message}` : ''}${event.toolName ? `:${event.toolName}` : ''}`)
    },
  })

  embed.ready.then(() => {
    document.getElementById('handshake').textContent = '握手: 完成 (origin 校验通过)'
    log('握手完成; token 经消息桥下发')
  }).catch((error) => {
    document.getElementById('handshake').textContent = '握手: 失败'
    log(`握手失败: ${error.message}`)
  })

  document.getElementById('set-page').addEventListener('click', () => {
    embed.setPage({ name: 'home', title: '首页' })
    log('setPage({name:"home"}) 已发送')
  })
  document.getElementById('set-object').addEventListener('click', () => {
    embed.setObject({ type: 'script', id: 7 })
    log('setObject({type:"script",id:7}) 已发送')
  })
  document.getElementById('clear-context').addEventListener('click', () => {
    embed.clearContext()
    log('clearContext 已发送')
  })
  document.getElementById('refresh-token').addEventListener('click', () => {
    embed.refreshToken().then(() => log('refreshToken: 新 token 已推送 (演示恒 null)'))
  })

  window.addEventListener('beforeunload', () => embed.destroy())
}

bootstrap().catch((error) => {
  console.error('[demo-iframe-host] 启动失败:', error)
  log(`启动失败: ${error.message} — 请先在 sdk-js/ 下执行 \`pnpm build\``)
})
