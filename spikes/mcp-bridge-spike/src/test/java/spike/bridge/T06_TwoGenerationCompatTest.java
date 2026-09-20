package spike.bridge;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import spike.bridge.client.IaMcpClientFactory;
import spike.bridge.server.ActTokens;
import spike.bridge.server.BridgeObservatory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 5 (Q7 / S11): can one endpoint serve BOTH client generations?
 *
 * The bridge endpoint under test is the STATELESS transport (/ia-mcp-stateless):
 * - generation A (2025-06-18 semantics): SDK Streamable HTTP client, session-aware.
 * - generation B (2026-07-28 semantics): raw JSON-RPC over HTTP, no session header at all,
 *   per-request independent calls (initialize not even required).
 *
 * The stateful transport (/ia-mcp) is probed negatively to document the asymmetry that
 * forces the bridge to be stateless.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class T06_TwoGenerationCompatTest {

	private static final ObjectMapper JSON = new ObjectMapper();

	@LocalServerPort
	int port;

	@Autowired
	BridgeObservatory observatory;

	@Test
	@SuppressWarnings("unchecked")
	void sdkSessionCapableClientWorksAgainstStatelessEndpoint() {
		McpSyncClient client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATELESS_ENDPOINT, "gen-a-act",
				"gen-a-user", "run-gen-a", null);
		try {
			client.initialize();
			McpSchema.ListToolsResult tools = client.listTools();
			assertTrue(tools.tools().stream().anyMatch(t -> IaTools.LOOKUP.equals(t.name())));
			McpSchema.CallToolResult result = client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
				.arguments(java.util.Map.of("query", "gen-a", "nonce", "gen-a-1"))
				.build());
			java.util.Map<String, Object> structured = (java.util.Map<String, Object>) result.structuredContent();
			assertEquals("gen-a-1", structured.get("nonce"));
			assertEquals("gen-a-user", structured.get("caller"), "identity also flows on the stateless path");
		}
		finally {
			client.closeGracefully();
		}
	}

	@Test
	void rawStatelessJsonRpcClientWorksEndToEndWithoutSessions() throws Exception {
		HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
		String url = baseUrl() + IaMcpBridge.STATELESS_ENDPOINT;
		String act = ActTokens.issue("raw-user", "raw-act", "run-raw");

		// --- initialize (2025-06-18 protocol version string; stateless servers negotiate per request) ---
		HttpResponse<String> init = post(http, url, act, null, """
				{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
				  "protocolVersion":"2025-06-18","capabilities":{},
				  "clientInfo":{"name":"raw-stateless-client","version":"0.0.1"}}}
				""");
		assertEquals(200, init.statusCode());
		JsonNode initResult = JSON.readTree(init.body()).path("result");
		assertFalse(initResult.path("protocolVersion").isMissingNode(), "initialize result returned");
		assertFalse(init.headers().firstValue("Mcp-Session-Id").isPresent(),
				"stateless bridge must NOT issue session ids");
		// no notifications/initialized follow-up is needed - asserted implicitly by the next call

		// --- tools/list without any session header ---
		HttpResponse<String> list = post(http, url, act, null,
				"""
				{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
				""");
		assertEquals(200, list.statusCode());
		JsonNode toolNames = JSON.readTree(list.body()).path("result").path("tools");
		boolean hasLookup = false;
		for (JsonNode tool : toolNames) {
			hasLookup |= IaTools.LOOKUP.equals(tool.path("name").asText());
		}
		assertTrue(hasLookup, "tools/list served on the stateless endpoint");

		// --- tools/call, first message of a fresh logical "session" (per-request independence) ---
		HttpResponse<String> call = post(http, url, act, null, """
				{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
				  "name":"host_lookup","arguments":{"query":"raw","nonce":"raw-1"}}}
				""");
		assertEquals(200, call.statusCode());
		assertEquals("raw-1", JSON.readTree(call.body())
			.path("result")
			.path("structuredContent")
			.path("nonce")
			.asText(), "structured content served to a sessionless caller with no prior initialize");
	}

	@Test
	void statelessEndpointIsFailClosedWithoutTokenAndPerRequestWithOne() throws Exception {
		HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
		String url = baseUrl() + IaMcpBridge.STATELESS_ENDPOINT;
		String callFmt = """
				{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{
				  "name":"host_lookup","arguments":{"query":"idem","nonce":"%s"}}}
				""";

		HttpResponse<String> anonymous = post(http, url, null, null, String.format(callFmt, 10, "anon-1"));
		assertEquals(401, anonymous.statusCode(), "no token -> filter rejects (fail-closed), nothing leaks");

		HttpResponse<String> authenticated = post(http, url, ActTokens.issue("raw-user", "raw-act", "run-raw"), null,
				String.format(callFmt, 11, "auth-1"));
		assertEquals(200, authenticated.statusCode());
		assertEquals("raw-user", JSON.readTree(authenticated.body())
			.path("result")
			.path("structuredContent")
			.path("caller")
			.asText(), "per-request identity straight from the token of THIS request");
	}

	@Test
	void statelessEndpointHasNoGetStreamDependency() throws Exception {
		HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
		HttpRequest request = HttpRequest.newBuilder()
			.uri(URI.create(baseUrl() + IaMcpBridge.STATELESS_ENDPOINT))
			.header("Accept", "text/event-stream")
			.header(ActTokens.HEADER, ActTokens.issue("raw-user", "raw-act", "run-raw"))
			.GET()
			.build();
		HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
		assertEquals(405, response.statusCode(), "GET (SSE stream) is not part of the stateless surface - S11");
	}

	@Test
	void statefulEndpointRejectsSessionlessCalls_documentingTheAsymmetry() throws Exception {
		HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
		HttpResponse<String> list = post(http, baseUrl() + IaMcpBridge.STATEFUL_ENDPOINT,
				ActTokens.issue("raw-user", "raw-act", "run-raw"), null,
				"""
				{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
				""");
		assertTrue(list.statusCode() >= 400 && list.statusCode() < 500,
				"a sessionless raw client cannot use the session-based transport (got " + list.statusCode()
						+ ") - this is why /ia-mcp must be the stateless form");
	}

	private HttpResponse<String> post(HttpClient http, String url, String actToken, String sessionId, String body)
			throws Exception {
		HttpRequest.Builder builder = HttpRequest.newBuilder()
			.uri(URI.create(url))
			.timeout(Duration.ofSeconds(10))
			.header("Accept", "application/json, text/event-stream")
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(body));
		if (actToken != null) {
			builder.header(ActTokens.HEADER, actToken);
		}
		if (sessionId != null) {
			builder.header("Mcp-Session-Id", sessionId);
		}
		return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
	}

	private String baseUrl() {
		return "http://localhost:" + this.port;
	}

}
