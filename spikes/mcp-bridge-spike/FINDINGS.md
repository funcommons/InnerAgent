# FINDINGS — MCP 桥接 spike(P1-T2 去风险验证)

> 工程位置:`spikes/mcp-bridge-spike/`(完全独立 Maven 工程,Java 21,Spring Boot 3.5.16 仅用于提供真实嵌入式 Tomcat HTTP 宿主)
> 运行方式:`export JAVA_HOME=$(/usr/libexec/java_home -v 21) && mvn -f spikes/mcp-bridge-spike/pom.xml test`
> 结果:**Tests run: 19, Failures: 0, Errors: 0**(连跑两遍全绿)

---

## ① SDK 版本与坐标

| 项 | 值 | 证据 |
| --- | --- | --- |
| 坐标 | `io.modelcontextprotocol.sdk:mcp` | Maven Central metadata(2026-09-20 查证) |
| 当前最新稳定版 | **2.0.1**(2026-08-19 发布) | `maven-metadata.xml` `<release>2.0.1</release>`;测试 `T01_DependencyReachabilityTest.sdkJarCarriesPinnedVersion` |
| 2.x 模块结构 | `mcp` = 便捷聚合(mcp-core + mcp-json-jackson3);另有 `mcp-core`、`mcp-json-jackson2`、`mcp-json-jackson3`、`mcp-bom`、`mcp-test` | Maven Central artifact 目录 |
| 传输所在位置 | **Servlet 传输在 core 内**(`HttpServletStreamableServerTransportProvider` / `HttpServletStatelessServerTransport`);**Spring 传输(WebFlux/WebMVC)已移居 Spring AI 2.0**(`org.springframework.ai:mcp-spring-webmvc/webflux`),本工程未引入、classpath 上确认不存在 | `T01_DependencyReachabilityTest.springAiOwnedTransportsAreNotOnClasspath` |
| 客户端传输 | `HttpClientStreamableHttpTransport`(JDK HttpClient,零额外依赖,Streamable HTTP + resumable streams) | core 内,`T01` |
| 2.x 相对 0.x 的关键变化 | 服务端拆出 **Stateless 服务器线**(`McpStatelessSyncServer`/`McpStatelessServerFeatures`/`HttpServletStatelessServerTransport`)——技术方案 Q7 关心的「SDK 跟进 2026-07-28 无状态化」**已经落地** | core 类清单 + `T06` |

pom 采用:`mcp:2.0.1` + `spring-boot-starter-web:3.5.16`(版本由 `spring-boot-dependencies` BOM 管理)。无根 pom 卷入,无 Spring AI 依赖。

---

## ② 逐项验证结论

### 2.1 依赖可达 —— **可行**
- 测试:`T01_DependencyReachabilityTest`(4 个用例)
- Central 直连解析成功;版本钉在 2.0.1;桥所需全部类(客户端传输、两种 servlet 传输、Stateless 服务器、`ToolAnnotations`、`McpTransportContext`)都在这一个聚合 artifact 内;Java 21 + jakarta.servlet(Tomcat 10.1)满足。

### 2.2 client 侧 —— **可行(有一个必须自建的重连缺口)**
- **list tools(名称/schema/annotations)**:`McpSyncClient.listTools()` 返回 `Tool{name,title,description,inputSchema,outputSchema,annotations,meta}`;`ToolAnnotations{title,readOnlyHint,destructiveHint,idempotentHint,openWorldHint,returnDirect}` 全量往返不失真。测试 `T02_ClientListAndCallToolTest.listToolsExposesNamesSchemasAndAnnotations`。
- **call tool(结构化内容往返)**:`CallToolResult.builder().addTextContent(...).structuredContent(Map)` → 客户端 `result.structuredContent()` 还原为 Map,nonce/身份字段逐字节一致。读写两工具均验证:`T02.callToolReadReturnsStructuredContentWithIdentityAndNonce`、`T02.callToolWriteReturnsStructuredContent`。服务端默认开启入参 schema 校验(builder `validateToolInputs(false)` 可关)。
- **server 重启后恢复/重连**:SDK **没有自动重连/自动重初始化**。实测行为(测试打印,`T04_ServerRestartRecoveryTest.clientRecoversViaReInitializeAfterServerRestart`):
  - 停机期间调用 → 抛 `RuntimeException`(连接拒绝);
  - 重启后旧客户端调用 → 抛 **`MCP session with server terminated`**(传输层检测到会话失效,不会静默重建);
  - 恢复方式:**对既有 `McpSyncClient` 直接再调 `initialize()` 即可**(无需重建客户端);`closeGracefully()` 走 DELETE 关会话正常。
  - 另:传输层有「server 报 404 会话不存在 → 自动作废本地会话」的日志路径(`HttpClientStreamableHttpTransport` 源码),但**重初始化动作要调用方自己做**。
