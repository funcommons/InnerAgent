package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.ToolHealthProperties;
import com.inneragent.platform.toolhub.ToolHealthService;
import com.inneragent.platform.toolhub.ToolHealthService.CheckItem;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolSchemaFingerprint;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.inneragent.server.auth.act.ActTokenKeyManager;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 工具体检 v1 真机握手 IT(V16;嵌入式 Tomcat 宿主,形态对齐
 * {@link McpClientToolInvokerHostBridgeIT},无 Testcontainers;failsafe:
 * mvn verify / -Dit.test 定向)。
 *
 * <p>覆盖体检三态 + 指纹漂移 + 注解 diff:
 * <ul>
 *   <li><strong>ok</strong>:initialize/listTools 握手 + 工具在清单 + 指纹一致
 *       + 注解一致;</li>
 *   <li><strong>degraded(清单缺工具)</strong>:注册 toolName 不在宿主清单;</li>
 *   <li><strong>degraded(指纹漂移)</strong>:宿主 schema required 集变化;</li>
 *   <li><strong>degraded(注解 diff)</strong>:注册 readOnlyHint 与宿主翻转;</li>
 *   <li><strong>unreachable</strong>:宿主全拒(403,握手不可达形态)。</li>
 * </ul>
 * 数据库层以 Mockito 桩替(落库回读由 ToolHealthPersistenceIT 真库覆盖)。
 */
class McpToolHealthCheckHostIT {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ActTokenKeyManager KEY_MANAGER = new ActTokenKeyManager(null, null);

    /** 宿主 echo 工具的 schema(health 宿主侧 readOnlyHint=true)。 */
    private static final String HOST_ECHO_SCHEMA = """
            {"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}
            """;
    private static final String HOST_ANNOTATIONS = "{\"readOnlyHint\":true}";

    private static HealthHostServer host;

    @BeforeAll
    static void startHost() throws Exception {
        host = HealthHostServer.startHealthy(nextFreePort());
    }

    @AfterAll
    static void stopHost() {
        if (host != null) {
            host.close();
        }
    }

    // ------------------------------------------------------------------
    // 三态 + 漂移(健康宿主,127.0.0.1 随机端口)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("①ok:握手 + 清单 + 指纹 + 注解全通过(real initialize/listTools 链)")
    void healthyToolResolvesOk() {
        ToolRegistryEntry entry = registered("echo", HOST_ECHO_SCHEMA, HOST_ANNOTATIONS, host.port);
        ToolHealthService.ToolCheckResult result = serviceFor(entry).checkOne(entry.getId());

        assertThat(result.status()).isEqualTo("ok");
        assertThat(result.checks()).extracting(CheckItem::check)
                .containsExactly("endpoint_reachable", "tool_present",
                        "schema_fingerprint", "annotations_diff");
        assertThat(result.checks()).extracting(CheckItem::status)
                .containsExactly("pass", "pass", "pass", "pass");
    }

    @Test
    @DisplayName("②degraded:宿主清单无该工具名(下线漂移)")
    void missingToolResolvesDegraded() {
        ToolRegistryEntry entry = registered("ghost", HOST_ECHO_SCHEMA, HOST_ANNOTATIONS, host.port);
        ToolHealthService.ToolCheckResult result = serviceFor(entry).checkOne(entry.getId());

        assertThat(result.status()).isEqualTo("degraded");
        CheckItem present = result.checks().get(1);
        assertThat(present.check()).isEqualTo("tool_present");
        assertThat(present.status()).isEqualTo("drift");
        assertThat(present.detail()).contains("ghost");
    }

    @Test
    @DisplayName("③degraded:schema 指纹漂移(宿主 required 集变化)且其余项 pass")
    void schemaDriftResolvesDegraded() {
        String drifted = """
                {"type":"object","properties":{"query":{"type":"string"}},
                 "required":["query","tenantId"]}
                """;
        ToolRegistryEntry entry = registered("echo", drifted, HOST_ANNOTATIONS, host.port);
        ToolHealthService.ToolCheckResult result = serviceFor(entry).checkOne(entry.getId());

        assertThat(result.status()).isEqualTo("degraded");
        CheckItem fingerprint = item(result, "schema_fingerprint");
        assertThat(fingerprint.status()).isEqualTo("drift");
        assertThat(fingerprint.advice()).contains("/schema");
        assertThat(item(result, "tool_present").status()).isEqualTo("pass");
        assertThat(item(result, "annotations_diff").status()).isEqualTo("pass");
    }

    @Test
    @DisplayName("④degraded:注解 diff(注册 readOnlyHint=false ≠ 宿主 true)→ 差异键明细")
    void annotationDriftResolvesDegraded() {
        ToolRegistryEntry entry = registered("echo", HOST_ECHO_SCHEMA,
                "{\"readOnlyHint\":false}", host.port);
        ToolHealthService.ToolCheckResult result = serviceFor(entry).checkOne(entry.getId());

        assertThat(result.status()).isEqualTo("degraded");
        CheckItem annotations = item(result, "annotations_diff");
        assertThat(annotations.status()).isEqualTo("drift");
        assertThat(annotations.detail()).contains("readOnlyHint");
        assertThat(item(result, "schema_fingerprint").status()).isEqualTo("pass");
    }

    @Test
    @DisplayName("⑤unreachable:宿主全拒(403)→ 握手失败,宿主侧检查不再执行")
    void rejectingHostResolvesUnreachable() throws Exception {
        try (HealthHostServer rejecting = HealthHostServer.startRejecting(nextFreePort())) {
            ToolRegistryEntry entry = registered("echo", HOST_ECHO_SCHEMA,
                    HOST_ANNOTATIONS, rejecting.port);
            ToolHealthService.ToolCheckResult result =
                    serviceFor(entry).checkOne(entry.getId());

            assertThat(result.status()).isEqualTo("unreachable");
            assertThat(result.checks()).hasSize(1);
            assertThat(result.checks().getFirst().check()).isEqualTo("endpoint_reachable");
            assertThat(result.checks().getFirst().status()).isEqualTo("drift");
            assertThat(result.checks().getFirst().detail()).isNotBlank();
        }
    }

