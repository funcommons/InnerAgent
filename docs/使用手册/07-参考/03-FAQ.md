# 参考 · 03 FAQ(接入常见坑)

> 全部为本仓开发/压测/接入过程中的实录问题,按症状索引。

## 连接与鉴权

**Q:前端报 CORS / 401?**
server 启动三件套缺一不可:`IA_ADMIN_KEY`(403)+ `IA_REDIS_PORT`(Redis 连接失败)+ `IA_CORS_ALLOWED_ORIGINS`(preflight 被拒,须含前端来源)。embed token 过期同样 401 —— SDK 收到 401 会回调 `tokenGetter` 重取,确认你的 getter 每次取新值。

**Q:平台回调宿主工具一直失败?**
最常见:管理面登记工具的 `endpointUrl` 与宿主 `inneragent.bridge.act.audiences` **不一致**。act token 受众校验按 URL 精确对齐。

**Q:Webhook 验签总失败?**
必须用**原始请求字节**计算 HMAC(先反序列化再算签必错)、常量时间比较、快速回 2xx。参考 `acme-demo` 的 `IaWebhookVerifier`。

## 工具与确认流

**Q:模型从不调用我的工具?**
排查顺序:① 工具是否登记成功(启动日志「N 个宿主工具 @ /ia-mcp」/审计可查);② `endpointUrl`/audiences 对齐;③ **模型本身支持 tool-calling 吗**(不支持时工具永不触发,是最常见的"接入成功但不调工具");④ 工具描述是否说清"做什么+何时用"。

**Q:运行一直停在 WAITING_CONFIRMATION?**
确认卡未被处理,超时前(默认 24h)会一直挂起 —— `ALWAYS_ASK`/WRITE 工具的正常语义。前端应渲染确认卡;不想要确认就用 `DEFAULT` 档 READ 工具,或用户对写工具永久授权后放行。

**Q:工具内部怎么拿到真实用户身份?**
注入 `IaActClaims`(act token claims),**永远以它过滤数据**;不要信任模型转述的"用户说他是谁"。

## 模型与 mock

**Q:mock 模型设为默认了,回复全是同一句兜底文案?**
规则对象必须挂在 `config` 的 **`"mockScript"` 键下** —— 裸 rules 对象会静默回退 legacy 形态。诊断钥匙:`ia_agent_run.agent_definition_snapshot_json` 的 `modelOptions` 能看到生效 config 原文。

**Q:mock 规则写了工具名但从不调工具?**
看 server WARN「规则工具 X 不在 toolkit」:宿主桥/MCP 工具在工具箱里是 FQN(`mcp__<serverKey>__<tool>`),规则写**裸名**即可(provider 做后缀解析);若整个工具不在该 Agent 工具箱,provider 跳过工具直接回复。

**Q:正则规则不命中?**
注意全角/半角:种子用半角 `:` `,`;正则匹配的是最后一条非空用户消息,确认恢复链路注入的空文本消息会被自动跳过。

## 运行与事件流

**Q:SSE 断线后事件会丢吗?**
不会。journal 是事实源,重连带 `Last-Event-ID`(帧 id `<runId>:<seq>`)即 replay-then-live 追平;连接断开 ≠ 运行结束。

**Q:收到的 `createdAt` 有时是数字有时是字符串?**
Jackson 序列化双形态(epoch 毫秒 / ISO-8601),解析时都要兼容。

**Q:遇到没见过的 outputType?**
按未知类型忽略即可,不要中断流(全集见 [02-直接 HTTP 接入](../03-接入指南/02-直接HTTP接入-SSE契约.md))。

## 运维

**Q:库涨得快?**
≈18KB/运行 + journal ≈11 条/运行 —— 生产必须配归档/分区;压测后清理可用 `tools/k6/cleanup-loadtest-data.sql`(按压测用户口径,先 dry-run)。

**Q:多实例部署要额外注意什么?**
事件跨实例扇出走 outbox:给 `outbox_backlog` 配告警(>5 万持续 10min);吞吐不足先调 `outbox-delay-ms`/BATCH_SIZE 再横向扩。

**Q:怀疑内存问题怎么定位?**
`/actuator/prometheus` 看 `jvm_memory_used_bytes{area="heap",id="G1 Old Gen"}` 趋势 + `runs_waiting`;挂起会话内存问题已根修(2026-09-28,回放循环订阅链保留 + SSE 惰性取消,见容量报告 O-3),若复发按此两处先查。

## 相关

- [05-最佳实践/02-容量规划与观测](../05-最佳实践/02-容量规划与观测.md)
- [06-运维手册/01-部署与配置](../06-运维手册/01-部署与配置.md)
