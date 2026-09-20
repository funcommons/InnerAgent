/**
 * [new] demo-host 宿主接入脚本 — 演示 @inneragent/sdk 契约入口。
 *
 * init({ appKey, tokenGetter, mode? }):
 * - tokenGetter 返回 null: embed token 由宿主签发体系提供; 本地联调时
 *   inneragent-server local profile 开启"匿名演示头" (X-IA-Demo-User),
 *   服务端不校验 Authorization 也放行 (见 inneragent-server local 配置)。
 *   生产接入时替换为宿主真实回调, 例如:
 *     tokenGetter: async () => fetch('/host/embed-token', { credentials: 'include' })
 *       .then(r => r.text())
 * - 过期懒换: SDK 收到 401 时会**再次调用**本回调并重试一次;
 *   宿主回调应在 token 过期后重新签发 (这里恒 null, 由服务端匿名演示头兜底)。
 * - mode 默认 'wc' (Web Component); 'iframe' 为 P4/W15 占位 (init 会抛错)。
 *
 * 前置: 先在 sdk-js 目录执行 `pnpm build` 生成
 *   sdk-js/packages/components/dist/inneragent-chat.js
 */

async function bootstrap() {
  const sdk = await import('../../sdk-js/packages/components/dist/inneragent-chat.js')

  sdk.init({
    appKey: 'demo-host',
    baseURL: '/ia/api/v1',
    // [P2 #24] 声明 agentType: 缺省为 'ai_media'(融光工具链), 演示口径为
    // InnerAgent 'demo'(工具链含 get_current_time 与 mock 写确认链路)。
    agentType: 'demo',
    tokenGetter: async () => null, // 本地联调: 服务端匿名演示头兜底; 生产替换为宿主签发
    // theme: { '--ia-primary': '#0ea5e9' }, // 亦可用 init({ theme }) 全局注入令牌
  })
  sdk.registerInnerAgentChat()

  // ---- 主题切换演示 (CSS 变量令牌, Shadow DOM 内实时生效) ----
  const chat = document.getElementById('chat')
  const label = document.getElementById('theme-label')
  const themes = [
    { name: '默认蓝', vars: {} },
    { name: '紫色', vars: { '--ia-primary': '#7c3aed', '--ia-primary-contrast': '#ffffff' } },
    { name: '墨绿', vars: { '--ia-primary': '#059669', '--ia-primary-contrast': '#ffffff' } },
  ]
  let themeIndex = 0
  document.getElementById('toggle-theme').addEventListener('click', () => {
    themeIndex = (themeIndex + 1) % themes.length
    const theme = themes[themeIndex]
    for (const [name, value] of Object.entries(theme.vars)) {
      if (value) chat.style.setProperty(name, value)
      else chat.style.removeProperty(name)
    }
    label.textContent = `当前: ${theme.name}`
  })

  document.getElementById('host-button').addEventListener('click', () => {
    console.log('[demo-host] 宿主按钮点击 — 若按钮不是绿色虚线样式, 说明组件样式泄漏到了宿主')
  })

  console.log('[demo-host] <inneragent-chat> 已注册; tokenGetter=null (匿名演示头联调)')
}

bootstrap().catch((error) => {
  console.error('[demo-host] 启动失败:', error)
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<p style="color:#cc0000">SDK 加载失败 — 请先在 sdk-js/ 下执行 `pnpm build` 生成 components/dist 产物</p>',
  )
})
