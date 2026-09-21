# ACME × InnerAgent 第三方接入 DEMO

InnerAgent 的**第三方接入参考实现**(宿主应用视角,前后端),与《[docs/接入指南.md](../../docs/接入指南.md)》逐步对应——文档讲"怎么接",本项目演示"接好长什么样"。脚手架沿用 benefit4j 前后端骨架(已拆除业务)。

```
acme-demo/
├─ backend/    宿主后端(ACME 视角):持有 RSA 私钥、签发 embed token、
│              @IaTool 工具桥(/ia-mcp)、Webhook 验签、管理面开通封装
└─ frontend/   宿主前端:演示轻登录、<inneragent-chat> WC 直挂、
               iframe postMessage 模式、工具调用演示、接入流程总览
```

## 它演示了接入的哪一半

InnerAgent 接入有三个角色:**平台方**(运营 InnerAgent server)、**接入方**(你,宿主应用)、**终端用户**。本 DEMO 是完整的**接入方**实现(带自己的登录态,区别于仓库自带的 `examples/demo-host` 纯静态联调页,见文末)。

| 接入指南章节 | DEMO 代码位置 |
| --- | --- |
| §2-①/③ 引依赖 + `inneragent.bridge.*` 桥配置 | `backend/pom.xml` + `backend/src/main/resources/application.yml` |
| §2-② 写工具(@IaTool / @IaToolParam / IaActClaims) | `backend/.../tool/AcmeTicketTools.java`(create_ticket=WRITE、list_tickets=READ、resolve_scope=READ) |
| §2-④/§4.1 应用注册与公钥登记(一次性开通) | `backend/.../ia/InnerAgentAdminClient.java`(说明性封装 + 状态自检;运行期签 token 不依赖它) |
| §2-⑤/§4.1 签发 embed token(RS256,私钥不出宿主) | `backend/.../ia/EmbedTokenSigner.java` + `web/EmbedTokenController.java`;前端 `src/api/ia.ts` + `src/ia/innerAgentBridge.ts` |
| §2-⑤ 前端 SDK 接入(init + tokenGetter 三要点) | `frontend/src/views/ia/EmbedChat.vue`(mode=wc)+ `src/vendor/inneragent/inneragent-chat.js` |
| §4.2 act token 与宿主桥内环(60s,X-IA-Act) | starter 自动装配;`ia.bridge.act.audiences` ↔ 管理面 `endpointUrl` 对齐(yml 注释) |
| iframe postMessage 模式(token 不入 URL) | 宿主侧 `frontend/src/vendor/inneragent/iframe-host.js`;被嵌页 `frontend/public/ia/{iframe-child.js,frame.html,frame.js}`;接线 `EmbedChat.vue`(mode=iframe)+ `src/ia/iframeEmbed.ts` |
| §5 约束范围 resolve_scope(宿主契约) | `AcmeTicketTools.resolveScope`(实现同名工具即视为已实现,降级语义见指南) |
| §6.3 Webhook 订阅与验签(原始字节/常量时间/快回 2xx) | `backend/.../ia/IaWebhookVerifier.java` + `web/WebhookController.java`;事件流见 `ToolsBoard.vue` |
| 工具调用闭环(确认卡 → /ia-mcp 桥 → 工具) | `ToolsBoard.vue`:channel=direct(表单直建)与 channel=agent(经 InnerAgent)混排展示 |
| 安全责任划分(密钥不出后端) | `DemoConfigController.java` 只暴露 inneragentBaseUrl/appKey/agentType |

## 运行

前置:InnerAgent server 起在 `http://localhost:18090`(本地联调可加 `local` profile);宿主后端端口 9300、前端 9203。

**启动顺序:InnerAgent server → 宿主后端(桥注册)→ 宿主前端。**

### 0. 生成宿主签名密钥对(一次性)

```bash
# PKCS#8 私钥(留宿主,注入 IA_SIGN_PRIVATE_KEY);公钥登记给管理面
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out host.key
openssl pkey -in host.key -pubout -out host.pub
```

### 1. 管理面开通(一次性,X-IA-Admin-Key)

```bash
curl -s -X POST "http://localhost:18090/ia/api/v1/admin/apps" \
  -H "X-IA-Admin-Key: ${IA_ADMIN_KEY}" -H 'Content-Type: application/json' -d '{
    "appKey": "acme-demo",
    "name": "ACME 演示应用",
    "signPublicKey": "-----BEGIN PUBLIC KEY-----\n…(host.pub 内容)…\n-----END PUBLIC KEY-----",
    "webhookUrl": "http://localhost:9300/ia/webhook",
    "webhookSecret": "whsec-9f2c1ab77d"
  }'

# 工具注册条目(endpointUrl 必须与 demo 后端 act.audiences 一致):
curl -s -X POST "http://localhost:18090/ia/api/v1/admin/tools" \
  -H "X-IA-Admin-Key: ${IA_ADMIN_KEY}" -H 'Content-Type: application/json' -d '{
  "serverKey": "acme-demo", "toolName": "create_ticket",
  "description": "在 ACME 宿主系统中创建一张工单",
  "riskLevel": "low", "source": "host_app",
  "endpointUrl": "http://localhost:9300/ia-mcp",
  "parametersSchema": "{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\",\"description\":\"工单标题\"},\"description\":{\"type\":\"string\"},\"priority\":{\"type\":\"string\"}}}"
}'
```

