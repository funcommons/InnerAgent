# 接入指南 · 07 AG-UI 协议接入

> 适用:前端想直接复用 AG-UI 生态(CopilotKit 及其约 20 个框架官方桥)消费本平台运行,
> 不自研平台私有 SSE 帧解析。方向:**平台把既有运行事件流翻译成 AG-UI 1.0 事件**,
> 接入方按标准 AG-UI 协议对接,身份鉴权与原生 `/runs` 完全同源。
> 路径以 server `:18090` 为例,经网关则为 `:18081/ia/...`。
>
> 注:本篇与端点实现同步收口(14 帧 × AG-UI 事件映射已评审拍板),事件名/字段取值
> **以端点实际行为为准**。

## 1. 是什么

| 项 | 口径 |
| --- | --- |
| 端点 | `POST /ia/api/v1/ag-ui/runs`——AG-UI `RunAgentInput` 进(`application/json`),SSE 出 |
| 输出形态 | AG-UI 1.0 事件流:`text/event-stream`,`data` 行内 JSON、以 `type` 字段判别事件(不用 SSE `event:` 字段) |
| 鉴权 | 与既有 `POST /runs` **完全同源**:`Authorization: Bearer <embed token>`(联调 `X-IA-Demo-User`) |
| 消费方 | 任何 AG-UI 1.0 兼容前端——CopilotKit 等约 20 个框架桥——可直接驱动本平台运行 |
| 与原生 `/runs` 关系 | 同一条运行管道的事件投影,不改变平台侧编排/工具/确认语义;重放等可靠性能力仅原生端点有(§3) |

## 2. 事件映射(平台 14 帧 → AG-UI)

| 平台帧(`outputType`) | AG-UI 事件 | 说明 |
| --- | --- | --- |
| —— | `RUN_STARTED` | **合成**:平台无对应帧,端点受理请求后即发(`threadId`/`runId`) |
| `CONTENT` | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` → `TEXT_MESSAGE_END` | 增量正文直映(`content`→`delta`);消息起止边界由适配器**合成** |
| `REASONING` | `REASONING_START` → `REASONING_MESSAGE_CONTENT` → `REASONING_END` | 起止边界由适配器**合成** |
| `TOOL_CALL_STARTED` | `TOOL_CALL_START` | `toolCalls[].id`/`name` → `toolCallId`/`toolCallName` |
| `TOOL_CALL` | `TOOL_CALL_ARGS` + `TOOL_CALL_END` | **整串单 delta**:平台参数整串一次给出(非增量),消费方直接取 `delta` 全量使用 |
| `TOOL_FINISHED` | `TOOL_CALL_RESULT` | `toolResult`→`content`,`role=tool` |
| `SUB_AGENT_STARTED` / `SUB_AGENT_FINISHED` | `SUBAGENT_*`(AG-UI 1.0 subagent 事件族) | 子 Agent 编排路径;`childRunId`/`agentName` 的载荷字段以端点实际行为为准 |
| `USER_CONFIRMATION_REQUIRED` | `CUSTOM`(name=`inneragent.*`) | 确认卡不走标准事件;批准/拒绝走平台确认 API(§5) |
| `USER_CONFIRM_RESULT` | `CUSTOM`(name=`inneragent.*`) | 确认结果回执 |
| `EXTERNAL_EXECUTION_REQUIRED` / `EXTERNAL_EXECUTION_RESULT` | `CUSTOM`(name=`inneragent.*`) | 宿主侧执行挂起/回执,无标准事件对应 |
| `DONE` | `CUSTOM`(kb_citations)+ `RUN_FINISHED` | 平台在 `DONE` 帧携带引用清单(`kbCitations`),以 `CUSTOM` 事件透出;随后 `RUN_FINISHED` 收尾 |
| `ERROR` / `CANCELLED` | `RUN_ERROR` | 失败与取消共用 `RUN_ERROR`,以 `code` 区分(取值以端点实际行为为准) |

**五个合成点**(平台帧没有、适配器补齐):① `RUN_STARTED`(由端点合成);② 消息起止边界
(`TEXT_MESSAGE_START/END`);③ 推理起止边界(`REASONING_START/END`);④ args 整串单 delta;
⑤ 确认卡/确认回执与 kb_citations 走 `CUSTOM`(`name` 形如 `inneragent.*`,具体命名以端点
实际行为为准)。未知事件按 AG-UI 规范忽略即可,不要因此中断流。

## 3. 输入映射与当前限制

`RunAgentInput` → 平台运行:

| AG-UI 输入 | 平台语义 |
| --- | --- |
| `messages` 末条 user 消息 | 本次运行的用户输入(平台 `message`) |
| `threadId` | 平台 `conversationId`:同一 `threadId` 多轮映射同一会话,自然续聊 |
| `runId` | 本次运行的关联标识;**非空即走续跑**(等价原生 `/runs/{runId}/continue`),新会话请勿携带;省略时新起运行,平台 `runId` 由服务端生成 |
| `tools` / `context` / `state` / `forwardedProps` | v1 不消费:平台工具在服务端注册(MCP / `@IaTool`),无前端工具形态 |

当前限制(v1,如实声明):

| 项 | 现状 | 建议 |
| --- | --- | --- |
| 断线重放 | **无,仅实时流(live-only)**。AG-UI 协议本身无重连语义(SSE `Last-Event-ID` 在 AG-UI 传输中不使用);平台原生的 journal 回放超出 AG-UI spec,v1 未透出 | 需要不丢事件/断线追平的生产可靠性时,改用原生 `POST /runs` + `GET /runs/{runId}/events`(见 [02 篇 §4](02-直接HTTP接入-SSE契约.md)) |
| tool args | 非增量:`TOOL_CALL_ARGS` 整串单帧 | 直接全量使用,无需增量累积逻辑 |
| 状态同步 | `STATE_SNAPSHOT` / `STATE_DELTA` / `MESSAGES_SNAPSHOT` 未提供 | 依赖共享状态的 AG-UI 前端特性不适用 |

## 4. 最小接入示例

```bash
curl -N POST http://localhost:18090/ia/api/v1/ag-ui/runs \
  -H "Authorization: Bearer $EMBED_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"threadId":"c-42","messages":[{"id":"m1","role":"user","content":"现在几点了?"}]}'
