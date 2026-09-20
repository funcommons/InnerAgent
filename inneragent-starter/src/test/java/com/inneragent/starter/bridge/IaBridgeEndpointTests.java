package com.inneragent.starter.bridge;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.starter.IaToolDefinition;
import com.inneragent.starter.TestHostApp;
import com.inneragent.starter.act.IaActTokenVerifier;
import com.inneragent.starter.testsupport.McpClients;
import com.inneragent.starter.testsupport.TestActTokenFactory;
import com.inneragent.starter.testsupport.TestJwksServer;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * P1-T2b 职责①/② 端到端(FINDINGS 已验证模式):
 * 真实 MCP SDK 客户端连内嵌 Tomcat 上的 stateless /ia-mcp ——
 * list tools 往返、结构化 call 往返、验签身份进入处理器、动态 remove/register、
 * stateless 表面(无会话 id、GET→405)、匿名 fail-closed。
 */
@SpringBootTest(classes = TestHostApp.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "inneragent.bridge.tool-packages=com.inneragent.starter.scanned",
				"inneragent.bridge.act.audiences=ia-mcp-test",
				"inneragent.bridge.act.forced-refresh-cooldown=0s" })
class IaBridgeEndpointTests {

	private static final ObjectMapper JSON = new ObjectMapper();

	private static final TestJwksServer JWKS = new TestJwksServer();
	private static final TestActTokenFactory TOKENS = new TestActTokenFactory("ia-mcp-test");

	@LocalServerPort
	int port;

	@Autowired
	IaMcpServerBridge bridge;

	@Autowired
	IaToolScanner scanner;

	private McpSyncClient client;

	@BeforeAll
	static void startJwks() throws Exception {
		JWKS.start();
		JWKS.setKeys(TOKENS.publicJwk());
	}

	@AfterAll
	static void stopJwks() {
		JWKS.stop();
	}

	@DynamicPropertySource
	static void bridgeProperties(DynamicPropertyRegistry registry) {
		registry.add("inneragent.bridge.server-base", () -> JWKS.base());
	}

	@BeforeEach
	void setUp() {
		Supplier<String> token = () -> TOKENS.issue("10001", "run-1");
		this.client = McpClients.sdk(baseUrl(), "/ia-mcp", token);
		this.client.initialize();
	}

	@AfterEach
	void tearDown() {
		if (this.client != null) {
			this.client.closeGracefully();
		}
	}

	private String baseUrl() {
		return "http://127.0.0.1:" + this.port;
	}

	private Map<String, McpSchema.Tool> listByName() {
		return this.client.listTools().tools().stream()
			.collect(Collectors.toMap(McpSchema.Tool::name, t -> t));
	}

	@Test
	void listToolsRoundTripsNamesSchemasAndAnnotations() {
		Map<String, McpSchema.Tool> tools = listByName();

		assertThat(tools.keySet()).contains("host_lookup", "host_create_ticket", "scanned_probe", "host_boom");

		McpSchema.Tool lookup = tools.get("host_lookup");
		assertThat(lookup.description()).isEqualTo("只读宿主查询工具");
		assertThat(inputSchemaProperties(lookup)).containsKey("query");
		assertThat(requiredParams(lookup)).containsExactly("query");
		assertThat(lookup.annotations().readOnlyHint()).isTrue();
		assertThat(lookup.annotations().destructiveHint()).isFalse();
		assertThat(lookup.meta()).containsEntry("ia.riskLevel", "READ");

		McpSchema.Tool ticket = tools.get("host_create_ticket");
		assertThat(ticket.annotations().readOnlyHint()).isFalse();
		// 枚举参数 → string + enum values;两个必填参数入 required
		assertThat(requiredParams(ticket)).containsExactlyInAnyOrder("title", "priority");
		assertThat(enumValues(inputSchemaProperties(ticket).get("priority")).stream().map(String::valueOf).toList())
			.containsExactly("LOW", "NORMAL", "HIGH");

		McpSchema.Tool boom = tools.get("host_boom");
		assertThat(boom.annotations().destructiveHint()).isTrue();
	}

	@Test
	void callToolRoundTripsStructuredContentAndVerifiedIdentity() {
		McpSchema.CallToolResult result = this.client
			.callTool(McpSchema.CallToolRequest.builder("host_lookup")
				.arguments(Map.of("query", "q1", "nonce", "n-read-1"))
				.build());

		assertThat(result.isError()).isNotEqualTo(Boolean.TRUE);
		Map<?, ?> structured = (Map<?, ?>) result.structuredContent();
		assertThat(structured.get("status")).isEqualTo("ok");
		assertThat(structured.get("query")).isEqualTo("q1");
		assertThat(structured.get("nonce")).isEqualTo("n-read-1");
		// 验签身份经 Filter → contextExtractor → McpTransportContext 到达工具处理器
		assertThat(structured.get("userId")).isEqualTo("10001");
		assertThat(structured.get("appKey")).isEqualTo("demo-app");
		// claims 上下文统一以字符串传播(宿主侧自行解析类型)
		assertThat(structured.get("tenantId")).isEqualTo("7");
		assertThat(structured.get("toolName")).isEqualTo("mcp__host__host_lookup");
		// runId 从 act.sub 前缀(inneragent-run:run-1)推导
		assertThat(structured.get("runId")).isEqualTo("run-1");
	}