> 总览页(`/ia/overview`)会实时自检:应用是否已注册、`signKeyFingerprint` 是否与本地公钥配对。也可直接调 demo 后端的说明性封装 `InnerAgentAdminClient`(Swagger 可见)。

### 2. 宿主后端(Java 21,端口 9300)

```bash
cd acme-demo/backend
IA_SERVER_BASE=http://localhost:18090 \
IA_APP_KEY=acme-demo \
IA_SIGN_PRIVATE_KEY="$(cat host.key)" \
IA_WEBHOOK_SECRET=whsec-9f2c1ab77d \
IA_ADMIN_KEY=<你的 IA_ADMIN_KEY> \
mvn spring-boot:run
```

- 启动日志应有 starter 桥的注册行(3 个宿主工具 @ /ia-mcp);
- Swagger 调试页:<http://localhost:9300/swagger-ui.html>。

### 3. 宿主前端(Node 20.19+/22.12+,pnpm)

```bash
cd acme-demo/frontend
pnpm install
pnpm dev        # http://localhost:9203,/api 代理到 :9300,/ia 代理到 :18090
```

页面(登录:任意用户名即进,演示轻登录;后端分配稳定数字用户 ID 作为 embed token 的 sub):

- `/ia/overview` 接入流程总览(五步 + 管理面开通状态自检 + 「指南章节↔代码位置」映射表)
- `/ia/embed` InnerAgent 嵌入演示(WC 直挂 + iframe postMessage 两种模式切换 + 握手日志)
- `/ia/tools` 工具调用演示(建单两条通道:表单直建 / 对助手说经确认卡走 /ia-mcp 桥;底部 Webhook 事件流)

**端到端体验闭环**:在 `/ia/embed` 选 WC 模式挂载 → 对助手说「帮我建一张工单,标题是…」→ 确认卡批准(WRITE 工具)→ `/ia/tools` 列表实时出现 channel=agent 的记录。

### Webhook 联调

管理面把应用的 webhook 配到 `http://<宿主可达地址>:9300/ia/webhook`,事件白名单 `run.finished/run.failed/run.cancelled`,可用 `POST /ia/api/v1/admin/webhooks/config/test` 做真实签名单发验证。收到的事件出现在 `/ia/tools` 底部事件流(按 `X-IA-Delivery` 幂等)。

## 与 examples/demo-host 的定位差异

| | 本 DEMO(acme-demo) | examples/demo-host |
| --- | --- | --- |
| 视角 | **第三方宿主应用**:有自己的登录态、后端与业务工具 | InnerAgent 自带的纯静态联调页 |
| embed token | 宿主后端真签(RS256 私钥) | 依赖 server `local` profile 匿名演示头(X-IA-Demo-User / tokenGetter 恒 null) |
| 工具 | 宿主 @IaTool 业务工具经 /ia-mcp 桥暴露 | 无宿主工具 |
| 用途 | 接入方照抄的实现骨架 | server 侧快速冒烟 |

## 边界说明(生产必读)

- 演示登录是**假的**——`POST /api/demo/login` 任意用户名即发会话。生产必须换成宿主真实鉴权,embed token 只签给已认证用户(接入指南 §2-⑤)。
- 后端全内存态(会话/工单/事件),重启即清;生产按需持久化。
- `IA_SIGN_PRIVATE_KEY`/`IA_WEBHOOK_SECRET`/`IA_ADMIN_KEY` 只存在于后端环境变量;前端拿到的只有短时效 embed token。`ia.webhook-secret` 未配置时 `/ia/webhook` 统一 503(运维问题不尝试验签)。
- `act.audiences`(yml)= 管理面注册工具的 `endpointUrl`,错配即 `/ia-mcp` 全量 401(fail-closed)——排障口诀见接入指南步骤③。
- iframe 模式的安全决策(token 不入 URL、origin allowlist、CSP)见 `examples/iframe-host/README.md`;生产建议给 iframe 加显式 `sandbox` 并按部署域配 allowedOrigins。
- SDK vendor 产物升级方式:`cd sdk-js && pnpm build`,用新 dist 覆盖 `frontend/src/vendor/inneragent/inneragent-chat.js`、`frontend/src/vendor/inneragent/iframe-host.js` 与 `frontend/public/ia/iframe-child.js`,并同步同目录 `.d.ts`。

## 下一步(真机联调清单)

- [ ] 起 InnerAgent server(18090),管理面完成应用/工具注册(见上文 §1)
- [ ] `/ia/overview` 开通状态显示「应用已注册」且指纹一致
- [ ] `/ia/embed` WC 模式挂载,对话发起 run(SSE 流)
- [ ] 写工具确认闭环:确认卡四档行为、`/ia/tools` 出现 agent 通道工单、审计可查 `live-confirm`
- [ ] 管理面 `webhooks/config/test` 通,`/ia/tools` 事件流出现 run 终态
- [ ] 紧急停用演练:停用后新 run 403、resume 恢复(接入指南 §6.2)
