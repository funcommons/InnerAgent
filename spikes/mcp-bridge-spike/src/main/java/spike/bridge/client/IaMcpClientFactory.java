package spike.bridge.client;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import spike.bridge.server.ActTokens;

/**
 * Client-side factory - the spike's model of McpToolAdapter/McpClientBuilder (tech spec §4.3):
 * a Streamable HTTP client whose every HTTP request carries the X-IA-Act header built from
 * the run's ToolExecutionContext. The official hook for that is the transport's
 * httpRequestCustomizer; per-call context would go through
 * McpClient.SyncSpec#transportContextProvider.
 */
public final class IaMcpClientFactory {

	public static final String ACT_HEADER = ActTokens.HEADER;

	private IaMcpClientFactory() {
	}

	/**
	 * @param baseUrl      e.g. http://localhost:12345
	 * @param endpoint     e.g. /ia-mcp
	 * @param actSub       identity to send as act.sub (null = send nothing, for negative tests)
	 * @param userSub      identity to send as sub
	 * @param runId        run identifier carried in the token claims
	 * @param toolsChanged optional consumer for tools/list_changed notifications
	 */
	public static McpSyncClient create(String baseUrl, String endpoint, String actSub, String userSub, String runId,
			Consumer<List<McpSchema.Tool>> toolsChanged) {
		HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(baseUrl)
			.endpoint(endpoint)
			.httpRequestCustomizer((builder, method, uri, body, context) -> {
				if (actSub != null) {
					builder.header(ACT_HEADER, ActTokens.issue(userSub, actSub, runId));
				}
			})
			.build();

		McpClient.SyncSpec spec = McpClient.sync(transport)
			.requestTimeout(Duration.ofSeconds(15))
			.transportContextProvider(() -> McpTransportContext.create(Map.of("ia.run", runId == null ? "" : runId)));
		if (toolsChanged != null) {
			spec.toolsChangeConsumer(toolsChanged);
		}
		return spec.build();
	}

}