```

> `runId` 传入已有运行 id 即走续跑(复用原生 `/runs/{runId}/continue` 语义);新会话省略即可。

流样例(节选示意;字段以端点实际行为为准):

```
data: {"type":"RUN_STARTED","threadId":"c-42","runId":"r-1"}

data: {"type":"TEXT_MESSAGE_START","messageId":"m-1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m-1","delta":"现在时间是"}

data: {"type":"TOOL_CALL_START","toolCallId":"tc-1","toolCallName":"get_current_time"}

data: {"type":"TOOL_CALL_ARGS","toolCallId":"tc-1","delta":"{}"}

data: {"type":"TOOL_CALL_END","toolCallId":"tc-1"}

data: {"type":"RUN_FINISHED","threadId":"c-42","runId":"r-1"}
```

- CopilotKit 前端:把 AG-UI `HttpAgent` 的 `endpoint` 指向本端点并带上鉴权头,其余按
  AG-UI 标准消费;CopilotKit 具体 API 用法以其官方文档为准,本篇不展开。
- embed token 的签发与传递见 [02-宿主应用接入](../02-快速开始/02-宿主应用接入.md)。

## 5. 语义差异与取舍

| 差异点 | AG-UI 侧 | 本平台取法 |
| --- | --- | --- |
| 工具确认(HITL) | 标准路径是前端工具 + interrupt/resume | 确认卡以 `CUSTOM` 事件透出;批准/拒绝走平台原生 `POST /runs/{runId}/confirm`(`replyId` + `decisions`),运行态 `WAITING_CONFIRMATION`——保留 READ/WRITE 分级授权与确认审计,不降级为前端审批 |
| 取消 | 协议无取消语义 | 走平台原生 `POST /runs/{runId}/cancel`(幂等);流内以 `RUN_ERROR`(code 取消语义)收尾 |
| 断线重放 | 无重连语义 | 平台 journal 回放保留为原生端点独有增强(§3) |
| 确认超时 | —— | 与原生一致:默认 24h 过期自动失效 |

## 相关

- 原生 SSE 契约与断点续传:[02-直接 HTTP 接入](02-直接HTTP接入-SSE契约.md)
- 确认流/取消端点契约:[04-API 参考/01-运行与事件流 API](../04-API参考/01-运行与事件流API.md)
- 引用溯源与外部知识库:[06-外部知识库 API 规范](06-外部知识库API规范.md)
- 限制速查:[07-参考/02-限制与配额](../07-参考/02-限制与配额.md)
