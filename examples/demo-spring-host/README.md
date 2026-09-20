# demo-spring-host — P1 出口验收演示宿主

最小 Spring Boot 宿主(开发计划 §2.6「公共测试资产」的 Spring Boot 形态):
**接入面 = 1 条 starter 依赖 + 本 yaml + 6 个 `@IaTool` 工具方法**。

- 技术栈:Spring Boot 3.5.14 / Java 21 / 端口 `18091`
- 依赖:`com.inneragent:inneragent-spring-boot-starter:0.1.0-SNAPSHOT` + `spring-boot-starter-web`
- 工具(`src/main/java/com/inneragent/demo/host/tool/DemoHostTools.java`,非 bean,经 `tool-packages` 扫描):

| 工具 | 风险 | 行为 |
| --- | --- | --- |
| `get_host_time` | READ | 返回宿主进程当前时间(P0/M0 只读直通用) |
| `create_host_record` | WRITE | 内存 Map 落一条记录并返回 `rec-N`(U1 写+确认用) |
| `get_product_brief` | READ | 查内存商品表的商品简介与版本号(U2 读,直通) |
| `update_product_brief` | WRITE | 更新商品简介,版本 +1 并留版本历史(U2 写+确认) |
| `copy_flow_template` | WRITE | 源模板复制为新模板,可追加节点;重名返回 `conflict`/409(U3 写+确认) |
| `list_login_records` | READ | 登录记录查询,支持 userId 过滤与天数窗口(U5 只读直通) |

- 观测端点:`GET /ia-demo/state` → 记录、商品(含版本历史)、流程模板、调用计数、
  最近一次验签后 act claims(验收断言用,非产品功能)。

## 关键配置(aud 对齐)

```yaml
inneragent:
  bridge:
    server-base: http://localhost:18090          # InnerAgent 主服务(JWKS 拉取)
    tool-packages: [com.inneragent.demo.host.tool]
    act:
      audiences:
        - http://localhost:18091/ia-mcp          # = 注册进主服务的 endpoint_url!
```

`act.audiences` **必须**包含工具注册进 `ia_tool_registry` 时写的
`endpoint_url`(主服务 `McpClientToolInvoker` 按它签发 act token 的 aud;
宿主 Filter 精确匹配)。starter 默认占位值 `ia-mcp` 不作数,错配即全量 401。

## 起环境(4 步)

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)

# 0) starter SNAPSHOT 进本地仓库(首次)
mvn -f inneragent-starter/pom.xml install -DskipTests

# 1) 起库(PG 15432 / Redis 16379)
docker compose -f docker/dev-compose.yml up -d

# 2) 起主服务 18090(带管理面密钥)
cd inneragent-server && IA_ADMIN_KEY=test-key mvn spring-boot:run

# 3) 起本宿主 18091
mvn -f examples/demo-spring-host/pom.xml spring-boot:run

# 4) 注册两个工具进 ia_tool_registry(endpoint_url 即 act.audiences 的值)
curl -s -X POST http://localhost:18090/ia/api/v1/admin/tools \
  -H 'X-IA-Admin-Key: test-key' -H 'Content-Type: application/json' \
  -d '{"serverKey":"demo-spring-host","toolName":"get_host_time",
       "description":"查询宿主进程当前时间(演示只读工具)","riskLevel":"low",
       "source":"host_app","endpointUrl":"http://localhost:18091/ia-mcp",
       "parametersSchema":"{\"type\":\"object\",\"properties\":{\"zone\":{\"type\":\"string\",\"description\":\"IANA 时区,缺省宿主时区\"}}}"}'

curl -s -X POST http://localhost:18090/ia/api/v1/admin/tools \
  -H 'X-IA-Admin-Key: test-key' -H 'Content-Type: application/json' \
  -d '{"serverKey":"demo-spring-host","toolName":"create_host_record",
       "description":"在宿主内存中创建一条记录并返回记录 id(演示写工具)","riskLevel":"medium",
       "source":"host_app","endpointUrl":"http://localhost:18091/ia-mcp",
       "parametersSchema":"{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\",\"description\":\"记录标题\"},\"content\":{\"type\":\"string\",\"description\":\"记录内容\"}},\"required\":[\"title\"]}"}'
```

## 跑旅程

```bash
scripts/e2e-host-journey.sh          # U1:全自动起环境(可跳)→ 注册 → 批准/拒绝双路径 → 断言
scripts/e2e-m1-journeys.sh           # M1 U2/U3/U5:商品简介批准 / 模板复制拒绝 / 登录记录直通
IA_JOURNEY_SKIP_START=1 scripts/e2e-m1-journeys.sh    # 复用已起的三进程
```

旅程脚本同时落证据:SSE 事件(`target/` 下工作目录)、宿主 `/ia-demo/state`、
`ia_audit_log` / `ia_tool_registry` psql 查询。失败非零退出,FAIL 行即缺陷证据。

## 冒烟测试(不起主服务)

```bash
mvn -f examples/demo-spring-host/pom.xml test
```

9 个用例:上下文启动 + 桥内六工具注册数断言;带验签 act token 的
`tools/call`(U1 记录写、U2 商品简介读/写+版本历史、U3 模板复制+409 冲突、
U5 登录记录过滤)在宿主进程内执行(内存仓 + claims 观测);
匿名 401 fail-closed;错 aud(占位 `ia-mcp`)401。
act 验签用本地测试 JWKS(stub `server-base`),aud 使用生产同值
`http://localhost:18091/ia-mcp`。