- **共享 client 实例并发线程安全**:**可行**。16 线程共享一个 `McpSyncClient` 并发 32 次 `tools/call`(每次 200ms 服务端延迟),零失败、零串话(nonce/身份逐请求匹配),服务端观测到并行执行(max in-flight > 1)。测试 `T05_SharedClientConcurrencyTest`。注意 `McpSyncClient` 是 Reactor 内核上的阻塞壳(源码证实无方法级锁),线程安全由请求 id 关联保证;每次调用占一个调用线程直到返回。

### 2.3 server 侧 —— **可行**
- **/ia-mcp 风格端点 + 真实 HTTP**:SDK 两种 servlet 传输都是普通 `jakarta.servlet.http.HttpServlet`,用 Spring Boot 的 `ServletRegistrationBean` 挂到嵌入式 Tomcat 即可(`/ia-mcp`、`/ia-mcp-stateless`)。无任何 Spring AI 依赖。测试:`T02`(整个类)、`T06_TwoGenerationCompatTest`。
- **无状态模式(每请求独立会话语义)**:SDK 原生提供 `HttpServletStatelessServerTransport` + `McpServer.sync(statelessTransport)`:`GET → 405`、无 `Mcp-Session-Id` 下发、`notifications/initialized` 后续消息**不是**功能前提(裸 JSON-RPC 直接 `tools/call` 即成功)、每请求独立处理。测试 `T06.rawStatelessJsonRpcClientWorksEndToEndWithoutSessions`、`T06.statelessEndpointHasNoGetStreamDependency`。
- **自定义头(X-IA-Act)可行挂点**:三段管线全部验证(`T03_ActHeaderPropagationTest`、`T06`):
  1. **客户端注入**:`HttpClientStreamableHttpTransport.builder().httpRequestCustomizer(...)`(每请求回调,可读 `McpTransportContext`;官方推荐配合 `McpClient.SyncSpec.transportContextProvider` 携带每调用上下文)——`X-IA-Act` 出现在每一个请求上;
  2. **服务端 Filter 挂点**:普通 `jakarta.servlet.Filter` 注册在传输 servlet 之前(`FilterRegistrationBean`),验签失败 401 fail-closed(无 token 请求实测 401,零泄漏)——MCP SDK 对此无感知,正是宿主正常 Filter 链形态;
  3. **身份进工具处理器**:传输 builder 的 **`contextExtractor`** 把 request attribute 提升为 `McpTransportContext`;stateful 处理器经 `McpSyncServerExchange.transportContext()` 读到,stateless 处理器**直接以参数** `McpTransportContext` 收到。测试断言 token 中的 `sub`/`runId` 逐字到达工具返回值。

### 2.4 schema 注解 —— **可行(生成方式 = 手工构建,无 POJO 映射器)**
- core SDK **不提供** POJO→JSON Schema 生成(那是 Spring AI 的 MCP Annotations 模块,技术方案已排除)。`Tool.builder(name, inputSchemaMap)` 接受手写 `Map<String,Object>`(或 `McpJsonMapper` + JSON 字符串)。starter 桥的 schema 来源 = 宿主 SPI `ToolExecutor#getParametersSchema`,**无生成器缺口**。
- **与「schema 指纹 sha256、活刷新分诊」的衔接**(`T07_SchemaFingerprintAndLiveRefreshTest`):
  - 服务端构造的 schema 与客户端 `listTools` 收到的 schema 做**规范化 JSON(递归排序键)sha256 指纹,两侧相等**——指纹可以跨线稳定计算,`ia_tool_registry` 直接对 list 结果建指纹;
  - schema 任何变化(新增必填参数)指纹必然改变;
  - **活刷新入口**:服务端 `addTool/removeTool` 在 `capabilities.tools(true)` 下自动推送 `tools/list_changed`,客户端 `McpClient.SyncSpec.toolsChangeConsumer(Consumer<List<Tool>>)` 收到;随后 `listTools()` 拿到新清单,可执行「纯增量自动接受 / 安全差异强制重确认」分诊。annotations(refresh 后 readOnlyHint 等)继续随清单返回,可作 `readOnlyHint true→false` 检测输入。

