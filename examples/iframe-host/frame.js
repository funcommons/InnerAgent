/**
 * [new] 被嵌页引导 — mountIframeAgent (P4/W15)。
 *
 * iframe-child.js 是自包含产物 (vue/pinia/SDK/WC 全部内联, 无需 import map,
 * 严格 CSP script-src 'self' 可用)。mountIframeAgent 会:
 * 1. 与宿主握手 (hello→ready, origin allowlist + nonce/ack);
 * 2. 用宿主下发的 appKey/agentType 初始化 SDK; token 经消息桥注入
 *    (tokenGetter 桥接实现, 401 时自动跨桥重取);
 * 3. 挂载 <inneragent-chat view="chat"> 并向宿主外发状态/终态事件。
 */

async function bootstrap() {
  const { mountIframeAgent } = await import(
    '../../sdk-js/packages/iframe/dist/iframe-child.js'
  )

  // allowedParentOrigins: 允许嵌入本页的宿主来源 allowlist (生产按部署域配置;
  // 缺省同源)。本演示宿主页与被嵌页同源 (同一 vite dev 服务)。
  mountIframeAgent({
    allowedParentOrigins: [window.location.origin],
    target: document.getElementById('ia-target'),
  })
}

bootstrap().catch((error) => {
  console.error('[demo-iframe-frame] 引导失败:', error)
})
