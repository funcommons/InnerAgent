# sdk-js — InnerAgent 前端 SDK (任务 P1-T3a)

由融光前端 (`mmagix-minicuts-backup/frontend`) 按「全量 COPY + 拆除业务依赖 + 契约改造」
策略移植的 monorepo。每个文件头注释标注来源路径与改动类型 (`[port]` 机械复制改造 /
`[adapt]` 定向适配 / `[new]` 新写)。

## 结构

```
sdk-js/
├─ packages/core/                    @inneragent/sdk-core — API 重映射 + 状态机
│  └─ src/
│     ├─ config.ts        [new]  init({appKey, tokenGetter, theme?, mode?}) 契约入口
│     ├─ client.ts        [adapt] HTTP 客户端 (源 api/request.ts; axios→fetch, 401 懒换)
│     ├─ sseAuth.ts       [adapt] SSE 认证 fetch (源 api/auth-retry.ts)
│     ├─ runs.ts          [adapt] Run API (源 api/ai-pipeline.ts; 端点重映射 /runs*)
│     ├─ conversations.ts [adapt] 会话 API (源 api/assistant.ts)
│     ├─ me.ts            [adapt] 用户级配置 (源 api/ai-model.ts+agent-config.ts 子集 → /me/*)
│     ├─ attachments.ts   [new]  POST /ia/api/v1/attachments (服务端 T3b)
│     ├─ pageContext.ts   [adapt] 页面上下文 (+ 契约 context{page,object})
│     ├─ timeline/        [port] 纯事件 reducer (源 store/assistantTimeline.ts)
│     └─ store/           [adapt] 助手会话 store (源 store/assistant.ts; pinia)
├─ packages/components/              @inneragent/sdk-components — <inneragent-chat>
│  └─ src/
│     ├─ inneragent-chat.ts   [new]  defineCustomElement 注册入口
│     ├─ InnerAgentChat.ce.vue [new] WC 根 (:host --ia-* 主题令牌 + Shadow DOM)
│     ├─ assistant/           [port/adapt] 13 组件移植 (去业务依赖)
│     ├─ config/              [new]  AgentConfigPanel (P4/W15 view="config" 配置视图)
│     ├─ ui/                  [new/adapt] IaButton/IaSelect/IaTag/IaEmpty/IaDialog/SafeImage
│     │                              (替代 element-plus 封装, Shadow DOM 安全)
│     ├─ i18n/                [new]  轻量 i18n (替代 vue-i18n, 内置 zh-CN/en-US)
│     └─ styles/              [new]  remixicon woff2-only 生成子集 (Shadow DOM 内图标)
├─ packages/iframe/                  @inneragent/sdk-iframe — iframe 模式壳 (P4/W15)
│  └─ src/
│     ├─ protocol.ts  [new] postMessage 信封/消息类型/nonce (协议表见下)
│     ├─ transport.ts [new] windowTransport + 内存传输对 (测试)
│     ├─ host.ts      [new] createIframeEmbed (宿主侧)
│     └─ child.ts     [new] mountIframeAgent (被嵌页引导)
└─ (见 ../examples/demo-host、../examples/iframe-host)  宿主接入演示页
```

## 命令

```bash
pnpm install        # 安装
pnpm test           # vitest 全量 (core + components + iframe)
pnpm typecheck      # vue-tsc 三包
pnpm build          # core library + components WC + iframe host/child 产物
```

## 宿主集成(快速开始)

构建产物 `packages/components/dist/inneragent-chat.js` 以 **bare specifier 外置
`vue` / `pinia`**(不重复打包宿主框架)。宿主页面三步接入:

```html
<!-- 1. 官方 import map:解析产物的 vue/pinia 依赖(版本与 sdk-js package.json 对齐) -->
<script type="importmap">
{
  "imports": {
    "vue": "https://cdn.jsdelivr.net/npm/vue@3.5.43/dist/vue.esm-browser.prod.js",
    "pinia": "https://esm.sh/pinia@3.0.4?external=vue",
    "pinia/client": "https://esm.sh/pinia@3.0.4/client?external=vue"
  }
}
</script>

<!-- 2. 挂载组件标签 -->
<inneragent-chat view="chat"></inneragent-chat>

<script type="module">
  // 3. 初始化并注册(import map 就绪后加载产物)
  const sdk = await import('./packages/components/dist/inneragent-chat.js')
  sdk.init({
    appKey: 'your-app',
    tokenGetter: async () => { /* 返回宿主 embed token */ return null },
    // baseURL 默认 '/ia/api/v1'
  })
  sdk.registerInnerAgentChat()
</script>
```

> 版本对齐:`vue@3.5.x` ≥ 3.5.25、`pinia@3.0.x` ≥ 3.0.4(`packages/*/package.json`
> 的依赖范围);升级 SDK 依赖时同步更新 import map。
> `?external=vue` 保证 pinia 与宿主共用**同一个** vue 实例(经 import map 解析)。
> 该片段已在本地用 import map 手验:产物仅 `import "vue"` / `import "pinia"`
> 两个裸说明符,esm.sh 的 pinia 构建已内联 `@vue/devtools-api` 等次级依赖。

