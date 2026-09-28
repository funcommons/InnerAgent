# 接入指南 · 01 SDK 接入(Java 宿主桥,inneragent-starter)

> 适用:宿主后端为 Java(21)/Spring Boot。前端/多语言宿主见
> [02-直接 HTTP 接入](02-直接HTTP接入-SSE契约.md)。

## 1. 引依赖

```xml
<dependency>
    <groupId>com.inneragent</groupId>
    <artifactId>inneragent-starter</artifactId>
    <version>0.1.0-SNAPSHOT</version>
</dependency>
```

starter 自动装配三件事:**宿主桥 MCP 端点**(`/ia-mcp`)、**act token 校验**
（运行期平台回调宿主的短时凭证）、**工具注册行**(启动日志可见)。

## 2. 桥配置(`application.yml`)

```yaml
inneragent:
  bridge:
    act:
      audiences:
        - http://localhost:9300/ia-mcp   # 必须与管理面登记的 endpointUrl 一致
```

| 配置 | 说明 |
| --- | --- |
| `act.audiences` | act token 受众白名单;不一致 = 平台回调被拒(接入最常见坑) |
| 环境变量 `IA_SERVER_BASE` | 平台地址(如 `http://localhost:18090`) |
| 环境变量 `IA_APP_KEY` | 应用标识(与管理面 appKey 一致) |
| 环境变量 `IA_SIGN_PRIVATE_KEY` | PKCS#8 RSA 私钥(签 embed token;**只经环境注入,不入库不入前端**) |
| 环境变量 `IA_WEBHOOK_SECRET` | Webhook 验签密钥 |

## 3. 写工具(@IaTool)

```java
@IaTool(name = "create_ticket",
        description = "在 ACME 宿主系统中创建一张工单",
        riskLevel = ToolRiskLevel.WRITE)      // com.inneragent.starter.ToolRiskLevel
                                              // READ=读类,WRITE=写类(默认值,强制确认)
public Ticket createTicket(
        @IaToolParam(description = "工单标题") String title,
        @IaToolParam(description = "优先级") String priority,
        IaActClaims claims) {                 // 可选注入:发起用户身份(act token claims)
    return ticketService.create(title, priority, claims.userId());
}
```

要点:

- **方法即工具**:参数描述会生成 `parametersSchema` 供模型理解,描述质量直接决定
  调用准确率;
- `IaActClaims` 注入发起用户的真实身份 —— 工具内部**必须**以其做数据权限过滤,
  不要信任模型转述的用户标识;
- 风险分级:`READ` 类在 `DEFAULT` 模式自动放行;`WRITE` 类推用户确认卡(平台级语义,
  宿主不可关闭;`@IaTool` 的 `riskLevel` 缺省即 `WRITE`,宁严勿松);
- 命名规范见仓库《工具设计规范.md》。

## 4. 签发 embed token(宿主登录态 → 平台身份)

```java
// 形态参考 acme-demo EmbedTokenSigner:TTL 由配置给出,非方法入参
SignedToken signed = embedTokenSigner.sign(userId, tenantId);   // → record(token, expiresIn)
String token = signed.token();   // 返回给已登录的前端;前端以 Authorization: Bearer <token> 调平台
```

三要点:**私钥只在宿主后端**;token 短时效(TTL 由宿主配置,acme-demo 为
`ia.embed-ttl-seconds` / 环境变量 `IA_EMBED_TTL_SECONDS`,默认 43200s=12h;
生产建议收紧到 ≤30min 并由宿主续签);claims 里的用户标识(`sub`)= 平台侧行级
隔离的 `userId`。

## 5. Webhook 订阅(可选但推荐)

平台把工具调用/运行事件推给宿主(管理面 `webhookUrl` + `webhookSecret`):

```java
// 验签三原则(见 acme-demo IaWebhookVerifier):
//  ① 用原始请求字节计算签名(不要先反序列化)
//  ② 常量时间比较(HMAC)
//  ③ 快速返回 2xx,重活转异步
```

## 6. 自检清单

- [ ] 启动日志出现桥注册行(`N 个宿主工具 @ /ia-mcp`)
- [ ] `act.audiences` == 管理面工具登记的 `endpointUrl`
- [ ] 管理面登记的 `signPublicKey` 与本地私钥配对(可用 demo 的 `/ia/overview` 自检页形态)
- [ ] WRITE 工具在对话中触发确认卡
- [ ] Webhook 收到事件且验签通过

## 相关

- 完整参考实现:`examples/acme-demo/backend`
- 深度口径:《docs/接入指南.md》(工程视角)