	@Test
	void callToolBindsEnumAndOptionalArguments() {
		McpSchema.CallToolResult result = this.client
			.callTool(McpSchema.CallToolRequest.builder("host_create_ticket")
				.arguments(Map.of("title", "修时光机", "priority", "HIGH"))
				.build());

		assertThat(result.isError()).isNotEqualTo(Boolean.TRUE);
		Map<?, ?> structured = (Map<?, ?>) result.structuredContent();
		assertThat(structured.get("priority")).isEqualTo("HIGH");
		assertThat(structured.get("createdBy")).isEqualTo("10001");
	}

	@Test
	void toolFailureMapsToErrorResult() {
		McpSchema.CallToolResult result = this.client
			.callTool(McpSchema.CallToolRequest.builder("host_boom").arguments(Map.of()).build());

		assertThat(result.isError()).isTrue();
		Map<?, ?> structured = (Map<?, ?>) result.structuredContent();
		assertThat(structured.get("status")).isEqualTo("error");
		assertThat(String.valueOf(structured.get("message"))).contains("boom");
	}

	@Test
	void dynamicUnregisterReflectsInListAndReregisterRestores() {
		IaToolDefinition restored = this.scanner.scan().stream()
			.filter(definition -> "host_create_ticket".equals(definition.name()))
			.findFirst()
			.orElseThrow();
		try {
			this.bridge.unregister("host_create_ticket");
			assertThat(listByName()).doesNotContainKey("host_create_ticket");
		}
		finally {
			// 无论断言成败都恢复注册,避免污染同上下文的其他用例
			this.bridge.register(restored);
		}
		assertThat(listByName()).containsKey("host_create_ticket");
	}

	@Test
	void statelessSurfaceServesRawJsonRpcWithoutSessions() throws Exception {
		HttpClient http = McpClients.rawClient();
		String url = baseUrl() + "/ia-mcp";
		String act = TOKENS.issue("raw-user", "run-raw");

		// initialize:200 且不下发 Mcp-Session-Id(stateless 表面,spike T06 对齐)
		HttpResponse<String> init = McpClients.rawPost(http, url, act, """
				{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
				  "protocolVersion":"2025-06-18","capabilities":{},
				  "clientInfo":{"name":"raw-stateless","version":"0.0.1"}}}
				""");
		assertThat(init.statusCode()).isEqualTo(200);
		assertThat(init.headers().firstValue("Mcp-Session-Id")).isEmpty();
		assertThat(JSON.readTree(init.body()).path("result").path("protocolVersion").isMissingNode()).isFalse();

		// 无 initialize 前置的裸 tools/call 也成功(每请求独立)
		HttpResponse<String> call = McpClients.rawPost(http, url, act, """
				{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
				  "name":"host_lookup","arguments":{"query":"raw","nonce":"raw-1"}}}
				""");
		assertThat(call.statusCode()).isEqualTo(200);
		assertThat(JSON.readTree(call.body()).path("result").path("structuredContent").path("nonce").asText())
			.isEqualTo("raw-1");

		// GET(SSE 流)→ 405
		HttpResponse<String> get = McpClients.rawGet(http, url, act);
		assertThat(get.statusCode()).isEqualTo(405);
	}

	@Test
	void anonymousCallsFailClosed() throws Exception {
		HttpResponse<String> anonymous = McpClients.rawPost(McpClients.rawClient(), baseUrl() + "/ia-mcp", null, """
				{"jsonrpc":"2.0","id":10,"method":"tools/list","params":{}}
				""");
		assertThat(anonymous.statusCode()).isEqualTo(401);
	}

	@Test
	void verifierHeaderConstantMatchesWireHeader() {
		assertThat(IaActTokenVerifier.ACT_HEADER).isEqualTo("X-IA-Act");
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> inputSchemaProperties(McpSchema.Tool tool) {
		Object properties = ((Map<String, Object>) tool.inputSchema()).get("properties");
		return properties instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
	}

	private static List<String> requiredParams(McpSchema.Tool tool) {
		Object required = ((Map<String, Object>) tool.inputSchema()).get("required");
		return required instanceof List<?> list ? list.stream().map(String::valueOf).toList() : List.of();
	}

	private static List<?> enumValues(Object propertySchema) {
		if (propertySchema instanceof Map<?, ?> schema) {
			return schema.get("enum") instanceof List<?> values ? values : List.of();
		}
		return List.of();
	}

}
