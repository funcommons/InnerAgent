# 接入指南 · 03 前端组件与 iframe 嵌入

> 适用:宿主前端接入聊天界面。两条路线:Web Component 直挂(默认)/
> iframe + postMessage(token 不入 URL,强隔离场景)。

## 1. 两种模式怎么选

| | WC 直挂(`<inneragent-chat>`) | iframe + postMessage |
| --- | --- | --- |
| 集成成本 | 低(一个标签 + init) | 中(宿主页 + 被嵌页接线) |
| token 暴露面 | token 进宿主页面 JS 上下文 | **token 不入 URL/不进宿主 JS** |
| 样式定制 | 组件样式变量 | 天然样式隔离 |
| 适用 | 常规业务系统 | 高安全要求/多租户 SaaS 嵌入 |

## 2. WC 直挂(sdk-js)

SDK 仓库:`sdk-js/`(monorepo):

- `@inneragent/sdk-core`:API 客户端 + 会话 store;
- `@inneragent/sdk-components`:Web Component(`<inneragent-chat>`)。

最小接线(参考 `examples/acme-demo/frontend/src/views/ia/EmbedChat.vue` 的
`mode=wc` 分支):

```ts
import { init } from '@inneragent/sdk-core';
import { registerInnerAgentChat } from '@inneragent/sdk-components';

init({
  appKey: 'acme-demo',                    // 与管理面 appKey 一致(必填)
  baseURL: 'http://localhost:18090/ia/api/v1',  // 缺省 '/ia/api/v1'
  agentType: 'demo',                      // Agent 类型经 init 传入,不是标签属性
  tokenGetter: async () => {              // 三要点之一:异步取 token
    const r = await fetch('/api/ia/embed-token');   // demo 宿主端点为 GET
    return (await r.json()).token;        // 由宿主后端签发(私钥在后端)
  },
});

registerInnerAgentChat();                 // 注册 <inneragent-chat>(幂等)
```

```html
<!-- 标签属性: view="chat"(默认)| "history" | "config"、project-id -->
<inneragent-chat view="chat"></inneragent-chat>
```

`tokenGetter` 三要点:**异步**(首次与过期续签都走它)、**每次调用取新值**
（组件不缓存过期 token;SDK 收到 401 会再次调用)、**错误要抛出**
（组件显示连接态而不是静默卡死)。

## 3. iframe + postMessage 模式

参考实现( acme-demo ):

- 宿主侧:`frontend/src/vendor/inneragent/iframe-host.js`;
- 被嵌页:`frontend/public/ia/{frame.html,frame.js,iframe-child.js}`;
- 接线:`EmbedChat.vue` 的 `mode=iframe` + `src/ia/iframeEmbed.ts`。

工作机制:

```
宿主页(iframe-host)                被嵌页(frame.html,平台域)
  postMessage({type:'ia:init'}) ──▶ 初始化 SDK(前端自身取 token)
  ◀── postMessage(高度/状态事件)    挂 <inneragent-chat>
```

- token 只出现在被嵌页(可部署在平台同域/独立域),宿主页仅转发初始化与尺寸事件;
- 宿主页须做 `targetOrigin` 校验,不要用 `*`。

## 4. 会话连续性

- 组件按用户维度持有会话;`conversationId` 可由宿主指定(如绑定业务工单详情页),
  实现"一个业务对象一个会话";
- 刷新页面后组件以 `Last-Event-ID` 续传进行中的运行(见
  [02-直接 HTTP 接入](02-直接HTTP接入-SSE契约.md) §4)。

## 5. 自检清单

- [ ] token 经宿主后端签发,前端不接触私钥
- [ ] 过期续签路径测试过(把 token TTL 调到 60s 试一轮)
- [ ] iframe 模式下 postMessage 校验 targetOrigin
- [ ] 移动端视口与深色模式下 UI 正常

## 相关

- demo 完整前端:`examples/acme-demo/frontend`
- SDK 单测/构建:`cd sdk-js && pnpm test`(vitest)