### 本地自托管(不走公网 CDN)

把 vue/pinia 浏览器构建放到自己站点(参考 `e2e/sdk-reconnect-page.html` 同款
模式;pinia 的 dev 浏览器构建额外 `import '@vue/devtools-api'`,需一并映射):

```html
<script type="importmap">
{
  "imports": {
    "vue": "/vendor/vue.esm-browser.prod.js",
    "pinia": "/vendor/pinia.esm-browser.js",
    "@vue/devtools-api": "/vendor/devtools-api-stub.js"
  }
}
</script>
```

### 自包含构建(可选,默认不开启)

需要**单文件零依赖**托管(不配 import map)时,去掉
`packages/components/vite.config.ts` 里 `rollupOptions.external` 一行
(`external: ['vue', 'pinia']`)再 `pnpm build`,vue/pinia 即内联进产物:

- 实测体积:`608.9 kB(gzip 267 kB)` → `901.9 kB(gzip 351 kB)`,
  即 **+~290 kB 原始 / +~85 kB gzip** 的代价,换宿主侧零依赖;
- 内联后产物无任何裸说明符导入(已验证),原生静态托管可直接 `<script type="module">` 引入;
- 构建默认**保持外置**,避免宿主已带 vue 时双实例(优先用上面的 import map)。

## 契约要点

- API 重映射: `POST /ia/api/v1/runs`(SSE)、`/runs/{runId}/continue|cancel|confirm|
  confirm/expire`、`GET /runs/{runId}`、`/runs/{runId}/events`(Last-Event-ID)、
  `/runs/running`、`/conversations*`、`/me/*`、`/mcp-servers`、`POST /attachments`。
- SSE 事件协议 (runId:seq、outputType 全集、根终态必需) 与融光 1:1 不变。
- `tokenGetter` 过期懒换: 401 → 再次调用 tokenGetter (单飞) → 新 token 重试一次。
- `mode: 'iframe'`(P4/W15 起): 宿主侧声明, 桥接经 `@inneragent/sdk-iframe`
  (见下节); 不再抛占位错误。
- 配置视图: `<inneragent-chat view="config">` — Skill 只读列表 + 用户级三方
  MCP 启停; headless 走导出的 `mcpUserServersApi` / `meApi` /
  `getAssistantReferenceOptions`。
- 偏差清单见任务 P1-T3a 报告。

## iframe 模式 (P4/W15)

`@inneragent/sdk-iframe` — 同源策略受限宿主把 `<inneragent-chat>` 运行在
iframe 内, 宿主页与 iframe 仅以 postMessage 协议桥通信。协议与安全决策:

- **token 不入 URL**: `createIframeEmbed` 对 src 中 token 形 query 参数直接
  抛错; embed token 的唯一合法通道是握手后的 `token` postMessage 消息
  (显式 targetOrigin, origin allowlist 内)。
- **origin allowlist**: 宿主 `allowedOrigins`(缺省 `new URL(src).origin`),
  被嵌页 `allowedParentOrigins`(缺省同源); 来源不符的消息一律丢弃。
- **nonce + ack**: 每条消息带唯一 nonce, 应答以 `ack` 回指; `ready.ack`
  必须等于 child 最近一次 `hello.nonce`(防旧消息冒充/串线)。
- **401 懒换跨桥**: child API 层 401 → `onUnauthorized` 钩子失效本地 token
  缓存 → 向宿主以 `reason:'refresh'` 重取; 宿主亦可 `embed.refreshToken()`
  主动推送。
- **严格 CSP 可用**: 产物无 `eval` / `new Function` / `document.write`
  (csp.spec.ts 恒查源码 + dist), `dist/iframe-child.js` 自包含
  (vue/pinia runtime 内联, 被嵌页无需 import map)。

```js
// 宿主页 (还可选 onEvent 收状态/错误/运行终态、setTheme 同步主题)
import { createIframeEmbed } from '@inneragent/sdk-iframe'
const embed = createIframeEmbed({
  src: 'https://frame.example/inneragent/frame.html', // token 不入 URL
  appKey: 'your-app',
  tokenGetter: async () => '...', // token 通道唯一来源
  onEvent: (event) => { /* status/error/run-terminal/tool-finished */ },
})
await embed.ready
embed.setPage({ name: 'home' })   // 上下文同步 (对应 setRunContext)
embed.setObject({ type: 'script', id: 7 })
await embed.refreshToken()        // 宿主主动续签推送
embed.destroy()

// 被嵌页 (自包含产物场景: <script type="module" src="iframe-child.js">)
import { mountIframeAgent } from '@inneragent/sdk-iframe'
mountIframeAgent({ allowedParentOrigins: ['https://host.example'] })
```

完整消息类型表与可运行 demo 见 `examples/iframe-host/README.md`。