    // ------------------------------------------------------------------
    // 装配 / 注册行桩
    // ------------------------------------------------------------------

    /** 真探活通道 + 真 mapper 桩(内存注册行;真库落库回读见 ToolHealthPersistenceIT)。 */
    private ToolHealthService serviceFor(ToolRegistryEntry entry) {
        ToolRegistryMapper mapper = Mockito.mock(ToolRegistryMapper.class);
        when(mapper.selectById(any(Long.class))).thenReturn(entry);
        McpToolHealthChecker checker =
                new McpToolHealthChecker(new ActTokenIssuer(KEY_MANAGER), MAPPER);
        return new ToolHealthService(mapper, checker, new ToolHealthProperties(), MAPPER);
    }

    private static ToolRegistryEntry registered(
            String toolName, String schema, String annotations, int port) {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId((long) (toolName.hashCode() & 0xffff) + 100);
        entry.setAppId(1L);
        entry.setServerKey("host");
        entry.setToolName(toolName);
        entry.setFqn(ToolRegistryService.fqnOf("host", toolName));
        entry.setSource("host_app");
        entry.setParametersSchema(ToolSchemaFingerprint.canonicalJson(MAPPER, schema));
        entry.setAnnotationsJson(annotations);
        entry.setSchemaSha256(ToolSchemaFingerprint.of(MAPPER, schema));
        entry.setEnabled(true);
        entry.setEndpointUrl("http://127.0.0.1:" + port + "/ia-mcp");
        return entry;
    }

    private static CheckItem item(ToolHealthService.ToolCheckResult result, String check) {
        return result.checks().stream()
                .filter(candidate -> candidate.check().equals(check))
                .findFirst().orElseThrow();
    }

    private static int nextFreePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    // ------------------------------------------------------------------
    // 嵌入式 Tomcat 宿主(stateless MCP;无鉴权 Filter——体检 act token 仅透传)
    // ------------------------------------------------------------------

    /**
     * 最小宿主:echo(query;readOnlyHint=true)+ other 两个工具。
     * healthy 形态暴露 stateless /ia-mcp;rejecting 形态任意路径 403
     * (握手不可达的确定性模拟,不依赖端口未监听的竞态)。
     */
    static final class HealthHostServer implements AutoCloseable {

        final int port;

        private final Tomcat tomcat;
        private McpStatelessSyncServer server;

        private HealthHostServer(int port) throws Exception {
            this.port = port;
            tomcat = new Tomcat();
            tomcat.setBaseDir(Files.createTempDirectory("ia-health-host").toString());
            tomcat.setPort(port);
            tomcat.getConnector();
        }

        static HealthHostServer startHealthy(int port) throws Exception {
            HealthHostServer serverHost = new HealthHostServer(port);
            Context context = serverHost.tomcat.addContext("",
                    Files.createTempDirectory("ia-health-mcp").toString());
            HttpServletStatelessServerTransport transport =
                    HttpServletStatelessServerTransport.builder()
                            .messageEndpoint("/ia-mcp")
                            .build();
            serverHost.server = McpServer.sync(transport)
                    .serverInfo("ia-health-host", "1.0.0")
                    .capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
                    .tools(statelessTool("echo"), statelessTool("other"))
                    .build();
            Tomcat.addServlet(context, "mcp-transport", transport);
            context.addServletMappingDecoded("/ia-mcp", "mcp-transport");
            serverHost.tomcat.start();
            return serverHost;
        }

        static HealthHostServer startRejecting(int port) throws Exception {
            HealthHostServer rejecting = new HealthHostServer(port);
            Context context = rejecting.tomcat.addContext("",
                    Files.createTempDirectory("ia-health-reject").toString());
            Tomcat.addServlet(context, "rejector", new jakarta.servlet.http.HttpServlet() {
                @Override
                protected void service(HttpServletRequest request,
                                       HttpServletResponse response) throws IOException {
                    response.setStatus(403);
                    response.setContentType("application/json");
                    response.getWriter().write("{\"status\":403,\"error\":\"Forbidden\"}");
                }
            });
            context.addServletMappingDecoded("/*", "rejector");
            rejecting.tomcat.start();
            return rejecting;
        }

        private static McpStatelessServerFeatures.SyncToolSpecification statelessTool(
                String name) {
            Map<String, Object> properties = Map.of("query", Map.of("type", "string"));
            McpSchema.JsonSchema schema = new McpSchema.JsonSchema(
                    "object", properties, List.of("query"), null, null, null);
            McpSchema.Tool tool = new McpSchema.Tool.Builder()
                    .name(name)
                    .description("ia health IT host tool " + name)
                    .inputSchema(schema)
                    .annotations(new McpSchema.ToolAnnotations(null, true, null, null, null, null))
                    .build();
            return McpStatelessServerFeatures.SyncToolSpecification.builder()
                    .tool(tool)
                    .callHandler((context, request) -> McpSchema.CallToolResult.builder()
                            .addTextContent("echo:" + name)
                            .build())
                    .build();
        }

        @Override
        public void close() {
            try {
                if (server != null) {
                    server.close();
                }
                tomcat.stop();
                tomcat.destroy();
            } catch (Exception ignored) {
                // 测试收尾,关闭失败不阻塞
            }
        }
    }
}
