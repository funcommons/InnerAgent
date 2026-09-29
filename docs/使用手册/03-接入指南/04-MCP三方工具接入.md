# 接入指南 · 04 MCP 三方工具接入

> 适用:把第三方系统以 MCP(Model Context Protocol)服务器形式接入 Agent 工具体系。
> 与宿主桥([01-SDK 接入](01-SDK接入-Java宿主桥.md))的区别:宿主桥是你自己的应用
> 逻辑;三方 MCP 是外部 SaaS/内部其他团队提供的 MCP 端点。

## 1. 两种注册面

| | 应用级(管理面) | 用户级(自助) |
| --- | --- | --- |
| 登记者 | 平台管理员(`X-IA-Admin-Key`) | 终端用户本人 |
| 生效范围 | 应用内所有用户 | 仅该用户 |
| SSRF 防护 | 不限(管理面可信配置,允许内网端点) | **拒绝本机/内网地址** |
| 数量护栏 | — | 每用户 32 个 |

工具进入工具箱后的统一命名:`mcp__<serverKey>__<tool>`(FQN,防跨服务器重名遮蔽)。

## 2. 登记契约

```json
{
  "serverKey": "crm",                  // [a-zA-Z0-9-],≤64;冲突域含应用级/宿主/用户级
  "name": "CRM 线索",
  "endpointUrl": "https://crm.example.com/mcp",
  "transport": "streamable-http",      // 目前唯一支持
  "authType": "STATIC_HEADER",
  "headerName": "X-Api-Key",
  "credentials": "secret-value",
  "timeoutSeconds": 45,
  "enabled": true
}
```

规则(与平台单测同源):

- `serverKey` 字符集 `[a-zA-Z0-9-]`(下划线/中文/超长 → 400);**同键在任何冲突域
  (应用级表/宿主注册表/用户级表)被占用即 409(冲突校验按 appId 划分);删除(软删)后
  同键暂不可复用(复用报 409),建议换键**;
- `authType=OAUTH` 当前为枚举预留位,配置即 **501**(错误信息指明 CIMD 流程后续批次);
- `STATIC_HEADER` 必须 `headerName` 与 `credentials` 成对出现(缺一 → 400);
- 凭据以密文存储;**凭据值永不进入审计日志**;
- 用户级编辑时 `credentials` 传空 = 保持原值(SDK 编辑流不打码形污染),显式非空 = 覆盖。

## 3. 行级隔离语义

用户级注册按 `(appId, userId, id)` 行级隔离:用户 B 访问用户 A 的注册 → **404**
(不泄露存在性);跨应用同样 404。

## 4. 变更生效

注册/启停/更新/删除都会触发**配置失效广播** —— 在线运行的 Agent 工具箱随之刷新,
无需重启。invalidator 缺席的裁剪部署静默跳过(不阻塞主流程)。

## 5. 工具命名与确认

- 注册后工具以 `mcp__<serverKey>__<tool>` 进入模型工具箱;对话里模型按描述自主选用;
- 风险分级/确认语义与宿主桥一致(WRITE/ALWAYS_ASK → 确认卡);
- 审计:注册/调用均落审计(决策 allowed/denied + 来源 admin/user),不含凭据。

## 6. 自检清单

- [ ] `streamable-http` 端点可直接 curl 通(401/鉴权头名对齐)
- [ ] serverKey 未与现有宿主/应用/用户级键冲突
- [ ] 用户级端点为公网地址(SSRF 护栏会拒内网)
- [ ] 对话中模型能调用该工具并返回结果(审计可查)

## 相关

- 平台侧实现:`inneragent-server .../agent/mcp/`(McpAppServerService/McpUserServerService)
- 现有工程口径:《docs/接入指南.md》
