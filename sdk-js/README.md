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
│     ├─ ui/                  [new/adapt] IaButton/IaSelect/IaTag/IaEmpty/IaDialog/SafeImage
│     │                              (替代 element-plus 封装, Shadow DOM 安全)
│     ├─ i18n/                [new]  轻量 i18n (替代 vue-i18n, 内置 zh-CN/en-US)
│     └─ styles/              [new]  remixicon woff2-only 生成子集 (Shadow DOM 内图标)
└─ (见 ../examples/demo-host)        宿主接入演示页
```

## 命令

```bash
pnpm install        # 安装
pnpm test           # vitest 全量 (core + components)
pnpm typecheck      # vue-tsc 两包
pnpm build          # core library + components WC 单产物 dist/inneragent-chat.js
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
  `/runs/running`、`/conversations*`、`/me/*`、`POST /attachments`。
- SSE 事件协议 (runId:seq、outputType 全集、根终态必需) 与融光 1:1 不变。
- `tokenGetter` 过期懒换: 401 → 再次调用 tokenGetter (单飞) → 新 token 重试一次。
- `mode: 'iframe'` 为 P4/W15 占位 (`IframeModeNotImplementedError`)。
- 偏差清单见任务 P1-T3a 报告。
