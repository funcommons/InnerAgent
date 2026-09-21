package com.inneragent.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpServerConfigMapper;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.platform.tenant.TenantContext;
import com.inneragent.server.auth.act.ActTokenIssuer;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpTransportException;
import io.modelcontextprotocol.spec.McpTransportSessionNotFoundException;
import lombok.extern.slf4j.Slf4j;

import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@link McpToolInvoker} 的真实 MCP 客户端实现(P1-T2b [new],宿主桥)。
 *
 * <p>打通「内核工具调用 → 宿主 MCP server」链路(spike ③→设计映射的
 * McpToolAdapter 行):
 * <ol>
 *   <li>按 (appId, endpointUrl) 维护 {@link McpSyncClient} 缓存(懒连接;
 *       注册变更经 {@code ToolCatalogInvalidator} 链路触发
 *       {@link #invalidateApp(long)} / {@link #invalidateAll()},close 客户端);</li>
 *   <li>invoke 时组 {@link ActTokenIssuer.ActTokenRequest}(audience =
 *       ia_tool_registry.endpoint_url,claims 含 userId/tenantId/toolName),
 *       act token 经 {@code httpRequestCustomizer} 注入 {@code X-IA-Act}
 *       (每调用上下文走 {@code transportContextProvider} + 调用线程
 *       ThreadLocal,shared client 并发安全,spike T05);</li>
 *   <li>{@code callTool} → 结构化结果(structuredContent 优先,退化
 *       content 文本聚合)转 payloadJson;宿主工具错误(isError)按端口契约
 *       返回 error=true,不抛异常;</li>
 *   <li>错误细分:401/403 → {@link McpToolAuthException},超时 →
 *       {@link McpToolTimeoutException},断连/会话失效 →
 *       {@link McpToolTransportException};后者触发重连编排(单飞锁 +
 *       指数退避 → 重建客户端/新会话 → 重试一次)。</li>
 * </ol>
 *
 * <p><strong>与 spike FINDINGS 的偏差(R1 实现形态)</strong>:spike 在 mcp 2.0.1
 * 上验证「对同实例 {@code initialize()} 即可恢复」;本工程钉在 0.17.0,其
 * {@code LifecycleInitializer.handleException} 已内建「session-not-found → 自动
 * 复位 + 隐式重初始化」,与外部显式 {@code initialize()} 并发时后初始化通知
 * 会话缺失(400 Session ID required)。故 0.17.0 形态的恢复动作 = 单飞锁内
 * <em>重建客户端</em>(新传输/新会话、干净 initialize),编排语义
 * (检测→单飞→退避→恢复→重试一次)与任务规格一致。
 */
@Slf4j
public class McpClientToolInvoker implements McpToolInvoker {

    /** 每调用传输上下文键:X-IA-Act 头的 token 值。 */
    static final String CTX_ACT_TOKEN = "ia.actToken";

    /** X-IA-Act 自定义头(02-技术方案 §6.1;不占用 Authorization)。 */
    static final String ACT_HEADER = "X-IA-Act";

    /** 调用线程携带的本次 act token(McpSyncClient 阻塞壳 ⇒ 调用同线程取值)。 */
    private static final ThreadLocal<String> CALL_ACT_TOKEN = new ThreadLocal<>();

    /** 传输层错误消息中的 HTTP 状态码(0.17.0 传输不分型,spike R5)。 */
    private static final Pattern STATUS_CODE = Pattern.compile("(?i)code:?\\s*(\\d{3})\\b");

    /** 宿主错误 JSON 体中的状态字段(Spring Boot 默认错误体形态)。 */
    private static final Pattern JSON_STATUS_40X =
            Pattern.compile("(?i)\"(?:status|statuscode)\"\\s*[:=]\\s*\"?(40[13])\"?");

    /**
     * [P4-W13] 目录 FQN 解析:{@code mcp__<serverKey>__<toolName>}(serverKey
     * 字符集同注册口径,不含下划线 → 首个 {@code __} 段即 serverKey,确定性解析)。
     */
    private static final Pattern FQN = Pattern.compile("^mcp__([A-Za-z0-9-]{1,64})__(.+)$");

    private final ToolRegistryMapper registryMapper;
    private final ActTokenIssuer actTokenIssuer;
    private final ObjectMapper objectMapper;
    private final McpInvokerProperties properties;
    /** [P4-W13] 三方服务器配置定位(应用级;null=传统构造,三方解析不可用)。 */
    private final McpServerConfigMapper thirdPartyAppMapper;
    /** [P4-W13] 三方服务器配置定位(用户级;行级 userId 隔离)。 */
    private final McpUserServerMapper thirdPartyUserMapper;

    /** (appId + endpointUrl) → 客户端句柄(懒建懒连)。 */
    private final Cache<String, ClientHandle> clients;

    /** 每客户端的重连单飞锁(R1:并发失败只允许一位执行退避 + re-init)。 */
    private final ConcurrentHashMap<String, ReentrantLock> reconnectLocks = new ConcurrentHashMap<>();

    /** [adapt] 任务 #18b(W5):MCP client span 工厂(null=noop 旁路)。 */
    private final com.inneragent.agent.observability.GenAiSpanFactory spanFactory;

    public McpClientToolInvoker(ToolRegistryMapper registryMapper,
                                ActTokenIssuer actTokenIssuer,
                                ObjectMapper objectMapper,
                                McpInvokerProperties properties) {
        this(registryMapper, actTokenIssuer, objectMapper, properties, null);
    }

    public McpClientToolInvoker(ToolRegistryMapper registryMapper,
                                ActTokenIssuer actTokenIssuer,
                                ObjectMapper objectMapper,
                                McpInvokerProperties properties,
                                com.inneragent.agent.observability.GenAiSpanFactory spanFactory) {
        this(registryMapper, actTokenIssuer, objectMapper, properties, spanFactory, null, null);
    }

    /** [P4-W13] 生产装配:带三方服务器配置定位(应用级 + 用户级)。 */
    public McpClientToolInvoker(ToolRegistryMapper registryMapper,
                                ActTokenIssuer actTokenIssuer,
                                ObjectMapper objectMapper,
                                McpInvokerProperties properties,
                                com.inneragent.agent.observability.GenAiSpanFactory spanFactory,
                                McpServerConfigMapper thirdPartyAppMapper,
                                McpUserServerMapper thirdPartyUserMapper) {
        this.registryMapper = Objects.requireNonNull(registryMapper, "registryMapper must not be null");
        this.actTokenIssuer = Objects.requireNonNull(actTokenIssuer, "actTokenIssuer must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.spanFactory = spanFactory == null
                ? com.inneragent.agent.observability.GenAiSpanFactory.noop()
                : spanFactory;
        this.thirdPartyAppMapper = thirdPartyAppMapper;
        this.thirdPartyUserMapper = thirdPartyUserMapper;
        this.clients = Caffeine.newBuilder()
                .maximumSize(properties.getMaxClients())
                .expireAfterAccess(properties.getClientExpireAfterAccess())
                .build();
    }

    // ------------------------------------------------------------------
    // McpToolInvoker 端口
    // ------------------------------------------------------------------

    @Override
    public String toString() {
        return "McpClientToolInvoker(host bridge, clients=" + clients.estimatedSize() + ")";
    }

    /**
     * 调用一次 MCP 工具(tools/call;宿主桥或三方,按名称解析路由)。
     *
     * <p>[P4-W13] 名称形态二分:{@code mcp__<serverKey>__<tool>}(目录 FQN,
     * AgentScopeMcpToolAdapter 下发)先查宿主注册表(裸名;host 语义零变化),
     * 未命中则按 serverKey 定位三方服务器配置(应用级 → 用户级,行级 userId
     * 隔离),静态头直连——<strong>三方调用不携带 X-IA-Act</strong>(act token
     * 仅限宿主桥内环,02-技术方案 §6.1);裸名(宿主路径与存量调用方)行为
     * 与 P4 前完全一致。
     *
     * @throws McpToolCallException 未注册/端点未配置/鉴权/超时/传输失败(细分子类)
     */
    @Override
    public McpToolInvocationResult invoke(
            long appId,
            String toolName,
            Map<String, Object> args,
            ToolExecutionContext actContext) {
        ParsedName parsed = parseName(toolName);
        ToolRegistryEntry entry = registryEntryOrNull(appId, parsed.toolName());
        String serverKey;
        String clientKey;
        ClientHandle handle;
        if (entry != null) {
            String endpointUrl = requireEndpoint(entry);
            serverKey = entry.getServerKey();
            clientKey = clientKey(appId, endpointUrl);
            // act token 每次调用现签(audience=endpoint_url,exp 60s):先于客户端
            // 获取(懒建客户端的 initialize 也要携带 X-IA-Act)经 ThreadLocal 传给
            // transportContextProvider → httpRequestCustomizer 注入;重连发生在
            // 调用线程内,同管线携带头(spike T03 挂点实证)
            CALL_ACT_TOKEN.set(actTokenIssuer.issue(new ActTokenIssuer.ActTokenRequest(
                    actContext == null ? 0L : actContext.userId(),
                    actContext == null ? 0L : actContext.tenantId(),
                    null,
                    // [adapt] U1/D1:运行身份沿 ToolExecutionContext.runId 透传
                    // (act.sub=inneragent-run:{runId};内核工具适配器显式携带)
                    actContext == null ? null : actContext.runId(),
                    entry.getFqn(),
                    endpointUrl)));
            handle = clients.get(clientKey, key -> createClient(key, endpointUrl, entry));
        } else {
            ThirdPartyTarget target = thirdPartyTarget(appId, parsed, actContext, toolName);
            serverKey = parsed.serverKey();
            clientKey = target.clientKey();
            // 三方:静态头在客户端构建时捕获,无 act token(见 ThirdPartyTarget)
            handle = clients.get(clientKey, key -> createThirdPartyClient(
                    key, target.endpointUrl(), target.headers(), target.timeoutSeconds()));
        }
        // [adapt] 任务 #18b(W5):MCP client span(tools/call)。
        com.inneragent.agent.observability.GenAiSpanFactory.GenAiSpan span =
                startMcpClientSpan(serverKey, toolName, args, actContext);
        try {
            // callTool 用裸工具名(FQN 只是目录/白名单命名空间;宿主与三方
            // server 端注册的都是裸名)
            McpToolInvocationResult result =
                    invokeWithReconnect(handle, clientKey, parsed.toolName(), args);
            if (span != null) {
                span.end();
            }
            return result;
        } catch (RuntimeException failure) {
            if (span != null) {
                span.error(failure);
                span.end();
            }
            throw failure;
        } finally {
            CALL_ACT_TOKEN.remove();
        }
    }

    /**
     * [adapt] 任务 #18b(W5):MCP client span(对齐 MCP semconv 的
     * mcp.method.name=tools/call;属性 mcp.tool.name + server.key;
     * 入参 JSON 为内容属性,默认关)。
     */
    private com.inneragent.agent.observability.GenAiSpanFactory.GenAiSpan startMcpClientSpan(
            String serverKey,
            String toolName,
            Map<String, Object> args,
            ToolExecutionContext actContext) {
        if (spanFactory.isNoop()) {
            return null;
        }
        try {
            return spanFactory
                    .spanBuilder(com.inneragent.agent.observability.GenAiSemanticAttributes
                            .Operations.MCP_TOOLS_CALL)
                    .attr(com.inneragent.agent.observability.GenAiSemanticAttributes.OPERATION_NAME,
                            com.inneragent.agent.observability.GenAiSemanticAttributes
                                    .Operations.MCP_TOOLS_CALL)
                    .attr(com.inneragent.agent.observability.GenAiSemanticAttributes.TOOL_NAME,
                            toolName)
                    .attr(com.inneragent.agent.observability.GenAiSemanticAttributes.MCP_SERVER_KEY,
                            serverKey)
                    .attr(com.inneragent.agent.observability.GenAiSemanticAttributes.RUN_ID,
                            actContext == null ? null : actContext.runId())
                    .contentAttr(com.inneragent.agent.observability.GenAiSemanticAttributes.PROMPT,
                            args == null ? null : objectMapper.writeValueAsString(args))
                    .startSpan();
        } catch (Exception spanFailure) {
            log.debug("MCP client span start skipped: {}", spanFailure.toString());
            return null;
        }
    }

    // ------------------------------------------------------------------
    // 缓存失效(注册变更挂钩 ToolCatalogInvalidator → McpToolCatalog 委托)
    // ------------------------------------------------------------------

    /** 注册表变更后关闭并清除该应用的全部宿主客户端(下次调用懒重建)。 */
    public void invalidateApp(long appId) {
        String prefix = appId + "|";
        clients.asMap().keySet().removeIf(key -> {
            if (!key.startsWith(prefix)) {
                return false;
            }
            closeAndRemove(key);
            return true;
        });
    }

    /** 全量失效(应用删除等场景)。 */
    public void invalidateAll() {
        clients.asMap().keySet().forEach(this::closeAndRemove);
        reconnectLocks.clear();
    }

    private void closeAndRemove(String key) {
        ClientHandle removed = clients.asMap().remove(key);
        closeQuietly(removed == null ? null : removed.client(), key);
    }

    // ------------------------------------------------------------------
    // 调用与重连编排(R1)
    // ------------------------------------------------------------------

    private McpToolInvocationResult invokeWithReconnect(
            ClientHandle handle, String clientKey, String toolName, Map<String, Object> args) {
        int attempt = 0;
        ClientHandle current = handle;
        while (true) {
            try {
                return callTool(current.client(), toolName, args);
            } catch (Exception failure) {
                McpToolCallException mapped = mapFailure(failure);
                if (!(mapped instanceof McpToolTransportException transport)
                        || attempt >= properties.getReconnect().getMaxAttempts()) {
                    throw mapped;
                }
                attempt++;
                log.warn("宿主调用传输失败,进入重连编排(attempt={}/{}): key={}, tool={}, cause={}",
                        attempt, properties.getReconnect().getMaxAttempts(),
                        clientKey, toolName, String.valueOf(transport.getMessage()));
                reconnectSingleFlight(current, clientKey, attempt);
                // 重连后取当前句柄(可能是重建的客户端;被并发清理则兜底重建)
                ClientHandle previous = current;
                current = clients.get(clientKey, key -> rebuild(clientKey, previous));
            }
        }
    }

    /**
     * 单飞重连:同客户端只允许一位调用者执行「指数退避 + 客户端重建」;
     * 并发失败者在锁上等待,若等待期间他人已恢复(恢复时间晚于自身失败时间)
     * 则直接返回重试。
     */
    private void reconnectSingleFlight(ClientHandle handle, String clientKey, int attempt) {
        ReentrantLock lock = reconnectLocks.computeIfAbsent(clientKey, key -> new ReentrantLock());
        long failedAt = System.currentTimeMillis();
        lock.lock();
        try {
            if (handle.lastRecoveredAtMillis() > failedAt) {
                log.debug("并发调用者已完成重连,直接重试: key={}", clientKey);
                return;
            }
            Duration backoff = backoff(attempt);
            if (!backoff.isZero() && !backoff.isNegative()) {
                try {
                    Thread.sleep(backoff.toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new McpToolTransportException("重连等待被中断: " + clientKey, interrupted);
                }
            }
            try {
                // 恢复 = 单飞重建客户端(新传输/新会话,干净 initialize)。
                // 说明:spike(2.0.1)验证的「同实例 re-initialize」在 0.17.0 上
                // 与 SDK 内建的隐式重初始化(LifecycleInitializer.handleException
                // 对 session-not-found 自动复位)并发抢跑,后初始化通知会话缺失
                // 报 400;重建是确定性恢复路径(见类注释偏差记录)。
                closeAndRemove(clientKey);
                ClientHandle rebuilt = rebuild(clientKey, handle);
                clients.put(clientKey, rebuilt);
                handle.markRecovered();
                log.info("宿主会话已恢复(重连编排:客户端重建): key={}, attempt={}", clientKey, attempt);
            } catch (Exception recoveryFailure) {
                throw new McpToolTransportException(
                        "宿主重连失败(re-initialize): " + clientKey + ", cause=" + recoveryFailure.getMessage(),
                        recoveryFailure);
            }
        } finally {
            lock.unlock();
        }
    }

    /** 指数退避:initial × 2^(attempt-1),封顶 maxBackoff。 */
    Duration backoff(int attempt) {
        long initial = Math.max(0L, properties.getReconnect().getInitialBackoff().toMillis());
        long capped = Math.min(properties.getReconnect().getMaxBackoff().toMillis(), Long.MAX_VALUE / 2);
        long value = initial;
        for (int i = 1; i < attempt && value < capped; i++) {
            value = Math.min(value * 2, capped);
        }
        return Duration.ofMillis(Math.min(value, capped));
    }

    /** 句柄重建(重连编排共用):三方(静态头)与宿主(注册表条目)分支。 */
    private ClientHandle rebuild(String clientKey, ClientHandle previous) {
        if (!previous.staticHeaders().isEmpty()) {
            return createThirdPartyClient(clientKey, previous.endpointUrl(),
                    previous.staticHeaders(), previous.timeoutSeconds());
        }
        return createClient(clientKey, previous.endpointUrl(), previous.entry());
    }

    // ------------------------------------------------------------------
    // 客户端创建 / 调用
    // ------------------------------------------------------------------

    /**
     * 客户端构建 seam(protected:测试注入 mock 客户端,验证重连编排/错误映射)。
     * 生产实现:Streamable HTTP 传输 + act token 挂点 + 首次 initialize(懒连接,
     * 失败按细分异常上抛,不缓存半失效客户端)。
     */
    protected ClientHandle createClient(String clientKey, String endpointUrl, ToolRegistryEntry entry) {
        URI uri = URI.create(endpointUrl);
        String base = uri.getScheme() + "://" + uri.getRawAuthority();
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(base)
                .endpoint(path)
                // 宿主桥按无状态形态承载(FINDINGS §2.5 裁定:stateless /ia-mcp 兼容
                // 两代客户端;无 GET SSE 通道)→ 关闭可恢复流与启动即连接,
                // callTool 应答走 POST 本响应,不依赖 GET 流
                .resumableStreams(false)
                .openConnectionOnStartup(false)
                .httpRequestCustomizer(this::applyActHeader)
                .build();
        McpSyncClient client = McpClient.sync(transport)
                .requestTimeout(properties.getCallTimeout())
                // 每请求上下文:调用线程 ThreadLocal 的 act token(spike T03 挂点②)
                .transportContextProvider(this::callTransportContext)
                .build();
        try {
            client.initialize();
        } catch (Exception initializeFailure) {
            try {
                client.close();
            } catch (RuntimeException ignored) {
                // 首次初始化失败为主因,close 失败不吞
            }
            throw mapFailure(initializeFailure);
        }
        log.info("宿主 MCP 客户端已建立: key={}, endpoint={}, serverKey={}",
                clientKey, endpointUrl, entry.getServerKey());
        return new ClientHandle(client, endpointUrl, entry);
    }

    /** transportContextProvider 回调:取调用线程的 act token 组装传输上下文。 */
    private McpTransportContext callTransportContext() {
        String token = CALL_ACT_TOKEN.get();
        return McpTransportContext.create(
                Map.of(CTX_ACT_TOKEN, token == null ? "" : token));
    }

    /** httpRequestCustomizer 回调:把传输上下文中的 act token 注入 X-IA-Act 头。 */
    private void applyActHeader(HttpRequest.Builder builder, String method, URI uri,
                                String body, McpTransportContext context) {
        if (context == null) {
            return;
        }
        Object token = context.get(CTX_ACT_TOKEN);
        if (token instanceof String value && !value.isEmpty()) {
            builder.header(ACT_HEADER, value);
        }
    }

    /**
     * [P4-W13] 三方客户端构建(protected seam,测试可桩):Streamable HTTP +
     * 静态头逐请求注入(httpRequestCustomizer 捕获常量映射;<strong>不带
     * X-IA-Act</strong>——act token 仅限宿主桥内环)。凭据值不落日志。
     */
    protected ClientHandle createThirdPartyClient(
            String clientKey, String endpointUrl, Map<String, String> staticHeaders,
            int timeoutSeconds) {
        URI uri = URI.create(endpointUrl);
        String base = uri.getScheme() + "://" + uri.getRawAuthority();
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(base)
                .endpoint(path)
                .resumableStreams(false)
                .openConnectionOnStartup(false)
                .httpRequestCustomizer((builder, method, requestUri, body, context) ->
                        staticHeaders.forEach(builder::header))
                .build();
        McpSyncClient client = McpClient.sync(transport)
                .requestTimeout(Duration.ofSeconds(timeoutSeconds))
                .build();
        try {
            client.initialize();
        } catch (Exception initializeFailure) {
            try {
                client.close();
            } catch (RuntimeException ignored) {
                // 首次初始化失败为主因,close 失败不吞
            }
            throw mapFailure(initializeFailure);
        }
        log.info("三方 MCP 客户端已建立: key={}, endpoint={}, staticHeaders={}(值不落日志)",
                clientKey, endpointUrl, staticHeaders.isEmpty() ? 0 : staticHeaders.keySet());
        return new ClientHandle(client, endpointUrl, null, Map.copyOf(staticHeaders), timeoutSeconds);
    }

    private McpToolInvocationResult callTool(McpSyncClient client, String toolName, Map<String, Object> args) {
        McpSchema.CallToolResult result = client.callTool(McpSchema.CallToolRequest.builder()
                .name(toolName)
                .arguments(args == null ? Map.of() : args)
                .build());
        String payloadJson = payloadJson(result);
        boolean failed = Boolean.TRUE.equals(result.isError());
        return failed
                ? McpToolInvocationResult.error(payloadJson)
                : McpToolInvocationResult.ok(payloadJson);
    }

    /**
     * 结果载荷:structuredContent 优先(结构化往返,spike T02);退化时把
     * content 文本聚合成 {@code {"text": ...}} 对象——payloadJson 恒为合法 JSON。
     */
    private String payloadJson(McpSchema.CallToolResult result) {
        try {
            Object structured = result.structuredContent();
            if (structured != null) {
                return objectMapper.writeValueAsString(structured);
            }
            List<String> texts = new ArrayList<>();
            if (result.content() != null) {
                result.content().forEach(content -> {
                    if (content instanceof McpSchema.TextContent text) {
                        texts.add(text.text());
                    }
                });
            }
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("text", String.join("\n", texts));
            return objectMapper.writeValueAsString(fallback);
        } catch (Exception serializationFailure) {
            throw new McpToolCallException(
                    "宿主工具结果序列化失败: " + serializationFailure.getMessage(), serializationFailure);
        }
    }

    // ------------------------------------------------------------------
    // 注册表 / 三方服务器定位(P4-W13 二分路由)
    // ------------------------------------------------------------------

    /** FQN 解析:mcp__<serverKey>__<tool> → (serverKey, 裸名);裸名 → (null, 原样)。 */
    static ParsedName parseName(String toolName) {
        if (toolName == null) {
            return new ParsedName(null, "");
        }
        Matcher matcher = FQN.matcher(toolName.trim());
        if (matcher.matches()) {
            return new ParsedName(matcher.group(1), matcher.group(2));
        }
        return new ParsedName(null, toolName.trim());
    }

    /** 三方调用定位结果(clientKey/端点/静态头/超时;headers 已捕获,凭据不落日志)。 */
    private record ThirdPartyTarget(
            String clientKey,
            String endpointUrl,
            Map<String, String> headers,
            int timeoutSeconds) {
    }

    record ParsedName(String serverKey, String toolName) {
    }

    /**
     * 三方服务器定位:应用级(ia_mcp_server_config,系统模式)优先,用户级
     * (ia_mcp_user_server,行级 userId 隔离)殿后;serverKey 为空或两级皆未
     * 命中 → 未注册异常(消息沿用宿主路径口径)。OAUTH 配置:501 语义
     * (注册层已拦截,此处防御性兜底)。
     */
    private ThirdPartyTarget thirdPartyTarget(
            long appId, ParsedName parsed, ToolExecutionContext actContext, String originalName) {
        if (parsed.serverKey() == null || thirdPartyAppMapper == null) {
            throw new McpToolCallException(
                    "工具未注册或未启用(appId=" + appId + "): " + originalName);
        }
        McpServerConfig appServer = TenantContext.runAsSystem(() ->
                thirdPartyAppMapper.selectList(new LambdaQueryWrapper<McpServerConfig>()
                                .eq(McpServerConfig::getAppId, appId)
                                .eq(McpServerConfig::getServerKey, parsed.serverKey())
                                .eq(McpServerConfig::getEnabled, true))
                        .stream()
                        .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                        .findFirst()
                        .orElse(null));
        if (appServer != null) {
            requireStaticHeaderApplicable(appServer.getAuthType(), parsed.serverKey());
            return new ThirdPartyTarget(
                    "tp|app|" + appId + "|" + parsed.serverKey(),
                    appServer.getEndpointUrl(),
                    staticHeaders(appServer.getHeaderName(), appServer.getCredentials()),
                    appServer.getTimeoutSeconds() == null ? 30 : appServer.getTimeoutSeconds());
        }
        Long userId = actContext == null ? null : actContext.userId();
        if (userId != null && thirdPartyUserMapper != null) {
            McpUserServer userServer = thirdPartyUserMapper.selectList(
                            new LambdaQueryWrapper<McpUserServer>()
                                    .eq(McpUserServer::getAppId, appId)
                                    .eq(McpUserServer::getUserId, userId)
                                    .eq(McpUserServer::getServerKey, parsed.serverKey())
                                    .eq(McpUserServer::getEnabled, true))
                    .stream()
                    .filter(row -> Boolean.TRUE.equals(row.getEnabled()))
                    .findFirst()
                    .orElse(null);
            if (userServer != null) {
                requireStaticHeaderApplicable(userServer.getAuthType(), parsed.serverKey());
                return new ThirdPartyTarget(
                        "tp|user|" + appId + "|" + userId + "|" + parsed.serverKey(),
                        userServer.getEndpointUrl(),
                        staticHeaders(userServer.getHeaderName(), userServer.getCredentials()),
                        userServer.getTimeoutSeconds() == null ? 30 : userServer.getTimeoutSeconds());
            }
        }
        throw new McpToolCallException(
                "工具未注册或未启用(appId=" + appId + "): " + originalName);
    }

    /** OAUTH 配置到达调用层:501 语义(注册层已拦截,防御性兜底)。 */
    private static void requireStaticHeaderApplicable(String authType, String serverKey) {
        if (McpThirdPartyServerSupport.AUTH_OAUTH.equals(authType)) {
            throw new McpToolCallException(
                    "三方 MCP OAuth(CIMD/DCR + RFC 8707)暂未实现(501 Not Implemented"
                            + " 语义): serverKey=" + serverKey);
        }
    }

    private static Map<String, String> staticHeaders(String headerName, String credentials) {
        if (headerName == null || headerName.isBlank()
                || credentials == null || credentials.isBlank()) {
            return Map.of();
        }
        return Map.of(headerName, credentials);
    }

    private ToolRegistryEntry registryEntryOrNull(long appId, String toolName) {
        if (toolName == null || toolName.isBlank()) {
            return null;
        }
        // [adapt] U1/D1:注册表定位按租户系统模式执行——ia_tool_registry 为
        // app 级治理表(V2 DDL 无 tenant_id 列),租户上下文存在时行级拦截器
        // 注入 tenant_id 条件会导致 SQL 报错;隔离维度是 app_id(显式携带)。
        return TenantContext.runAsSystem(
                () -> registryMapper.selectActiveByToolName(toolName.trim()));
    }

    private String requireEndpoint(ToolRegistryEntry entry) {
        String endpointUrl = entry.getEndpointUrl();
        if (endpointUrl == null || endpointUrl.isBlank()) {
            throw new McpToolCallException(
                    "工具未配置宿主端点(endpoint_url 为空,无法作为 act audience): " + entry.getFqn());
        }
        return endpointUrl.trim();
    }

    private static String clientKey(long appId, String endpointUrl) {
        return appId + "|" + endpointUrl;
    }

    /**
     * 异常细分(spike R5:0.17.0 传输不分型,按类型 + 消息/状态码归一):
     * 401/403 → 鉴权;超时 → 超时;连接失败/会话失效/断连 → 传输;其余 → 基类。
     */
    McpToolCallException mapFailure(Exception failure) {
        if (failure instanceof McpToolCallException known) {
            return known;
        }
        // SDK 异常常为薄壳("Client failed to initialize..."),HTTP 状态/根因
        // 深埋 cause 链(spike R5)→ 沿链聚合消息后再细分
        String aggregated = aggregateMessages(failure);
        String message = aggregated.toLowerCase(Locale.ROOT);
        Matcher status = STATUS_CODE.matcher(aggregated);
        Matcher jsonStatus = JSON_STATUS_40X.matcher(aggregated);
        while (status.find()) {
            int code = Integer.parseInt(status.group(1));
            if (code == 401 || code == 403) {
                return new McpToolAuthException("宿主鉴权失败(HTTP " + code + "): " + aggregated, failure);
            }
        }
        if (jsonStatus.find()) {
            return new McpToolAuthException(
                    "宿主鉴权失败(HTTP " + jsonStatus.group(1) + "): " + aggregated, failure);
        }
        if (message.contains("unauthorized") || message.contains("forbidden")) {
            return new McpToolAuthException("宿主鉴权失败: " + aggregated, failure);
        }
        if (inChain(failure, java.util.concurrent.TimeoutException.class)
                || inChain(failure, java.net.http.HttpTimeoutException.class)
                || message.contains("timeout on blocking")
                || message.contains("timed out")
                || message.contains("request timeout")) {
            return new McpToolTimeoutException(
                    "宿主调用超时(" + properties.getCallTimeout() + "): " + aggregated, failure);
        }
        boolean sessionLost = failure instanceof McpTransportSessionNotFoundException
                || (message.contains("session")
                    && (message.contains("terminat") || message.contains("not found")
                        || message.contains("does not recognize") || message.contains("invalid")));
        boolean connectionLost = inChain(failure, ConnectException.class)
                || message.contains("connection refused")
                || message.contains("failed to connect")
                || message.contains("connection reset")
                || message.contains("closedchannelexception");
        if (sessionLost || connectionLost
                || failure instanceof McpTransportException
                || message.contains("transport")) {
            return new McpToolTransportException("宿主传输失败: " + aggregated, failure);
        }
        return new McpToolCallException("宿主调用失败: " + aggregated, failure);
    }

    /** cause 链上任一环为给定类型(SDK 薄壳异常的根因在深层)。 */
    private static boolean inChain(Throwable failure, Class<? extends Throwable> type) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (type.isInstance(current)) {
                return true;
            }
            current = current.getCause();
            depth++;
        }
        return false;
    }

    /** 沿 cause 链聚合消息(SDK 薄壳异常的 HTTP 状态/根因在深层,spike R5)。 */
    private static String aggregateMessages(Throwable failure) {
        StringBuilder aggregated = new StringBuilder(messageOf(failure));
        Throwable current = failure;
        int depth = 0;
        while (current.getCause() != null && current.getCause() != current && depth < 8) {
            current = current.getCause();
            String causeMessage = messageOf(current);
            if (!messageOf(failure).equals(causeMessage)
                    && aggregated.indexOf(causeMessage) < 0) {
                aggregated.append(" | caused by ").append(causeMessage);
            }
            depth++;
        }
        return aggregated.toString();
    }

    private static String messageOf(Throwable failure) {
        return failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage();
    }

    private static void closeQuietly(McpSyncClient client, String key) {
        if (client == null) {
            return;
        }
        try {
            client.close();
            log.info("宿主 MCP 客户端已关闭(注册变更失效): key={}", key);
        } catch (RuntimeException closeFailure) {
            log.debug("宿主 MCP 客户端关闭失败(忽略): key={}, cause={}", key, closeFailure.getMessage());
        }
    }

    /** 缓存值:客户端 + 定位信息(重建用)+ 最近恢复时间(单飞「他人已恢复」判据)。 */
    static final class ClientHandle {

        private final McpSyncClient client;
        private final String endpointUrl;
        private final ToolRegistryEntry entry;
        /** [P4-W13] 三方静态头(非空 = 三方客户端,重建按此分支);凭据值不落日志。 */
        private final Map<String, String> staticHeaders;
        private final int timeoutSeconds;
        private volatile long lastRecoveredAtMillis;

        ClientHandle(McpSyncClient client) {
            this(client, null, null);
        }

        ClientHandle(McpSyncClient client, String endpointUrl, ToolRegistryEntry entry) {
            this(client, endpointUrl, entry, Map.of(), 30);
        }

        ClientHandle(McpSyncClient client, String endpointUrl, ToolRegistryEntry entry,
                     Map<String, String> staticHeaders, int timeoutSeconds) {
            this.client = Objects.requireNonNull(client, "client must not be null");
            this.endpointUrl = endpointUrl;
            this.entry = entry;
            this.staticHeaders = staticHeaders == null ? Map.of() : staticHeaders;
            this.timeoutSeconds = timeoutSeconds;
        }

        McpSyncClient client() {
            return client;
        }

        String endpointUrl() {
            return endpointUrl;
        }

        ToolRegistryEntry entry() {
            return entry;
        }

        Map<String, String> staticHeaders() {
            return staticHeaders;
        }

        int timeoutSeconds() {
            return timeoutSeconds;
        }

        long lastRecoveredAtMillis() {
            return lastRecoveredAtMillis;
        }

        void markRecovered() {
            this.lastRecoveredAtMillis = System.currentTimeMillis();
        }
    }
}
