package spike.bridge;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import spike.bridge.client.IaMcpClientFactory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 4: how JSON schemas are produced, and the hook points for
 * "schema 指纹 sha256 + 活刷新分诊" (tech spec §4.3(4)).
 *
 * Findings pinned here:
 * 1. Schemas are plain Map structures built BY HAND (no POJO mapper in the core SDK) -
 *    the starter bridge feeds them from ToolExecutor#getParametersSchema.
 * 2. The canonicalized sha256 fingerprint computed on the server-side schema equals the one
 *    computed on what the CLIENT receives - the fingerprint is stable across the wire, so
 *    ia_tool_registry can fingerprint what it lists.
 * 3. tools/list_changed: removeTool/addTool push a notification the client receives via a
 *    registered toolsChangeConsumer - the live-refresh triage entry point.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class T07_SchemaFingerprintAndLiveRefreshTest {

	@LocalServerPort
	int port;

	@Autowired
	McpSyncServer statefulServer;

	@Autowired
	spike.bridge.server.BridgeObservatory observatory;

	private McpSyncClient client;

	private CountDownLatch toolsChanged;

	@AfterEach
	void tearDown() {
		restoreOriginalLookupTool();
		if (this.client != null) {
			this.client.closeGracefully();
			this.client = null;
		}
	}

	private McpSyncClient clientWithToolsChangedListener() {
		this.toolsChanged = new CountDownLatch(1);
		this.client = IaMcpClientFactory.create("http://localhost:" + this.port, IaMcpBridge.STATEFUL_ENDPOINT, "fp-act",
				"fp-user", "run-fp", tools -> this.toolsChanged.countDown());
		this.client.initialize();
		return this.client;
	}

	private McpSchema.Tool clientVisibleTool(String name) {
		return this.client.listTools().tools()
			.stream()
			.filter(t -> name.equals(t.name()))
			.findFirst()
			.orElseThrow(() -> new AssertionError("tool not listed: " + name));
	}

	@Test
	void schemaFingerprintIsStableAcrossTheWire() {
		this.client = IaMcpClientFactory.create("http://localhost:" + this.port, IaMcpBridge.STATEFUL_ENDPOINT, "fp-act",
				"fp-user", "run-fp", null);
		this.client.initialize();

		String serverSideFingerprint = SchemaFingerprints.fingerprint(IaTools.lookupTool().inputSchema());
		String clientSideFingerprint = SchemaFingerprints.fingerprint(clientVisibleTool(IaTools.LOOKUP).inputSchema());
		assertEquals(serverSideFingerprint, clientSideFingerprint,
				"canonicalized sha256 must be identical on both sides of the wire");

		// fingerprints distinguish schemas (the premise of the triage)
		Map<String, Object> mutated = new java.util.LinkedHashMap<>(IaTools.lookupTool().inputSchema());
		mutated.put("required", List.of("query", "extra"));
		assertNotEquals(serverSideFingerprint, SchemaFingerprints.fingerprint(mutated),
				"any schema change must move the fingerprint");
	}

	@Test
	void toolsListChangedNotificationReachesClientOnLiveRefresh() throws Exception {
		McpSyncClient listeningClient = clientWithToolsChangedListener();

		String before = SchemaFingerprints.fingerprint(clientVisibleTool(IaTools.LOOKUP).inputSchema());

		statefulServer.removeTool(IaTools.LOOKUP);
		statefulServer.addTool(lookupWithExtraRequiredParam());

		assertTrue(this.toolsChanged.await(15, TimeUnit.SECONDS),
				"tools/list_changed notification must reach the registered consumer");

		McpSchema.Tool refreshed = clientVisibleTool(IaTools.LOOKUP);
		assertTrue(requiredOf(refreshed).contains("locale"),
				"re-list reflects the new schema (增量差异可自动接受或分诊)");
		assertNotEquals(before, SchemaFingerprints.fingerprint(refreshed.inputSchema()),
				"security-relevant diff (new required param) is detectable via fingerprint");
		assertTrue(Boolean.TRUE.equals(refreshed.annotations().readOnlyHint()),
				"annotations remain available post-refresh (readOnlyHint true->false 检测的输入)");
	}

	private void restoreOriginalLookupTool() {
		try {
			statefulServer.removeTool(IaTools.LOOKUP);
		}
		catch (Exception ignored) {
			// not registered (test failed midway)
		}
		statefulServer.addTool(McpServerFeatures.SyncToolSpecification.builder()
			.tool(IaTools.lookupTool())
			.callHandler((exchange, request) -> IaTools.handleLookup(this.observatory, exchange.transportContext(),
					request))
			.build());
	}

	/** Same tool name, one MORE required param - the "security-relevant diff" case. */
	private McpServerFeatures.SyncToolSpecification lookupWithExtraRequiredParam() {
		Map<String, Object> schema = new java.util.LinkedHashMap<>();
		schema.put("type", "object");
		Map<String, Object> properties = new java.util.LinkedHashMap<>();
		properties.put("query", Map.of("type", "string"));
		properties.put("delayMs", Map.of("type", "integer"));
		properties.put("nonce", Map.of("type", "string"));
		properties.put("locale", Map.of("type", "string", "description", "NEW required param"));
		schema.put("properties", properties);
		schema.put("required", List.of("query", "locale"));
		McpSchema.Tool tool = McpSchema.Tool.builder(IaTools.LOOKUP, schema)
			.title("Host Lookup")
			.description("v2 - now requires locale")
			.annotations(McpSchema.ToolAnnotations.builder()
				.title("Host Lookup")
				.readOnlyHint(true)
				.idempotentHint(true)
				.build())
			.build();
		return McpServerFeatures.SyncToolSpecification.builder()
			.tool(tool)
			.callHandler((exchange, request) -> IaTools.handleLookup(this.observatory, exchange.transportContext(),
					request))
			.build();
	}

	private static List<String> requiredOf(McpSchema.Tool tool) {
		@SuppressWarnings("unchecked")
		Object required = ((Map<String, Object>) tool.inputSchema()).get("required");
		return required instanceof List<?> l ? l.stream().map(String::valueOf).toList() : List.of();
	}

}