### 2.5 兼容两代客户端 —— **可行,且必须以无状态形态承载**
- 同一 **stateless 端点** 同时被两类调用方成功使用(`T06`):
  - **带会话的一代(2025-06-18 形态)**:SDK Streamable HTTP 客户端(会话感知)完整走 initialize → listTools → callTool,身份头正常贯通;
  - **无状态的一代(2026-07-28 形态)**:裸 JSON-RPC + JDK HttpClient,无会话头、无需持久 initialize 状态,直接 `tools/call` 成功;响应**不下发** `Mcp-Session-Id`。
- **反向不对称**(记录在案):sessionful 端点(`/ia-mcp` = `HttpServletStreamableServerTransportProvider`)对无会话请求直接拒绝——缺 `Mcp-Session-Id` 头 → HTTP 400("Session ID required"),头携带未知会话 → HTTP 404(源码 + `T06.statefulEndpointRejectsSessionlessCalls_documentingTheAsymmetry`)。
- **裁定**:`/ia-mcp` 按 **stateless 传输**实现即可同时服务两代客户端;S11/Q7 的桥端策略在 SDK 2.0.1 上成立。

---

## ③ 到 P1-T2 设计的映射

| P1-T2 设计件 | SDK 2.0.1 落点(已验证的 API) |
| --- | --- |
| **McpToolCatalog**(每宿主端点聚合工具清单) | 每个 serverKey 一个 `McpSyncClient`(`IaMcpClientFactory` 模式:`HttpClientStreamableHttpTransport.builder(baseUrl).endpoint(path)`);`listTools()` 拉清单 → `ia_tool_registry` 快照;FQN(`mcp__<serverKey>__<tool>`)在 catalog 层做,SDK 不参与命名 |
| **schema 指纹 sha256** | `SchemaFingerprints`(规范化 JSON + sha256)——对 `Tool.inputSchema()` 计算,跨线稳定(T07);`annotations` 并入分诊输入 |
| **活刷新分诊** | `toolsChangeConsumer` 接 `tools/list_changed`(T07)触发再 `listTools` 做差异分诊;**无状态宿主无推送通道**(见风险 R4),回退为周期性 `listTools` 比对指纹 |
| **McpToolAdapter**(远程工具调用 + 身份注入) | `callTool(CallToolRequest)`;身份注入 = `transportContextProvider`(每调用上下文 `ToolExecutionContext{appId,userId,tenantId,runId}`)→ `httpRequestCustomizer` 组 `X-IA-Act`(RS256 真实签名在 customizer 内完成,spike 用桩,机制同构,T03);超时 = `requestTimeout`;重试策略按 `readOnlyHint/idempotentHint` 在 adapter 层实现(SDK 不做业务重试) |
| **starter 职责②:MCP Server 桥** | 扫描 `ToolExecutorRegistry` → `Tool.builder(name, executor.getParametersSchema())` + 注解 → 注册进 `McpServer.sync(HttpServletStatelessServerTransport.builder().messageEndpoint("/ia-mcp").contextExtractor(...).build())`(stateless 形态,§2.5);`ServletRegistrationBean` 挂载;`capabilities.tools(true)` |
| **starter 职责③:act 验签 Filter + 上下文重建** | `ActTokenFilter`(普通 Jakarta Filter,401 fail-closed)+ `contextExtractor`(attribute → `McpTransportContext`)两段式(T03);工具处理器内由 context 重建 `ToolExecutionContext`。RS256/JWKS 验签属标准 JWT 库工作,与 SDK 零耦合(机制已由桩验证) |
| **starter 职责① token 签发 / ④ resolve_scope 占位** | 与 SDK 无关;不在本 spike 范围(`ActTokens` 仅模拟 claims 形状:iss/sub/act.sub/runId) |
| **错误映射(JSON status:error 沿用)** | `CallToolResult.isError()` + 服务端入参 schema 校验(默认开)产生协议级 error;adapter 把 `isError`/异常统一映射回 `status:error` |

