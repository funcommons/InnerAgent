# API 参考 · 01 运行与事件流 API

> server `:18090`;生产鉴权 `Authorization: Bearer <embed token>`;联调可用
> `X-IA-Demo-User`(仅 local profile)。网关部署时前缀 `:18081/ia/...`。
> 通用响应包裹 `CommonResult`(业务码见 [02-错误码与重连语义](02-错误码与重连语义.md));
> SSE 端点例外(直接流)。

## 运行

### POST /ia/api/v1/runs —— 发起运行(SSE)

请求体:

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| conversationId | long | 否 | 空=新建会话 |
| message | string | 是 | 用户消息 |
| agentType | string | 是 | Agent 类型(如 `demo`) |
| toolExecutionMode | enum | 否 | `DEFAULT`(默认)/ `ALWAYS_ASK` |
| enabledSkills | array | 否 | 启用技能列表 |
| modelId | long | 否 | 指定模型;缺省按类型默认解析 |

成功:HTTP 200,`text/event-stream`,帧 `id: <runId>:<seq>` / `event: pipeline-event`
/ `data: <AiChatStreamRespVO JSON>`。事件类型与终态语义见
[03-接入指南/02-直接 HTTP 接入](../03-接入指南/02-直接HTTP接入-SSE契约.md)。

失败:JSON `CommonResult`(如 400 参数、401 鉴权、404 Agent 不存在)。

### GET /ia/api/v1/runs/{runId}/events —— 断点续传(SSE)

| 参数/头 | 说明 |
| --- | --- |
| `Last-Event-ID` 头 | 客户端最后收到的帧 id(`<runId>:<seq>`) |
| `afterSequence` query | 等效参数(显式 seq) |
| 行为 | replay-then-live:先回放后实时;运行已终态则回放完即关流 |

### GET /ia/api/v1/runs/{runId} —— 运行状态

返回运行单据(状态机:`RUNNING`/`WAITING_CONFIRMATION`/`DONE`/`ERROR`/`CANCELLED`)。
轮询形态客户端用此端点;行级隔离:非本人运行 404。

### GET /ia/api/v1/runs/running —— 运行中列表

当前用户处于非终态的运行列表(前端恢复挂起任务用)。

### POST /ia/api/v1/runs/{runId}/cancel —— 取消运行

取消后事件流以 `CANCELLED` 终态收尾;已完成运行返回业务错误码。

## 确认流

### 工具确认(WAITING_CONFIRMATION 恢复)

WRITE 工具/`ALWAYS_ASK` 场景,运行挂起并广播确认事件;前端组件内置确认卡交互。
确认/拒绝后运行继续/终止,原 SSE 连接(或重连)收到后续事件。确认有超时
(默认 24h),过期按过期语义收尾。

### POST /ia/api/v1/runs/confirmations/expire —— 确认过期(平台/宿主侧)

请求体含 `runId`/`replyId`;幂等,过期已终态的确认返回业务码。

## 管理面(`/ia/api/v1/admin/*`,头 `X-IA-Admin-Key`)

| 端点 | 用途 |
| --- | --- |
| POST `/admin/apps` | 注册应用(appKey/name/signPublicKey/webhookUrl/webhookSecret) |
| POST `/admin/tools` | 登记宿主工具(serverKey/toolName/riskLevel/endpointUrl/parametersSchema) |
| 三方 MCP 应用级注册/启停/更新/删除 | 见 [03-接入指南/04](../03-接入指南/04-MCP三方工具接入.md) |

管理面变更均落审计(`decision=allowed`,`source=admin`,不含凭据)。

## 观测

| 端点 | 内容 |
| --- | --- |
| GET `/actuator/health` | 存活/依赖健康 |
| GET `/actuator/prometheus` | IA 指标系列:运行/事件/重连/确认/容量拒绝位
(`fusion_agentscope_runtime_*`、`ia_reconnect_total` 等) |

## 会话与消息

会话/消息查询(会话列表、消息投影 `ia_agent_message`)经平台前端控制台使用;
宿主如需自助查询走 SDK 封装(用户维度行级隔离)。API 细节按 P2 批次补充于本节。

## 相关

- 错误码与重连:[02-错误码与重连语义](02-错误码与重连语义.md)
- 契约同源实现:`inneragent-server .../server/controller/AiPipelineController.java`
