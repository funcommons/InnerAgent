package com.inneragent.agent.mcp;

import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mapper.McpUserServerMapper;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
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
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.FilterDef;
import org.apache.tomcat.util.descriptor.web.FilterMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 三方 MCP 全链 IT(P4-W13):真实 PostgreSQL(Testcontainers + Flyway 全链)
 * + 嵌入式 Tomcat 三方 MCP server(静态头守卫),覆盖:
 * <ol>
 *   <li>应用级注册 → tools/list(LRU 缓存)→ 目录聚合(FQN 命名空间)
 *       → invoker tools/call(静态头到达、X-IA-Act 不下发);</li>
 *   <li>防遮蔽:宿主同名工具存在时三方工具被丢弃并落审计(denied);</li>
 *   <li>用户级全链 + 行级 userId 隔离(用户 B 不可见/不可调用用户 A 的工具);</li>
 *   <li>注册变更即失效:停用后目录摘除。</li>
 * </ol>
 * 形态对齐 McpClientToolInvokerHostBridgeIT(嵌入式宿主,无 Testcontainers
 * 起 MCP server)+ ToolHealthPersistenceIT(真库)。IT 归 failsafe。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class McpThirdPartyServerIT {

    private static final long USER_A = 10001L;
    private static final long USER_B = 20002L;
    private static final String API_KEY_HEADER = "X-Api-Key";
    private static final String API_KEY_VALUE = "secret-crm-key";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    private static final ThirdPartyServer THIRD_PARTY =
            new ThirdPartyServer(List.of("list_contacts", "echo"));
    private static final ThirdPartyServer USER_THIRD_PARTY =
            new ThirdPartyServer(List.of("u_tool"));

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "third-party-mcp-node");
    }

    @Autowired
    private McpAppServerService appServerService;

    @Autowired
    private McpUserServerService userServerService;

    @Autowired
    private McpUserServerMapper userServerMapper;

    @Autowired
    private McpThirdPartyToolListCache toolListCache;

    @Autowired
    private McpToolCatalog catalog;

    @Autowired
    private McpToolInvoker invoker;

    @Autowired
    private ToolRegistryService registryService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private static final ToolExecutionContext ACT_USER_A =
            new ToolExecutionContext(USER_A, 1, 1L, 1L);
    private static final ToolExecutionContext ACT_USER_B =
            new ToolExecutionContext(USER_B, 1, 1L, 1L);

    @AfterAll
    static void stopThirdParty() {
        THIRD_PARTY.close();
        USER_THIRD_PARTY.close();
    }

    @Test
    @Order(1)
    @DisplayName("①应用级全链:注册 → tools/list(LRU)→ 目录 FQN → tools/call(静态头到达,无 X-IA-Act)")
    void appLevelFullChain() throws Exception {
        THIRD_PARTY.start();
        String endpoint = "http://127.0.0.1:" + THIRD_PARTY.port() + "/mcp";
        McpServerConfig registered = appServerService.register(new McpThirdPartyServerSupport.Upsert(
                "crm", "CRM 三方", endpoint, "streamable-http",
                "STATIC_HEADER", API_KEY_HEADER, API_KEY_VALUE, 30, true));

        assertThat(registered.getId()).isNotNull();

        // tools/list 经静态头守卫(缺头会被 401 拒绝)→ 清单进 LRU
        List<McpThirdPartyToolListCache.ThirdPartyTool> tools =
                toolListCache.tools(McpThirdPartyToolListCache.ServerRef.app(1L, "crm"));
        assertThat(tools).extracting(
                        McpThirdPartyToolListCache.ThirdPartyTool::name)
                .containsExactlyInAnyOrder("list_contacts", "echo");

        // 目录聚合:FQN 命名空间
        assertThat(catalog.catalog(1L)).extracting(McpToolCatalogEntry::fqn)
                .contains("mcp__crm__list_contacts", "mcp__crm__echo");

        // tools/call:三方 server 观测到静态头、观测不到 X-IA-Act
        McpToolInvocationResult result = invoker.invoke(1L, "mcp__crm__list_contacts",
                Map.of("region", "eu"), ACT_USER_A);
        assertThat(result.error()).isFalse();
        assertThat(result.payloadJson()).contains("\"region\":\"eu\"")
                .contains("crm-list_contacts");
        assertThat(THIRD_PARTY.unauthorized.get()).isZero();
        assertThat(THIRD_PARTY.validated.get()).isPositive();
        assertThat(THIRD_PARTY.actHeaderSeen.get())
                .as("三方服务器不得收到 X-IA-Act(act token 仅宿主桥内环)").isZero();
        assertThat(THIRD_PARTY.lastToolName).isEqualTo("list_contacts");

        // LRU 命中:二次取清单不重连(tools/list 计数不增)
        int validatedBefore = THIRD_PARTY.validated.get();
        toolListCache.tools(McpThirdPartyToolListCache.ServerRef.app(1L, "crm"));
        assertThat(THIRD_PARTY.validated.get()).isEqualTo(validatedBefore);
    }

    @Test
    @Order(2)
    @DisplayName("②防遮蔽:宿主已注册同名工具 → 三方 echo 被丢弃并落审计(denied/forced-policy)")
    void hostToolShadowsThirdPartyTool() {
        registryService.register(new ToolRegistryService.RegisterCommand(
                "host", "echo", "宿主 echo",
                "{\"type\":\"object\"}", "{\"readOnlyHint\":true}",
                null, null, null, null,
                ToolRegistryService.SOURCE_HOST_APP,
                "http://127.0.0.1:1/ia-mcp", null, true));

        List<McpToolCatalogEntry> entries = catalog.catalog(1L);
        assertThat(entries).extracting(McpToolCatalogEntry::fqn)
                .contains("mcp__host__echo")
                .doesNotContain("mcp__crm__echo");
        assertThat(entries).extracting(McpToolCatalogEntry::fqn)
                .contains("mcp__crm__list_contacts");

        Integer denied = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ia_audit_log WHERE decision = 'denied' "
                        + "AND decision_source = 'forced-policy' AND tool_fqn = 'mcp__crm__echo'",
                Integer.class);
        assertThat(denied).as("遮蔽丢弃应落审计(现有值域 denied/forced-policy)").isEqualTo(1);
    }

    @Test
    @Order(3)
    @DisplayName("③用户级全链 + 行级隔离:A 可见可调,B 不可见不可调")
    void userLevelChainAndRowIsolation() throws Exception {
        USER_THIRD_PARTY.start();
        // 直插 mapper 行:用户自接 endpoint 的 SSRF 校验在单测覆盖,
        // 此处端点为内嵌 server(127.0.0.1),验证运行时链路与隔离
        McpUserServer userA = McpUserServer.builder()
                .appId(1L).userId(USER_A).serverKey("ucrm")
                .name("A 的 CRM")
                .endpointUrl("http://127.0.0.1:" + USER_THIRD_PARTY.port() + "/mcp")
                .transport("streamable-http").authType("STATIC_HEADER")
                .headerName(API_KEY_HEADER).credentials(API_KEY_VALUE)
                .timeoutSeconds(30).enabled(true)
                .build();
        userServerMapper.insert(userA);

        // 行级隔离:list 仅本人;requireOwned 跨用户 404
        assertThat(userServerService.list(1L, USER_A)).hasSize(1);
        assertThat(userServerService.list(1L, USER_B)).isEmpty();
        assertThatThrownBy(() -> userServerService.requireOwned(1L, USER_B, userA.getId()))
                .isInstanceOf(com.inneragent.platform.common.BusinessException.class);

        // 用户 A 目录:mcp__ucrm__u_tool;用户 B 目录不含
        assertThat(catalog.catalogForUser(1L, USER_A)).extracting(McpToolCatalogEntry::fqn)
                .contains("mcp__ucrm__u_tool");
        assertThat(catalog.catalogForUser(1L, USER_B)).extracting(McpToolCatalogEntry::fqn)
                .doesNotContain("mcp__ucrm__u_tool");

        // 调用隔离:A 可调用;B 调用 → 未注册异常
        McpToolInvocationResult result = invoker.invoke(1L, "mcp__ucrm__u_tool",
                Map.of(), ACT_USER_A);
        assertThat(result.error()).isFalse();
        assertThat(USER_THIRD_PARTY.lastToolName).isEqualTo("u_tool");
        assertThatThrownBy(() -> invoker.invoke(1L, "mcp__ucrm__u_tool",
                Map.of(), ACT_USER_B))
                .isInstanceOf(McpToolCallException.class)
                .hasMessageContaining("未注册或未启用");
    }

    @Test
    @Order(4)
    @DisplayName("④注册变更即失效:应用级停用 → 目录摘除三方条目;配置重读生效")
    void configChangeInvalidatesCatalog() {
        McpServerConfig server = appServerService.list(1L).stream()
                .filter(row -> "crm".equals(row.getServerKey()))
                .findFirst().orElseThrow();
        appServerService.setEnabled(1L, server.getId(), false);

        assertThat(catalog.catalog(1L)).extracting(McpToolCatalogEntry::fqn)
                .doesNotContain("mcp__crm__list_contacts");

        appServerService.setEnabled(1L, server.getId(), true);
        assertThat(catalog.catalog(1L)).extracting(McpToolCatalogEntry::fqn)
                .contains("mcp__crm__list_contacts");
    }

    // ------------------------------------------------------------------
    // 嵌入式三方 MCP server(静态头守卫;无 X-IA-Act 验签——三方不该收到它)
    // ------------------------------------------------------------------

    static final class ThirdPartyServer implements AutoCloseable {

        final AtomicInteger validated = new AtomicInteger();
        final AtomicInteger unauthorized = new AtomicInteger();
        final AtomicInteger actHeaderSeen = new AtomicInteger();
        volatile String lastToolName;
        private final List<String> toolNames;
        private int port = -1;
        private Tomcat tomcat;
        private McpStatelessSyncServer server;

        ThirdPartyServer(List<String> toolNames) {
            this.toolNames = toolNames;
        }

        int port() {
            if (port < 0) {
                throw new IllegalStateException("third-party server not started");
            }
            return port;
        }

        synchronized void start() throws Exception {
            if (tomcat != null) {
                return;
            }
            port = nextFreePort();
            tomcat = new Tomcat();
            String baseDir = Files.createTempDirectory("ia-mcp-third-party").toString();
            tomcat.setBaseDir(baseDir);
            tomcat.setPort(port);
            tomcat.getConnector();
            Context context = tomcat.addContext("", baseDir);

            FilterDef filterDef = new FilterDef();
            filterDef.setFilterName("static-header-guard");
            filterDef.setFilter(staticHeaderGuard());
            context.addFilterDef(filterDef);
            FilterMap filterMap = new FilterMap();
            filterMap.setFilterName("static-header-guard");
            filterMap.addURLPattern("/*");
            filterMap.setDispatcher(DispatcherType.REQUEST.name());
            context.addFilterMap(filterMap);

            HttpServletStatelessServerTransport transport =
                    HttpServletStatelessServerTransport.builder().messageEndpoint("/mcp").build();
            // 服务对象强持有:处理器注册在服务端,防止被 GC 后 404
            server = McpServer.sync(transport)
                    .serverInfo("ia-test-third-party", "1.0.0")
                    .capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
                    .tools(toolNames.stream()
                            .map(this::spec)
                            .toArray(McpStatelessServerFeatures.SyncToolSpecification[]::new))
                    .build();
            Tomcat.addServlet(context, "mcp-transport", transport);
            context.addServletMappingDecoded("/mcp", "mcp-transport");
            tomcat.start();
            awaitReachable();
        }

        private McpStatelessServerFeatures.SyncToolSpecification spec(String name) {
            return McpStatelessServerFeatures.SyncToolSpecification.builder()
                    .tool(new McpSchema.Tool.Builder()
                            .name(name)
                            .description("ia IT third-party tool " + name)
                            .inputSchema(new McpSchema.JsonSchema("object",
                                    "list_contacts".equals(name)
                                            ? Map.of("region", Map.of("type", "string"))
                                            : Map.of(),
                                    List.of(), null, null, null))
                            .annotations(new McpSchema.ToolAnnotations(null, true, false, true, false, null))
                            .build())
                    .callHandler((exchange, request) -> {
                        lastToolName = request.name();
                        if ("list_contacts".equals(name)) {
                            return McpSchema.CallToolResult.builder()
                                    .structuredContent(Map.of(
                                            "status", "ok",
                                            "region", String.valueOf(
                                                    request.arguments().get("region")),
                                            "source", "crm-list_contacts"))
                                    .build();
                        }
                        return McpSchema.CallToolResult.builder()
                                .addTextContent("third-party:" + name)
                                .build();
                    })
                    .build();
        }

        /** 静态头守卫:缺头/错值一律 401(三方鉴权即静态头配置的本体);观测 X-IA-Act。 */
        private Filter staticHeaderGuard() {
            return (ServletRequest request, ServletResponse response, FilterChain chain)
                    -> {
                HttpServletRequest req = (HttpServletRequest) request;
                HttpServletResponse res = (HttpServletResponse) response;
                req.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
                if (req.getHeader("X-IA-Act") != null) {
                    actHeaderSeen.incrementAndGet();
                }
                if (!API_KEY_VALUE.equals(req.getHeader(API_KEY_HEADER))) {
                    unauthorized.incrementAndGet();
                    res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    res.setContentType("application/json");
                    res.getWriter().write("{\"error\":\"missing or invalid api key\"}");
                    return;
                }
                validated.incrementAndGet();
                chain.doFilter(request, response);
            };
        }

        private static McpStatelessServerFeatures.SyncToolSpecification spec(
                String name, McpSchema.JsonSchema schema,
                java.util.function.BiFunction<Object, McpSchema.CallToolRequest,
                        McpSchema.CallToolResult> handler) {
            return McpStatelessServerFeatures.SyncToolSpecification.builder()
                    .tool(new McpSchema.Tool.Builder()
                            .name(name)
                            .description("ia IT third-party tool " + name)
                            .inputSchema(schema)
                            .annotations(new McpSchema.ToolAnnotations(null, true, false, true, false, null))
                            .build())
                    .callHandler(handler::apply)
                    .build();
        }

        private static int nextFreePort() throws IOException {
            try (ServerSocket socket = new ServerSocket(0)) {
                return socket.getLocalPort();
            }
        }

        private void awaitReachable() throws InterruptedException {
            long deadline = System.currentTimeMillis() + 15_000;
            while (System.currentTimeMillis() < deadline) {
                try (Socket socket = new Socket("127.0.0.1", port)) {
                    return;
                } catch (IOException notUpYet) {
                    Thread.sleep(100);
                }
            }
            throw new IllegalStateException("三方 server 端口不可达: " + port);
        }

        @Override
        public synchronized void close() {
            if (tomcat == null) {
                return;
            }
            try {
                tomcat.stop();
                tomcat.destroy();
            } catch (Exception ignored) {
                // 测试收尾
            }
            tomcat = null;
        }
    }
}