---

## ④ Q1 裁定

## **确认(Confirmed)。**

官方 `io.modelcontextprotocol.sdk:mcp` 2.0.1 完整支撑 InnerAgent 宿主工具桥的全部五项技术前提:依赖单一可达、client 侧清单/调用/并发达标、server 侧无状态 /ia-mcp 可挂真实 Spring Boot Tomcat 且鉴权挂点齐备、schema 指纹与活刷新钩子原生存在、同一无状态端点兼容两代客户端。**不需要**启用备选方案(Spring AI MCP starter / 自实现 JSON-RPC 子集)。备选依赖链(03-计划风险表)可标记为「未触发」。

唯一需要 P1-T2 设计**自带**(SDK 不提供)的是:MCP 宿主重启后的**重连编排**(检测 `MCP session with server terminated`/连接异常 → 对既有 client `initialize()` + 指数退避;并发下需单飞锁)与无状态宿主的**活刷新轮询兜底**——两者都是 McpToolCatalog 内聚逻辑,协议面不变。

---

## ⑤ 风险清单

| # | 风险 | 实测/依据 | 缓解 |
| --- | --- | --- | --- |
| R1 | **客户端无自动重连**:server 重启后旧会话调用抛 `MCP session with server terminated`,SDK 不自动重初始化 | `T04` 实测行为 | McpToolCatalog 内建重连:捕获该异常/连接异常 → 单飞锁 + 指数退避 → 同实例 `initialize()`(实测可行) |
| R2 | **双 JSON 栈共存**:mcp 聚合包默认绑 Jackson 3(tools.jackson),Spring Boot 3.5 是 Jackson 2;classloader 两套并存 | pom 依赖树 | 功能无冲突(spike 全绿);如需统一,SDK 官方提供 `mcp-json-jackson2` 绑定模块可切换 |
| R3 | **阻塞壳吞吐**:McpSyncClient 每调用占线程直到返回 | `McpSyncClient` 源码(Reactor `.block()`) | §4.7 单宿主并发 8/QPS 20 规模下无压力(T05 16 并发无退化);后续高扇出可切 `McpAsyncClient`(同内核) |
| R4 | **无状态端点无法推送 `tools/list_changed`**(无 GET/SSE 通道)→ 活刷新分诊对 stateless 宿主失去推送 | 协议形态推定 + `HttpServletStatelessServerTransport` GET→405(`T06`) | 桥宿主为可信自有 starter,可改为「宿主另行暴露只读刷新回调」或客户端定时(如 5 分钟)指纹轮询;`readOnlyHint` 等安全分诊不受影响(每次调用清单均可取) |
| R5 | **错误码语义薄**:传输层把非 2xx 包装成异常,鉴权类有专门类型(`McpHttpClientTransportAuthorizationException`),其余不分型 | 传输源码 + `T03` | adapter 层按异常类型 + HTTP 状态细分(401 鉴权失败 / 404+`session terminated` 重连 / 4xx 参数错误) |
| R6 | **请求体上限**:传输 builder 有 `maxRequestSize`,超限 413 | 传输 builder API(`maxRequestSize(int)`) | starter 桥为图像生成等大参数工具显式调高;客户端 `maxResponseSize` 同理 |
| R7 | 注解仅是 hint(spec 定位),不可作为安全边界 | `ToolAnnotations` 语义 | 沿用方案 S11:仅可信宿主采信,三方一律确认(设计已如此) |
| R8 | stateful 端点对无会话请求 400/404 的行为细节属 SDK 内部实现,可能随版本微调 | 源码 + `T06`(断言放宽为 4xx) | 桥固定用 stateless 形态,不依赖该路径;契约测试钉住行为 |

## 工程备注
- `ActTokens` 为假 JWT(结构:spike-header.base64url(JSON payload).stub-signature),只模拟 claims 形状;RS256 签发/验签是标准件,不构成选型风险。
- `T04` 用时 ~32s,几乎全部是关闭后端口释放的重试等待(测试环境现象,非 SDK 行为)。
- 目录:`spikes/mcp-bridge-spike/`,构建独立,不触碰 inneragent-server/**、sdk-js/**、web/**、examples/**。
