package spike.bridge;

import java.util.List;
import java.util.Map;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import spike.bridge.client.IaMcpClientFactory;
import spike.bridge.server.BridgeObservatory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 2a (client against the in-process bridge, Streamable HTTP):
 * list tools with schema + annotations, structured-content round trip on read and write tools.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class T02_ClientListAndCallToolTest {

	@LocalServerPort
	int port;

	@Autowired
	BridgeObservatory observatory;

	private McpSyncClient client;

	@BeforeEach
	void setUp() {
		this.client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, "run-1", "user-9", "run-1",
				null);
		this.client.initialize();
	}

	@AfterEach
	void tearDown() {
		if (this.client != null) {
			this.client.closeGracefully();
		}
	}

	private String baseUrl() {
		return "http://localhost:" + this.port;
	}

	@Test
	void listToolsExposesNamesSchemasAndAnnotations() {
		McpSchema.ListToolsResult tools = this.client.listTools();
		Map<String, McpSchema.Tool> byName = byName(tools);
		assertTrue(byName.containsKey(IaTools.LOOKUP), "read tool listed: " + byName.keySet());
		assertTrue(byName.containsKey(IaTools.CREATE_TICKET), "write tool listed: " + byName.keySet());

		McpSchema.Tool lookup = byName.get(IaTools.LOOKUP);
		assertEquals("Host Lookup", lookup.title());
		assertNotNull(lookup.inputSchema());
		assertTrue(inputSchemaProperties(lookup).containsKey("query"), "input schema visible to client");
		assertTrue(required(lookup).contains("query"), "required params visible to client");

		// Annotations survive the wire round trip - the triage inputs of §4.3 (readOnlyHint etc.)
		assertEquals(Boolean.TRUE, lookup.annotations().readOnlyHint(), "read tool annotated read-only");
		assertEquals(Boolean.TRUE, lookup.annotations().idempotentHint());

		McpSchema.Tool ticket = byName.get(IaTools.CREATE_TICKET);
		assertEquals(Boolean.FALSE, ticket.annotations().readOnlyHint(), "write tool not read-only");
		assertEquals(Boolean.FALSE, ticket.annotations().idempotentHint(), "write tool not idempotent");
	}

	@Test
	@SuppressWarnings("unchecked")
	void callToolReadReturnsStructuredContentWithIdentityAndNonce() {
		McpSchema.CallToolResult result = this.client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
			.arguments(Map.of("query", "q1", "nonce", "n-read-1"))
			.build());
		assertFalse(Boolean.TRUE.equals(result.isError()));
		Map<String, Object> structured = (Map<String, Object>) result.structuredContent();
		assertEquals("ok", structured.get("status"));
		assertEquals("q1", structured.get("query"));
		assertEquals("n-read-1", structured.get("nonce"), "structured content round trip preserved the nonce");
		assertEquals("user-9", structured.get("caller"), "X-IA-Act identity reached the tool handler");
		assertEquals("run-1", structured.get("runId"));
		assertTrue(result.content().stream().anyMatch(c -> c instanceof McpSchema.TextContent),
				"text content also present");
	}

	@Test
	@SuppressWarnings("unchecked")
	void callToolWriteReturnsStructuredContent() {
		long before = this.observatory.ticketSeq.get();
		McpSchema.CallToolResult result = this.client
			.callTool(McpSchema.CallToolRequest.builder(IaTools.CREATE_TICKET)
				.arguments(Map.of("title", "fix flux capacitor", "priority", "high"))
				.build());
		assertFalse(Boolean.TRUE.equals(result.isError()));
		Map<String, Object> structured = (Map<String, Object>) result.structuredContent();
		assertEquals("ok", structured.get("status"));
		assertTrue(String.valueOf(structured.get("ticketId")).startsWith("T-"));
		assertEquals("user-9", structured.get("createdBy"));
		assertEquals(before + 1, this.observatory.ticketSeq.get(), "server-side state mutated exactly once");
	}

	private static Map<String, McpSchema.Tool> byName(McpSchema.ListToolsResult tools) {
		List<McpSchema.Tool> list = tools.tools();
		return list.stream().collect(java.util.stream.Collectors.toMap(McpSchema.Tool::name, t -> t));
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> inputSchemaProperties(McpSchema.Tool tool) {
		Object properties = ((Map<String, Object>) tool.inputSchema()).get("properties");
		return properties instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
	}

	private static List<String> required(McpSchema.Tool tool) {
		@SuppressWarnings("unchecked")
		Object req = ((Map<String, Object>) tool.inputSchema()).get("required");
		return req instanceof List<?> l ? l.stream().map(String::valueOf).toList() : List.of();
	}

}
