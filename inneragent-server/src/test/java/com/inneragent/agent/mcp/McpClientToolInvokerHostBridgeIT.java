package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.platform.toolhub.ResolveScopeOutcome;
import com.inneragent.platform.toolhub.ResolveScopeRequest;
import com.inneragent.platform.toolhub.ResolveScopeService;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.inneragent.server.auth.act.ActTokenKeyManager;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.McpTransportContextExtractor;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.Servlet;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.catalina.Context;
import org.apache.catalina.LifecycleException;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.FilterDef;
import org.apache.tomcat.util.descriptor.web.FilterMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Files;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 宿主桥全链 IT(P1-T2b):嵌入式 Tomcat 宿主 MCP server(spike T02/T03 形态,
 * 无 Testcontainers)。双形态:stateless /ia-mcp(生产形态,FINDINGS §2.5 裁定)
 * 与 stateful(重启重连场景)。
 *
 * <p>宿主侧 Filter 以 JWKS 公钥(复用 {@link ActTokenKeyManager})对 X-IA-Act
 * 做 RS256 验签 + audience=endpoint_url 强校验后放行——完整验证 act 管线,
 * 而非 spike 桩令牌。IT 归 failsafe(mvn verify / -Dit.test 定向),不进 surefire。
 */
class McpClientToolInvokerHostBridgeIT {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    /** 探针类复用同一密钥(包内可见)。 */
    static final ActTokenKeyManager KEY_MANAGER = new ActTokenKeyManager(null, null);
    private static final ToolExecutionContext ACT_CONTEXT =
            new ToolExecutionContext(10001L, 1, 1L, 7L);
    private static final String ENDPOINT = "/ia-mcp";

    private static final List<AutoCloseable> RUNNING_SERVERS = new ArrayList<>();

    @AfterAll
    static void stopAllServers() {
        RUNNING_SERVERS.forEach(server -> {
            try {
                server.close();
            } catch (Exception ignored) {
                // 收尾失败不阻塞
            }
        });
        RUNNING_SERVERS.clear();
    }

    // ------------------------------------------------------------------
    // stateless 宿主:全链 / 退化载荷 / 工具错误 / 并发 / 401 / 超时 / 反查 / 失效
    // ------------------------------------------------------------------

