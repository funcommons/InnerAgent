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

## 契约要点

- API 重映射: `POST /ia/api/v1/runs`(SSE)、`/runs/{runId}/continue|cancel|confirm|
  confirm/expire`、`GET /runs/{runId}`、`/runs/{runId}/events`(Last-Event-ID)、
  `/runs/running`、`/conversations*`、`/me/*`、`POST /attachments`。
- SSE 事件协议 (runId:seq、outputType 全集、根终态必需) 与融光 1:1 不变。
- `tokenGetter` 过期懒换: 401 → 再次调用 tokenGetter (单飞) → 新 token 重试一次。
- `mode: 'iframe'` 为 P4/W15 占位 (`IframeModeNotImplementedError`)。
- 偏差清单见任务 P1-T3a 报告。
