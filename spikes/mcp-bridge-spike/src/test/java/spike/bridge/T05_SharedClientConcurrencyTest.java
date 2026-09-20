package spike.bridge;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import spike.bridge.client.IaMcpClientFactory;
import spike.bridge.server.BridgeObservatory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 2d: one shared McpSyncClient instance used by many threads concurrently.
 * Proves request/response correlation (no cross-talk) and server-side parallelism.
 * This is exactly InnerAgent's runtime shape: a single pooled client per host MCP endpoint
 * shared by all in-flight runs (§4.7: 单宿主 MCP 并发 8 / QPS 20).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class T05_SharedClientConcurrencyTest {

	private static final int THREADS = 16;

	private static final int CALLS_PER_THREAD = 2;

	@LocalServerPort
	int port;

	@Autowired
	BridgeObservatory observatory;

	private static ExecutorService pool;

	private static McpSyncClient sharedClient;

	@BeforeAll
	static void startPool() {
		pool = Executors.newFixedThreadPool(THREADS);
	}

	@AfterAll
	static void stopPool() {
		if (sharedClient != null) {
			sharedClient.closeGracefully();
		}
		if (pool != null) {
			pool.shutdownNow();
		}
	}

	@Test
	@SuppressWarnings("unchecked")
	void sharedClientHandlesConcurrentCallToolsWithoutCrossTalk() throws Exception {
		sharedClient = IaMcpClientFactory.create("http://localhost:" + this.port, IaMcpBridge.STATEFUL_ENDPOINT,
				"concurrent-act", "user-concurrent", "run-concurrent", null);
		sharedClient.initialize();

		int total = THREADS * CALLS_PER_THREAD;
		Set<String> nonces = ConcurrentHashMap.newKeySet();
		List<Future<Void>> futures = new ArrayList<>();
		for (int i = 0; i < total; i++) {
			final String nonce = "n-" + i;
			nonces.add(nonce);
			futures.add(pool.submit((Callable<Void>) () -> {
				McpSchema.CallToolResult result = sharedClient
					.callTool(McpSchema.CallToolRequest.builder(IaTools.LOOKUP)
						.arguments(Map.of("query", "q-" + nonce, "nonce", nonce, "delayMs", 200))
						.build());
				Map<String, Object> structured = (Map<String, Object>) result.structuredContent();
				assertEquals(nonce, structured.get("nonce"), "response belongs to the issuing request");
				assertEquals("user-concurrent", structured.get("caller"),
						"identity context not mixed across concurrent callers");
				return null;
			}));
		}
		for (Future<Void> future : futures) {
			future.get(Duration.ofSeconds(30).toSeconds(), TimeUnit.SECONDS);
		}

		assertEquals(total, this.observatory.servedLookupNonces.stream().filter(nonces::contains).distinct().count(),
				"every request was served exactly once");
		assertTrue(this.observatory.maxConcurrentLookups.get() > 1,
				"server processed requests in parallel (max in-flight: " + this.observatory.maxConcurrentLookups.get()
						+ ")");
	}

}
