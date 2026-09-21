# 三方 MCP 演示服务器(acme-echo-mcp)

零依赖 Node(≥18)实现的 **streamable-http** 最小 MCP 服务器,只有 1 个 `echo`
工具,用于演示 InnerAgent「应用级三方 MCP」链路:管理面注册(STATIC_HEADER
静态头鉴权)→ 工具目录聚合(`mcp__acme-echo__echo`)→ 模型调用。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.mjs` | 服务器本体(约 230 行,无任何 npm 依赖);`--selftest` 自测 |

## 快速开始

```bash
# 1) 协议自测(initialize → tools/list → tools/call + 401 语义)
node server.mjs --selftest

# 2) 起服务(默认 127.0.0.1:9401)
node server.mjs
# 可用环境变量:PORT / HOST / HEADER_NAME(默认 X-ACME-Token)/ ECHO_TOKEN(默认 acme-echo-secret)
```

`seeds/provision.sh` 会把它注册到 InnerAgent 管理面(`serverKey=acme-echo`,
`authType=STATIC_HEADER`),注册前会探测端口;不想跑就设 `ACME_SKIP_MCP=1` 跳过。

## 协议实现说明

按 InnerAgent 侧客户端(`HttpClientStreamableHttpTransport`,
`resumableStreams=false`、不依赖 GET SSE 流)的最小形态实现:

- `POST /mcp` 单一端点;请求体支持单条与批量 JSON-RPC;
- `initialize` 回应答 `serverInfo` + 协商后的 `protocolVersion`,并下发
  `Mcp-Session-Id` 响应头(服务器不强制校验会话,无状态友好);
- Notification(如 `notifications/initialized`)→ `202`,无响应体;
- `tools/list` / `tools/call` / `ping` → `200` + JSON-RPC result(`application/json`);
- `GET /mcp` → `405`(不提供服务器→客户端 SSE 流);
- 每次请求校验静态头,缺失/错误 → `401`(STATIC_HEADER 鉴权语义)。

## 在 InnerAgent 侧看到什么

注册成功后,该服务器的工具以 FQN `mcp__acme-echo__echo` 进入应用工具目录;
运行时按 `enabledMcpTools` 三分法(DEF-07)进入内核工具面。调用失败时的
细分异常(超时/传输/鉴权)映射见主仓库 `McpClientToolInvoker` 注释。