    @Test
    @DisplayName("①invoke 全链:X-IA-Act 经宿主 RS256 验签,aud=endpoint_url,claims 到达工具")
    void fullChainCarriesVerifiedActTokenToHostTool() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("echo", true, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

            McpToolInvocationResult result = invoker.invoke(1L, "echo",
                    Map.of("query", "你好宿主", "nonce", 41L), ACT_CONTEXT);

            assertThat(result.error()).isFalse();
            JsonNode payload = MAPPER.readTree(result.payloadJson());
            assertThat(payload.get("status").asText()).isEqualTo("ok");
            assertThat(payload.get("query").asText()).isEqualTo("你好宿主");
            // act token claims 宿主侧还原(sub=终端用户;tenantId;act.sub=运行身份)
            assertThat(host.observatory.lastCallerSub).isEqualTo("10001");
            assertThat(host.observatory.lastTenantId).isEqualTo(7L);
            assertThat(host.observatory.lastActSub).startsWith(ActTokenIssuer.ACT_SUB_PREFIX);
            // audience 绑定 ia_tool_registry.endpoint_url(宿主 Filter 强校验后放行)
            assertThat(host.observatory.lastAudience).isEqualTo(entry.getEndpointUrl());
            assertThat(host.observatory.lastToolName).isEqualTo("mcp__host__echo");
            assertThat(host.observatory.actRejected.get()).isZero();

            // ⑪ V15 连接点:同一注册行(source=host_app)→ 目录注解可信采信
            McpToolCatalog catalog = new McpToolCatalog(
                    registryMapperOf(entry), Mockito.mock(ToolGrantService.class), MAPPER);
            Optional<com.inneragent.agent.mcp.McpToolCatalogEntry> catalogEntry =
                    catalog.find(1L, "echo");
            assertThat(catalogEntry).isPresent();
            assertThat(catalogEntry.orElseThrow().annotationsTrusted()).isTrue();
            assertThat(catalogEntry.orElseThrow().readOnlyEffective()).isTrue();
        }
    }

    @Test
    @DisplayName("④纯文本 content → 退化载荷 {\"text\": ...}(payloadJson 恒为合法 JSON)")
    void textOnlyContentFallsBackToTextPayload() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("text_only", false, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

            McpToolInvocationResult result = invoker.invoke(1L, "text_only", Map.of(), ACT_CONTEXT);

            assertThat(result.error()).isFalse();
            JsonNode payload = MAPPER.readTree(result.payloadJson());
            assertThat(payload.get("text").asText()).isEqualTo("plain-text-payload");
            assertThat(host.observatory.actValidated.get()).isPositive();
        }
    }

    @Test
    @DisplayName("③宿主工具错误(isError)→ error=true 回灌,不抛异常")
    void hostToolErrorReturnsErrorResult() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("fail_tool", false, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

            McpToolInvocationResult result = invoker.invoke(1L, "fail_tool", Map.of(), ACT_CONTEXT);

            assertThat(result.error()).isTrue();
            assertThat(result.payloadJson()).contains("boom");
            assertThat(host.observatory.actValidated.get()).isPositive();
        }
    }

    @Test
    @DisplayName("⑧并发调用:shared client 线程安全,身份不串话,宿主观测并行执行")
    void concurrentInvocationsShareClientSafely() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("echo", true, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(20));

            int callers = 12;
            ExecutorService pool = Executors.newFixedThreadPool(callers);
            try {
                CountDownLatch start = new CountDownLatch(1);
                List<Future<JsonNode>> futures = new ArrayList<>();
                for (int i = 0; i < callers; i++) {
                    final long nonce = 1_000L + i;
                    futures.add(pool.submit(() -> {
                        start.await();
                        McpToolInvocationResult result = invoker.invoke(1L, "echo",
                                Map.of("query", "q-" + nonce, "nonce", nonce, "delayMs", 40),
                                ACT_CONTEXT);
                        return MAPPER.readTree(result.payloadJson());
                    }));
                }
                start.countDown();
                for (int i = 0; i < callers; i++) {
                    long nonce = 1_000L + i;
                    JsonNode payload = futures.get(i).get(30, TimeUnit.SECONDS);
                    assertThat(payload.get("nonce").asLong()).as("nonce %d 不串话", nonce).isEqualTo(nonce);
                    assertThat(payload.get("caller").asLong()).isEqualTo(10001L);
                }
            } finally {
                pool.shutdownNow();
            }
            assertThat(host.observatory.maxInFlight.get())
                    .as("宿主应观测到并行执行(max in-flight > 1)").isGreaterThan(1);
            assertThat(host.observatory.servedNonces).hasSize(callers);
        }
    }

    @Test
    @DisplayName("⑥宿主 401(拒绝全部请求)→ McpToolAuthException 明确细分")
    void rejectingHostMapsToAuthException() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("echo", true, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), true)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

            assertThatThrownBy(() -> invoker.invoke(1L, "echo", Map.of(), ACT_CONTEXT))
                    .isInstanceOf(McpToolAuthException.class);
            assertThat(host.observatory.actRejected.get()).isPositive();
        }
    }

    @Test
    @DisplayName("⑤调用超时(call-timeout 可配)→ McpToolTimeoutException")
    void callTimeoutMapsToTimeoutException() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("slow_tool", false, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofMillis(300));

            assertThatThrownBy(() -> invoker.invoke(1L, "slow_tool", Map.of(), ACT_CONTEXT))
                    .isInstanceOf(McpToolTimeoutException.class);
        }
    }

    @Test
    @DisplayName("⑨resolve_scope 反查真实链路:ResolveScopeService 经真实 invoker 调宿主,不再降级")
    void resolveScopeSmokeOverRealInvoker() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("resolve_scope", false, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));
            com.inneragent.agent.mcp.McpToolCatalogEntry catalogEntry =
                    new com.inneragent.agent.mcp.McpToolCatalogEntry(
                            3L, entry.getFqn(), entry.getServerKey(), entry.getToolName(),
                            null, null, "a".repeat(64), "low", null, false, true, true,
                            false, true, true, false, false, false, false);
            McpToolCatalog catalog = Mockito.mock(McpToolCatalog.class);
            when(catalog.find(Mockito.anyLong(), any())).thenReturn(Optional.of(catalogEntry));
            @SuppressWarnings("unchecked")
            ObjectProvider<McpToolInvoker> invokers = Mockito.mock(ObjectProvider.class);
            when(invokers.getIfAvailable()).thenReturn((McpToolInvoker) invoker);
            ResolveScopeService service = new ResolveScopeService(catalog, invokers, MAPPER);

            ResolveScopeOutcome outcome = service.resolve(
                    1L, null, new ResolveScopeRequest("user-list", "12993", "user", Map.of()),
                    ACT_CONTEXT);

            assertThat(outcome.degraded()).as("invoker 就位后真实反查,不再 invoker_unavailable").isFalse();
            assertThat(outcome.visibleDomains()).containsExactly("user", "order");
            assertThat(outcome.writableFields()).containsExactly("user.remark");
            assertThat(outcome.forbidden()).containsExactly("user.password");
            assertThat(outcome.hints()).containsExactly("host resolved scope");
            assertThat(host.observatory.actValidated.get()).isPositive();
        }
    }

    @Test
    @DisplayName("⑩注册变更失效:invalidateApp 关闭客户端,下次调用重建(ToolCatalogInvalidator 挂钩)")
    void registryInvalidationClosesClientAndRebuilds() throws Exception {
        int port = nextFreePort();
        ToolRegistryEntry entry = entry("echo", true, port);
        try (HostServer host = HostServer.startStateless(port, entry.getEndpointUrl(), false)) {
            CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

            invoker.invoke(1L, "echo", Map.of("nonce", 1L), ACT_CONTEXT);
            assertThat(invoker.builtCount.get()).isEqualTo(1);

            invoker.invalidateApp(1L);
            invoker.invoke(1L, "echo", Map.of("nonce", 2L), ACT_CONTEXT);

            assertThat(invoker.builtCount.get()).as("失效后必须重建客户端").isEqualTo(2);
            // initialize(GET/POST×2)+ callTool:每客户端至少两次验签请求
            assertThat(host.observatory.actValidated.get()).isGreaterThanOrEqualTo(2);
        }
    }

    // ------------------------------------------------------------------
    // stateful 宿主:重启 → 重连编排(R1)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("⑦宿主重启 → 会话失效 → 重连编排(单飞重建/新会话)→ 重试成功")
    void hostRestartRecoversViaReconnectOrchestration() throws Exception {
        int proxyPort = nextFreePort();
        int firstHostPort = nextFreePort();
        int secondHostPort = nextFreePort();
        // 客户端与 audience 都指向代理地址(透明转发;重启语义 = 改投新宿主实例)
        String endpointViaProxy = "http://127.0.0.1:" + proxyPort + ENDPOINT;
        ToolRegistryEntry entry = entry("echo", true, proxyPort);
        Observatory observatory = new Observatory();
        HostProxy proxy = HostProxy.start(proxyPort);
        RUNNING_SERVERS.add(proxy);
        HostServer hostA = HostServer.startStateful(firstHostPort, endpointViaProxy, observatory);
        RUNNING_SERVERS.add(hostA);
        proxy.setUp(firstHostPort);
        CountingInvoker invoker = new CountingInvoker(entry, Duration.ofSeconds(10));

        McpToolInvocationResult before =
                invoker.invoke(1L, "echo", Map.of("query", "pre-restart", "nonce", 1L), ACT_CONTEXT);
        assertThat(before.error()).isFalse();

        // 宿主停机:代理掐断连接并拒新连;在途调用失败,重连编排中
        // re-initialize 亦失败 → 传输异常上抛
        proxy.setDown();
        assertThatThrownBy(() -> invoker.invoke(1L, "echo", Map.of("query", "outage"), ACT_CONTEXT))
                .isInstanceOf(McpToolTransportException.class);

        // 宿主重启完成:全新宿主实例(旧会话失效),代理恢复转发
        HostServer hostB = HostServer.startStateful(secondHostPort, endpointViaProxy, observatory);
        RUNNING_SERVERS.add(hostB);
        proxy.setUp(secondHostPort);

        McpToolInvocationResult after =
                invoker.invoke(1L, "echo", Map.of("query", "post-restart", "nonce", 2L), ACT_CONTEXT);

        assertThat(after.error()).isFalse();
        JsonNode payload = MAPPER.readTree(after.payloadJson());
        assertThat(payload.get("query").asText()).isEqualTo("post-restart");
        assertThat(payload.get("nonce").asLong()).isEqualTo(2L);
        assertThat(invoker.builtCount.get())
                .as("构建次数 = 首次建连 1 + 停机期重连重建尝试 1(失败,按懒失败上抛)"
                        + " + 恢复后干净重建 1;编排按预期触发")
                .isEqualTo(3);
        assertThat(observatory.actValidated.get()).isGreaterThanOrEqualTo(3);
    }

    // ------------------------------------------------------------------
    // 测试用 invoker / 注册表桩
    // ------------------------------------------------------------------

    private static ToolRegistryEntry entry(String toolName, boolean readOnlyHint, int port) {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(11L);
        entry.setServerKey("host");
        entry.setToolName(toolName);
        entry.setFqn(ToolRegistryService.fqnOf("host", toolName));
        entry.setSource(ToolRegistryService.SOURCE_HOST_APP);
        entry.setAnnotationsJson("{\"readOnlyHint\":" + readOnlyHint + "}");
        entry.setEnabled(true);
        entry.setEndpointUrl("http://127.0.0.1:" + port + ENDPOINT);
        return entry;
    }

    private static ToolRegistryMapper registryMapperOf(ToolRegistryEntry entry) {
        ToolRegistryMapper mapper = Mockito.mock(ToolRegistryMapper.class);
        when(mapper.selectActiveByToolName(entry.getToolName())).thenReturn(entry);
        lenient().when(mapper.selectList(any())).thenReturn(List.of(entry));
        return mapper;
    }

    /** 真实宿主链路 invoker(mapper 桩 + 真 RS256 签发;短退避),计客户端构建次数。 */
    private static final class CountingInvoker extends McpClientToolInvoker {

        private final AtomicLong builtCount = new AtomicLong();

        private CountingInvoker(ToolRegistryEntry entry, Duration callTimeout) {
            super(registryMapperOf(entry), new ActTokenIssuer(KEY_MANAGER), MAPPER, props(callTimeout));
        }

        @Override
        protected ClientHandle createClient(String clientKey, String endpointUrl,
                                            ToolRegistryEntry entry) {
            builtCount.incrementAndGet();
            return super.createClient(clientKey, endpointUrl, entry);
        }

        private static McpInvokerProperties props(Duration callTimeout) {
            McpInvokerProperties properties = new McpInvokerProperties();
            properties.setCallTimeout(callTimeout);
            properties.getReconnect().setInitialBackoff(Duration.ofMillis(100));
            properties.getReconnect().setMaxBackoff(Duration.ofMillis(500));
            return properties;
        }
    }

    private static int nextFreePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    // ------------------------------------------------------------------
    // 嵌入式 Tomcat 宿主(X-IA-Act 验签 Filter + stateless/stateful MCP server)
    // ------------------------------------------------------------------

    /** 宿主观测台:验签/拒绝计数 + 最近一次 claims + 并发峰值 + 已服务 nonce。 */
    static final class Observatory {
        final AtomicInteger actValidated = new AtomicInteger();
        final AtomicInteger actRejected = new AtomicInteger();
        final AtomicInteger inFlight = new AtomicInteger();
        final AtomicInteger maxInFlight = new AtomicInteger();
        final Set<Long> servedNonces = ConcurrentHashMap.newKeySet();
        volatile String lastCallerSub;
        volatile String lastActSub;
        volatile String lastAudience;
        volatile String lastToolName;
        volatile Long lastTenantId;

        void enter() {
            int current = inFlight.incrementAndGet();
            maxInFlight.accumulateAndGet(current, Math::max);
        }

        void exit() {
            inFlight.decrementAndGet();
        }
    }

    /** X-IA-Act 验签 Filter(RS256 + aud 强校验;claims 平铺为请求属性)。 */
    static final class ActVerifierFilter implements Filter {

        static final String ATTR_CLAIMS = "ia.it.claims";
        static final String CTX_CLAIMS = "ia.claims";

        private final String expectedAudience;
        private final boolean rejectAll;
        private final Observatory observatory;

        private ActVerifierFilter(String expectedAudience, boolean rejectAll, Observatory observatory) {
            this.expectedAudience = expectedAudience;
            this.rejectAll = rejectAll;
            this.observatory = observatory;
        }

        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, jakarta.servlet.ServletException {
            HttpServletRequest req = (HttpServletRequest) request;
            HttpServletResponse res = (HttpServletResponse) response;
            // SDK 客户端 POST 的 Content-Type 不带 charset(0.17.0),裸 servlet
            // 宿主必须显式声明请求 UTF-8(Spring Boot 的 CharacterEncodingFilter
            // 在生产宿主默认已做);否则请求体中文按 ISO-8859-1 解读产生 mojibake
            req.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
            Map<String, Object> claims = rejectAll ? null : verify(req.getHeader("X-IA-Act"));
            if (claims == null) {
                observatory.actRejected.incrementAndGet();
                // 拒绝形态对齐 Spring Boot 宿主默认错误体(application/json + status 字段):
                // 客户端错误细分依赖响应体中的 status/Unauthorized 字样(spike R5)
                res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                res.setContentType("application/json");
                res.setCharacterEncoding("UTF-8");
                res.getWriter().write(
                        "{\"status\":401,\"error\":\"Unauthorized\",\"message\":\"invalid X-IA-Act\"}");
                return;
            }
            observatory.actValidated.incrementAndGet();
            req.setAttribute(ATTR_CLAIMS, claims);
            chain.doFilter(request, response);
        }

        private Map<String, Object> verify(String headerValue) {
            if (headerValue == null || headerValue.isBlank()) {
                return null;
            }
            try {
                SignedJWT jwt = SignedJWT.parse(headerValue);
                JWK jwk = KEY_MANAGER.publicJwks().stream()
                        .filter(key -> key.getKeyID().equals(jwt.getHeader().getKeyID()))
                        .findFirst()
                        .orElse(null);
                if (jwk == null
                        || !jwt.verify(new RSASSAVerifier(jwk.toRSAKey().toRSAPublicKey()))) {
                    return null;
                }
                JWTClaimsSet claims = jwt.getJWTClaimsSet();
                if (claims.getAudience() == null || !claims.getAudience().contains(expectedAudience)
                        || claims.getExpirationTime() == null
                        || claims.getExpirationTime().before(new Date())) {
                    return null;
                }
                Object act = claims.getClaim("act");
                Map<String, Object> flattened = new LinkedHashMap<>();
                flattened.put("sub", claims.getSubject());
                flattened.put("tenantId", claims.getLongClaim("tenantId"));
                flattened.put("toolName", claims.getStringClaim("toolName"));
                flattened.put("aud", claims.getAudience().getFirst());
                flattened.put("actSub", act instanceof Map<?, ?> m ? String.valueOf(m.get("sub")) : "");
                observatory.lastCallerSub = String.valueOf(flattened.get("sub"));
                observatory.lastTenantId = (Long) flattened.get("tenantId");
                observatory.lastToolName = String.valueOf(flattened.get("toolName"));
                observatory.lastAudience = String.valueOf(flattened.get("aud"));
                observatory.lastActSub = String.valueOf(flattened.get("actSub"));
                return flattened;
            } catch (Exception malformed) {
                return null;
            }
        }
    }

    /** 工具处理器统一形状(stateless/stateful 共用)。 */
    private interface ToolHandler {
        McpSchema.CallToolResult apply(Map<String, Object> claims,
                                       McpSchema.CallToolRequest request) throws Exception;
    }

    /** 嵌入式 Tomcat 宿主:stop()/start() 模拟宿主重启(同端口)。 */
    static final class HostServer implements AutoCloseable {

        Observatory observatory = new Observatory();

        private final int port;
        private final String expectedAudience;
        private final boolean stateless;
        private Tomcat tomcat;
        // 服务对象强持有:处理器注册在服务端,防止被 GC 后 404
        private McpStatelessSyncServer statelessServer;
        private McpSyncServer statefulServer;

        private HostServer(int port, String expectedAudience, boolean stateless) {
            this.port = port;
            this.expectedAudience = expectedAudience;
            this.stateless = stateless;
        }

        static HostServer startStateless(int port, String expectedAudience, boolean rejectAll)
                throws Exception {
            HostServer host = new HostServer(port, expectedAudience, true);
            host.bootstrap(rejectAll);
            return host;
        }

        static HostServer startStateful(int port, String expectedAudience) throws Exception {
            return startStateful(port, expectedAudience, null);
        }

        /** 共享观测台(重启场景:跨宿主实例累计验签计数)。 */
        static HostServer startStateful(int port, String expectedAudience, Observatory shared)
                throws Exception {
            HostServer host = new HostServer(port, expectedAudience, false);
            if (shared != null) {
                host.observatory = shared;
            }
            host.bootstrap(false);
            return host;
        }

        private void bootstrap(boolean rejectAll) throws Exception {
            Filter actFilter = new ActVerifierFilter(expectedAudience, rejectAll, observatory);
            Servlet transportServlet = stateless ? statelessServlet() : statefulServlet();

            tomcat = new Tomcat();
            String baseDir = Files.createTempDirectory("ia-mcp-host").toString();
            tomcat.setBaseDir(baseDir);
            tomcat.setPort(port);
            tomcat.getConnector();
            Context context = tomcat.addContext("", baseDir);

            FilterDef filterDef = new FilterDef();
            filterDef.setFilterName("act-verifier");
            filterDef.setFilter(actFilter);
            context.addFilterDef(filterDef);
            FilterMap filterMap = new FilterMap();
            filterMap.setFilterName("act-verifier");
            filterMap.addURLPattern("/*");
            filterMap.setDispatcher(DispatcherType.REQUEST.name());
            context.addFilterMap(filterMap);

            Tomcat.addServlet(context, "mcp-transport", transportServlet);
            context.addServletMappingDecoded(ENDPOINT, "mcp-transport");

            tomcat.start();
            awaitReachable();
        }

        private Servlet statelessServlet() {
            HttpServletStatelessServerTransport transport =
                    HttpServletStatelessServerTransport.builder()
                            .messageEndpoint(ENDPOINT)
                            .contextExtractor(claimsExtractor())
                            .build();
            statelessServer = McpServer.sync(transport)
                    .serverInfo("ia-test-host", "1.0.0")
                    .capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
                    .tools(
                            statelessTool("echo", echoSchema(), this::echoResult),
                            statelessTool("text_only", textOnlySchema(),
                                    (claims, request) -> McpSchema.CallToolResult.builder()
                                            .addTextContent("plain-text-payload")
                                            .build()),
                            statelessTool("fail_tool", textOnlySchema(),
                                    (claims, request) -> McpSchema.CallToolResult.builder()
                                            .addTextContent("boom: host tool failed")
                                            .isError(true)
                                            .build()),
                            statelessTool("slow_tool", textOnlySchema(),
                                    (claims, request) -> {
                                        sleep(1_500);
                                        return McpSchema.CallToolResult.builder()
                                                .addTextContent("finally done")
                                                .build();
                                    }),
                            statelessTool("resolve_scope", textOnlySchema(),
                                    (claims, request) -> McpSchema.CallToolResult.builder()
                                            .structuredContent(Map.of(
                                                    "visibleDomains", List.of("user", "order"),
                                                    "writableFields", List.of("user.remark"),
                                                    "forbidden", List.of("user.password"),
                                                    "hints", List.of("host resolved scope")))
                                            .build()))
                    .build();
            return transport;
        }

        private Servlet statefulServlet() {
            HttpServletStreamableServerTransportProvider provider =
                    HttpServletStreamableServerTransportProvider.builder()
                            .mcpEndpoint(ENDPOINT)
                            .contextExtractor(claimsExtractor())
                            .build();
            statefulServer = McpServer.sync(provider)
                    .serverInfo("ia-test-host", "1.0.0")
                    .capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
                    .tools(McpServerFeatures.SyncToolSpecification.builder()
                            .tool(tool("echo", echoSchema()))
                            .callHandler((exchange, request) -> {
                                try {
                                    return echoResult(claims(exchange.transportContext()), request);
                                } catch (RuntimeException rethrow) {
                                    throw rethrow;
                                }
                            })
                            .build())
                    .build();
            return provider;
        }

        private McpTransportContextExtractor<HttpServletRequest> claimsExtractor() {
            return request -> {
                Object raw = request.getAttribute(ActVerifierFilter.ATTR_CLAIMS);
                if (!(raw instanceof Map<?, ?> claims)) {
                    return McpTransportContext.create(Map.of());
                }
                return McpTransportContext.create(Map.of(ActVerifierFilter.CTX_CLAIMS, claims));
            };
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> claims(McpTransportContext context) {
            Object raw = context.get(ActVerifierFilter.CTX_CLAIMS);
            return raw instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        }

        private static McpStatelessServerFeatures.SyncToolSpecification statelessTool(
                String name, McpSchema.JsonSchema schema, ToolHandler handler) {
            return McpStatelessServerFeatures.SyncToolSpecification.builder()
                    .tool(tool(name, schema))
                    .callHandler((context, request) -> {
                        try {
                            return handler.apply(claims(context), request);
                        } catch (Exception handlerFailure) {
                            throw new IllegalStateException("宿主工具处理器失败: " + name, handlerFailure);
                        }
                    })
                    .build();
        }

        private McpSchema.CallToolResult echoResult(Map<String, Object> claims,
                                                    McpSchema.CallToolRequest request) {
            Map<String, Object> args = request.arguments() == null ? Map.of() : request.arguments();
            long delayMs = args.get("delayMs") instanceof Number n ? n.longValue() : 0;
            long nonce = args.get("nonce") instanceof Number n ? n.longValue() : -1;
            observatory.enter();
            try {
                if (delayMs > 0) {
                    sleep(delayMs);
                }
                observatory.servedNonces.add(nonce);
                Map<String, Object> structured = new LinkedHashMap<>();
                structured.put("status", "ok");
                structured.put("query", String.valueOf(args.get("query")));
                structured.put("nonce", nonce);
                structured.put("caller", String.valueOf(claims.get("sub")));
                structured.put("tenantId", claims.get("tenantId"));
                structured.put("actSub", String.valueOf(claims.get("actSub")));
                structured.put("aud", String.valueOf(claims.get("aud")));
                structured.put("toolName", String.valueOf(claims.get("toolName")));
                return McpSchema.CallToolResult.builder()
                        .addTextContent("echo:" + args.get("query"))
                        .structuredContent(structured)
                        .build();
            } finally {
                observatory.exit();
            }
        }

        private static McpSchema.JsonSchema echoSchema() {
            Map<String, Object> properties = new LinkedHashMap<>();
            properties.put("query", Map.of("type", "string"));
            properties.put("nonce", Map.of("type", "integer"));
            properties.put("delayMs", Map.of("type", "integer"));
            return new McpSchema.JsonSchema("object", properties, List.of(), null, null, null);
        }

        private static McpSchema.JsonSchema textOnlySchema() {
            return new McpSchema.JsonSchema("object", Map.of(), List.of(), null, null, null);
        }

        private static McpSchema.Tool tool(String name, McpSchema.JsonSchema schema) {
            // V15 语义:宿主上报注解(readOnlyHint 等),注册时快照进 annotations_json
            return new McpSchema.Tool.Builder()
                    .name(name)
                    .description("ia IT host tool " + name)
                    .inputSchema(schema)
                    .annotations(new McpSchema.ToolAnnotations(null, true, false, true, false, null))
                    .build();
        }

        void stop() {
            try {
                tomcat.stop();
            } catch (LifecycleException e) {
                throw new IllegalStateException("宿主停机失败", e);
            }
        }

        @Override
        public void close() {
            try {
                tomcat.stop();
                tomcat.destroy();
            } catch (LifecycleException ignored) {
                // 测试收尾,关闭失败不阻塞其它用例
            }
        }

        private void awaitReachable() {
            long deadline = System.currentTimeMillis() + 15_000;
            while (System.currentTimeMillis() < deadline) {
                try (Socket socket = new Socket("127.0.0.1", port)) {
                    return;
                } catch (IOException notUpYet) {
                    sleep(100);
                }
            }
            throw new IllegalStateException("宿主端口不可达: " + port);
        }

        private static void sleep(long millis) {
            try {
                Thread.sleep(millis);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * 本地 TCP 代理(透明字节管道):宿主重启模拟的确定性手段——客户端始终
     * 指向代理端口,代理改投真实宿主端口;「宿主停机」= 代理拒连 + 掐断存量
     * 连接,「重启完成」= 代理改投新宿主实例(全新会话存储)。规避嵌入式
     * Tomcat stop/start 的端口释放竞态(spike T04 工程备注的等待问题)。
     */
    static final class HostProxy implements AutoCloseable {

        private final int listenPort;
        private final ExecutorService pump = Executors.newVirtualThreadPerTaskExecutor();
        private final java.util.List<Socket> openSockets = new java.util.concurrent.CopyOnWriteArrayList<>();
        private volatile ServerSocket listener;
        private volatile int targetPort = -1;

        private HostProxy(int listenPort) {
            this.listenPort = listenPort;
        }

        static HostProxy start(int listenPort) throws IOException {
            HostProxy proxy = new HostProxy(listenPort);
            proxy.setUp(listenPort + 1); // 占位目标,测试随即改投真实宿主
            return proxy;
        }

        /** 宿主可用:开监听并转发到目标端口。 */
        synchronized void setUp(int targetPort) throws IOException {
            this.targetPort = targetPort;
            if (listener == null || listener.isClosed()) {
                listener = new ServerSocket(listenPort);
                Thread.ofPlatform().name("host-proxy-accept-" + listenPort).start(this::acceptLoop);
            }
        }

        /** 宿主停机:关闭监听并掐断全部存量连接(在途调用即刻失败)。 */
        synchronized void setDown() throws IOException {
            targetPort = -1;
            if (listener != null && !listener.isClosed()) {
                listener.close();
            }
            listener = null;
            openSockets.forEach(HostProxy::closeQuietly);
            openSockets.clear();
        }

        private void acceptLoop() {
            while (true) {
                ServerSocket current = listener;
                if (current == null || current.isClosed()) {
                    return;
                }
                try {
                    Socket client = current.accept();
                    openSockets.add(client);
                    pump.submit(() -> forward(client));
                } catch (IOException closed) {
                    return;
                }
            }
        }

        private void forward(Socket client) {
            Socket remote = null;
            try {
                int target = targetPort;
                if (target <= 0) {
                    throw new IOException("宿主停机");
                }
                remote = new Socket("127.0.0.1", target);
                openSockets.add(remote);
                Socket remoteRef = remote;
                pump.submit(() -> copy(client, remoteRef));
                copy(remote, client);
            } catch (IOException down) {
                // 停机或对端断开:两端即刻失败
            } finally {
                closeQuietly(client);
                closeQuietly(remote);
                openSockets.remove(client);
            }
        }

        private static void copy(Socket from, Socket to) {
            try (InputStream in = from.getInputStream()) {
                OutputStream out = to.getOutputStream();
                in.transferTo(out);
                out.flush();
            } catch (IOException ignored) {
                // 单向结束即断链
            } finally {
                try {
                    to.shutdownOutput();
                } catch (IOException ignored) {
                    // 已关
                }
            }
        }

        private static void closeQuietly(Socket socket) {
            if (socket == null) {
                return;
            }
            try {
                socket.close();
            } catch (IOException ignored) {
                // 已关
            }
        }

        @Override
        public void close() {
            try {
                setDown();
            } catch (IOException ignored) {
                // 收尾
            }
            pump.shutdownNow();
        }
    }
}
