package spike.bridge;

import java.net.ServerSocket;
import java.time.Duration;
import java.util.Map;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import spike.bridge.client.IaMcpClientFactory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 2c: server restart and client recovery.
 *
 * The bridge is a remote host application from InnerAgent's point of view - it will restart
 * independently. This test pins down what the SDK does and does not do automatically:
 * expected outcome is that the client does NOT silently re-initialize; McpToolCatalog must
 * detect the failure and re-run initialize() (or rebuild the client) with backoff.
 */
class T04_ServerRestartRecoveryTest {

	private static String observedOldClientAfterRestart = "(not exercised)";

	private static String observedReInitializeOutcome = "(not exercised)";

	private ConfigurableApplicationContext context;

	private int port;

	@Test
	@SuppressWarnings("unchecked")
	void clientRecoversViaReInitializeAfterServerRestart() throws Exception {
		this.port = freePort();
		startContext();

		McpSyncClient client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, "r1", "u1", "run1",
				null);
		try {
			client.initialize();
			McpSchema.CallToolResult before = client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
				.arguments(Map.of("query", "pre-restart"))
				.build());
			assertEquals("ok", ((Map<String, Object>) before.structuredContent()).get("status"));

			// --- restart the host application (same port, fresh sessions) ---
			this.context.close();
			assertThrows(RuntimeException.class, () -> client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
				.arguments(Map.of("query", "during-outage"))
				.build()), "calls must fail while the host bridge is down");

			startContext();

			// Old client still holds the dead session id. Observe (not assert) what the SDK does.
			try {
				McpSchema.CallToolResult r = client.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
					.arguments(Map.of("query", "post-restart-old-session"))
					.build());
				observedOldClientAfterRestart = "SUCCEEDED without re-initialize (structured=" + r.structuredContent()
						+ ")";
			}
			catch (Exception ex) {
				observedOldClientAfterRestart = "FAILED with " + ex.getClass().getName() + ": " + rootMessage(ex);
			}

			// Recovery path: explicit re-initialize on the same client instance.
			boolean reInitWorked;
			try {
				client.initialize();
				reInitWorked = true;
				observedReInitializeOutcome = "initialize() on existing client worked";
			}
			catch (Exception ex) {
				reInitWorked = false;
				observedReInitializeOutcome = "initialize() on existing client threw " + ex.getClass().getSimpleName()
						+ " - client must be recreated";
			}

			McpSyncClient healthyClient = client;
			if (!reInitWorked) {
				healthyClient = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, "r1", "u1", "run1",
						null);
				healthyClient.initialize();
			}
			try {
				McpSchema.CallToolResult after = healthyClient
					.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
						.arguments(Map.of("query", "post-restart-recovered"))
						.build());
				assertEquals("ok", ((Map<String, Object>) after.structuredContent()).get("status"),
						"after re-initialize (or rebuild) the bridge is fully usable again");
			}
			finally {
				if (healthyClient != client) {
					healthyClient.closeGracefully();
				}
			}
			System.out.println("[T04] old-client call after restart: " + observedOldClientAfterRestart);
			System.out.println("[T04] re-initialize outcome: " + observedReInitializeOutcome);
		}
		finally {
			client.close();
			stopContext();
		}
	}

	@Test
	void gracefulCloseReleasesServerSession() throws Exception {
		this.port = freePort();
		startContext();
		McpSyncClient client = IaMcpClientFactory.create(baseUrl(), IaMcpBridge.STATEFUL_ENDPOINT, "r2", "u2", "run2",
				null);
		try {
			client.initialize();
			assertTrue(client.isInitialized());
			assertTrue(client.closeGracefully(), "DELETE (session close) accepted by the transport");
			assertFalse(client.isInitialized(), "client reports uninitialized after graceful close");
		}
		finally {
			client.close();
			stopContext();
		}
	}

	private void startContext() throws InterruptedException {
		for (int attempt = 0; attempt < 40; attempt++) {
			try {
				// command line args beat application.properties (builder .properties() would NOT)
				this.context = new SpringApplicationBuilder(BridgeApp.class)
					.run("--server.port=" + this.port, "--spring.jmx.enabled=false");
				return;
			}
			catch (Exception ex) {
				Thread.sleep(250); // port not released yet after close()
			}
		}
		throw new IllegalStateException("could not start bridge context on port " + this.port);
	}

	private void stopContext() {
		if (this.context != null) {
			this.context.close();
			this.context = null;
		}
	}

	private static String rootMessage(Throwable ex) {
		Throwable cur = ex;
		while (cur.getCause() != null && cur.getCause() != cur) {
			cur = cur.getCause();
		}
		return String.valueOf(cur.getMessage());
	}

	private String baseUrl() {
		return "http://localhost:" + this.port;
	}

	private static int freePort() throws Exception {
		try (ServerSocket socket = new ServerSocket(0)) {
			return socket.getLocalPort();
		}
	}

}
