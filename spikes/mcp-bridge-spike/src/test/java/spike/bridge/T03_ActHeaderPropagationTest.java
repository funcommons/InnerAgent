package spike.bridge;

import java.util.Map;

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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 3b: the X-IA-Act hook points.
 *
 * Positive path: client transport httpRequestCustomizer injects the header on every request
 * (the McpToolAdapter pattern), a servlet Filter validates it, the transport contextExtractor
 * lifts it into McpTransportContext, and the tool handler reads the verified identity.
 * Negative path: requests without the header are rejected by the filter with 401.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class T03_ActHeaderPropagationTest {

	@LocalServerPort
	int port;

	@Autowired
	BridgeObservatory observatory;

	@Test
	@SuppressWarnings("unchecked")
	void actHeaderFlowsFromClientThroughFilterIntoToolHandler() {
		McpSyncClient client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, "act-runner-7",
				"user-7", "run-42", null);
		try {
			client.initialize();
			McpSchema.CallToolResult result = client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
				.arguments(Map.of("query", "identity", "nonce", "n-act-1"))
				.build());
			Map<String, Object> structured = (Map<String, Object>) result.structuredContent();
			assertEquals("user-7", structured.get("caller"), "sub from act token claims reached the handler");
			assertEquals("run-42", structured.get("runId"), "runId claim reached the handler");
			assertTrue(this.observatory.actValidated.get() > 0, "filter validated at least one request");
			assertEquals("act-runner-7", this.observatory.lastValidatedActSub, "filter saw act.sub, not just sub");
		}
		finally {
			client.closeGracefully();
		}
	}

	@Test
	void requestsWithoutActHeaderAreRejectedByFilter() {
		int rejectedBefore = this.observatory.actRejected.get();
		McpSyncClient client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, null, null, null,
				null);
		try {
			assertThrows(RuntimeException.class, client::initialize,
					"initialize without X-IA-Act must be rejected by the filter");
		}
		finally {
			client.close();
		}
		assertTrue(this.observatory.actRejected.get() > rejectedBefore, "filter recorded the rejection");
	}

	private String baseUrl() {
		return "http://localhost:" + this.port;
	}

}
