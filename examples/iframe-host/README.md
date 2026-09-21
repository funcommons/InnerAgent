# iframe 模式演示 (examples/iframe-host)

严格 CSP 宿主页 (`index.html`) + 被嵌页 (`frame.html`), 经
`@inneragent/sdk-iframe` 的 postMessage 协议桥通信 —— 03-开发计划 §7.3 验收 5:
「iframe 模式在严格 CSP demo 宿主可用; token 不入 URL」。

## 运行

```bash
# 1. 构建 SDK 产物 (被嵌页引用自包含 iframe-child.js / iframe-host.js)
cd sdk-js && pnpm build

# 2. 起 demo (宿主页 http://localhost:5181/)
cd examples/iframe-host && pnpm dev
# 可选: 另起 inneragent-server local profile (18090) 做全链路冒烟
```

## 安全决策: token 通道

| 通道 | 决策 |
| --- | --- |
| iframe URL / query / hash | **禁止**。`createIframeEmbed` 对 src 中 token 形 query 参数直接抛错 |
| postMessage `token` 消息 | **唯一合法通道**。宿主 `tokenGetter` 结果经握手后的消息桥下发 (显式 targetOrigin, origin allowlist 内) |
| localStorage / cookie 跨窗传递 | 不使用 |

401 过期懒换跨桥: child 端 API 收到 401 → `onUnauthorized` 钩子失效本地
token 缓存 → 以 `reason:'refresh'` 向宿主重取 → 宿主 `tokenGetter` 重新签发。
宿主也可主动 `embed.refreshToken()` 推送。

## postMessage 协议消息类型表

所有消息为信封 `{ ns:'inneragent.bridge', v:1, type, nonce, ack?, payload? }`;
发送必带显式 targetOrigin(永不 `'*'`);双侧 origin allowlist,来源不符丢弃;
`ready.ack` 必须等于 child 最近一次 `hello.nonce`(防旧消息冒充握手)。

| type | 方向 | payload | ack 语义 |
| --- | --- | --- | --- |
| `hello` | child→host | `{protocolVersion}` | 由 `ready` 应答 |
| `ready` | host→child | `{protocolVersion, appKey, agentType?, baseURL?, locale?, theme?}` | `ack`=hello.nonce |
| `token-request` | child→host | `{reason:'initial'\|'refresh'}` | 由 `token` 应答 |
| `token` | host→child | `{token: string\|null, reason}` | `ack`=token-request.nonce;child 自动 ack |
| `context` | host→child | `{page?, object?}` | child 自动 ack |
| `set-theme` | host→child | `{tokens}` | child 自动 ack |
| `event` | child→host | `{kind:'status'\|'error'\|'run-terminal'\|'tool-finished', ...}` | host 自动 ack |
| `ack` | 双向 | 无 | `ack`=被确认消息 nonce |

## CSP 说明

两页均带等价的 CSP meta(生产建议换成响应头):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self';
base-uri 'none'; form-action 'none'
```

- `script-src 'self'`:页面零内联脚本;iframe-child.js 为自包含产物
  (vue/pinia runtime 内联,**不需要 import map** —— 严格 CSP 下内联 import
  map 不可用);SDK 产物经 `csp.spec.ts` 静态断言无 `eval` / `new Function` /
  `document.write`、无外部 bare import。
- `style-src 'unsafe-inline'`:WC 运行时向 shadow root 注入 `<style>` 所需
  (动态样式无法预计算 hash);脚本面仍严格。

## 接入要点

- 被嵌页声明 `allowedParentOrigins`(允许嵌入它的宿主来源;缺省同源);
- 宿主声明 `allowedOrigins`(缺省 `new URL(src).origin`);
- 跨源部署时服务端需为 API/SSE 配 CORS(见任务报告差距清单);
- `sandbox` 属性可由宿主按需加(`allow-scripts allow-same-origin` 为同源
  服务时的最低集);child 是第一方 SDK 代码,凭证只经消息桥。
