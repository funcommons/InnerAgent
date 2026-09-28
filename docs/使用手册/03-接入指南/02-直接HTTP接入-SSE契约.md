# 接入指南 · 02 直接 HTTP 接入(SSE 契约)

> 适用:宿主不用 Java starter(多语言/纯前端直连),或自建客户端。
> 所有路径以 server `:18090` 为例,经网关则为 `:18081/ia/...`。

## 1. 端点总览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/ia/api/v1/runs` | 发起运行,**响应即 SSE 流** |
| GET | `/ia/api/v1/runs/{runId}/events` | 断点续传(同为 SSE;`Last-Event-ID` 头或 `afterSequence` 参数) |
| GET | `/ia/api/v1/runs/{runId}` | 运行状态查询(轮询形态用) |
| GET | `/ia/api/v1/runs/running` | 运行中的运行列表 |
| POST | `/ia/api/v1/runs/{runId}/cancel` | 取消运行 |
| GET | `/actuator/health` · `/actuator/prometheus` | 健康/指标 |

## 2. 发起运行

请求体(`AiChatReqVO`):

```json
{
  "conversationId": null,          // null=新建会话;续聊传会话 id
  "message": "现在几点了?",
  "agentType": "demo",
  "toolExecutionMode": "DEFAULT",  // DEFAULT | ALWAYS_ASK
  "enabledSkills": []
}
```

鉴权(二选一):

- `Authorization: Bearer <embed token>`(生产);
- `X-IA-Demo-User: <userId>`(仅 local profile `allow-anonymous-demo=true` 的联调环境)。

## 3. SSE 事件契约

响应 `text/event-stream`,帧结构:

```
id: <runId>:<sequence>          ← 断点续传游标,客户端必须保存最后一帧 id
event: pipeline-event
data: {"outputType":"CONTENT","createdAt":1730000000000,"content":"...",...}
```

`outputType` 主要取值:

| 取值 | 含义 | 终态? |
| --- | --- | --- |
| `RUN_STARTED` | 运行开始 | |
| `CONTENT` | 模型增量输出;首条携带 `reasoningDurationMs`(模型思考耗时,可用于口径剥离) | |
| `TOOL_CALL_STARTED` | 模型发起工具调用 | |
| `USER_CONFIRMATION_REQUIRED`(`controlType=USER_CONFIRM_REQUIRED`) | 等待用户确认(WRITE 工具/ALWAYS_ASK);运行态 `WAITING_CONFIRMATION` | |
| `TOOL_RESULT` | 工具结果回传 | |
| `DONE`(附 usage) | 正常结束 | ✅ |
| `ERROR` / `CANCELLED` | 失败/取消 | ✅ |

收到终态后服务端关闭流。**客户端处理规则**:

1. 逐帧解析 `data` JSON,按 `outputType` 分发渲染;
2. 保存最后一帧 `id` 供重连;
3. 收到终态才可认为运行结束(连接断开 ≠ 运行结束 —— 运行在服务端继续,重连可追平)。

## 4. 断点续传(不丢事件)

```
GET /ia/api/v1/runs/{runId}/events
Last-Event-ID: <runId>:<lastSeq>
```

或 `?afterSequence=<lastSeq>`。服务端 **replay-then-live**:先从 journal 回放
`afterSequence` 之后的事件,再无缝切入实时流。网络闪断/页面刷新后用同一会话重连,
用户视角无感。

## 5. 确认流的裸 HTTP 处理

`ALWAYS_ASK`/WRITE 工具场景,收到确认事件后运行挂起等待;宿主前端展示确认卡,
用户操作后按平台确认端点提交(前端组件已内置;自建客户端需实现该交互)。
确认有超时(默认 24h),过期自动失效。

## 6. 最小可运行示例

- 冒烟脚本:`scripts/smoke-sse.sh`;
- 压测级消费实现(k6/JS):`tools/k6/lib/sse-client.js` + `tools/k6/lib/metrics.js`
  (逐事件计时、游标解析、终态判定的完整参考);
- 事件时序验收:`e2e/`(demo 回归 24 用例)。

## 相关

- 错误码与重连语义:[04-API 参考/02](../04-API%20参考/02-错误码与重连语义.md)
