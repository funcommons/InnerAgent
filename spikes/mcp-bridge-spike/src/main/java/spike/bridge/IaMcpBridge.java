package spike.bridge;

import java.util.Map;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.McpTransportContextExtractor;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.servlet.http.HttpServletRequest;
import spike.bridge.server.ActTokenFilter;
import spike.bridge.server.BridgeObservatory;

/**
 * Wires the two server forms of the /ia-mcp bridge (checklist items 3 and 5):
 *
 * - STATEFUL: HttpServletStreamableServerTransportProvider + McpServer.sync(provider)
 *   (the 2025-06-18-generation shape: sessions + GET SSE stream + DELETE close).
 * - STATELESS: HttpServletStatelessServerTransport + McpServer.sync(statelessTransport)
 *   (the 2026-07-28-generation shape: POST-only JSON, no session ids, no GET stream,
 *   per-request independent semantics).
 *
 * Both share the same tool catalog (IaTools) and the same identity pipeline:
 * ActTokenFilter -> request attribute -> contextExtractor -> McpTransportContext -> tool handler.
 */
public final class IaMcpBridge {

	public static final String STATEFUL_ENDPOINT = "/ia-mcp";

	public static final String STATELESS_ENDPOINT = "/ia-mcp-stateless";

	public static final String CTX_IA_USER = "ia.user";

	public static final String CTX_IA_ACT_SUB = "ia.actSub";

	public static final String CTX_IA_RUN = "ia.run";

	private IaMcpBridge() {
	}

	/**
	 * SDK-sanctioned hook: per-request lift of HTTP data into McpTransportContext.
	 * This is where the starter rebuilds UserContext/ToolExecutionContext from the
	 * act token claims the ActTokenFilter stashed on the request.
	 */
	public static McpTransportContextExtractor<HttpServletRequest> identityContextExtractor() {
		return request -> {
			Object raw = request.getAttribute(ActTokenFilter.ATTR_ACT_CLAIMS);
			if (!(raw instanceof Map<?, ?> claims)) {
				return McpTransportContext.create(Map.of(CTX_IA_USER, "anonymous", CTX_IA_ACT_SUB, "", CTX_IA_RUN, ""));
			}
			Object actRaw = claims.get("act");
			Map<?, ?> act = actRaw instanceof Map<?, ?> m ? m : Map.of();
			Object runId = claims.get("runId");
			return McpTransportContext.create(Map.of(
					CTX_IA_USER, String.valueOf(claims.get("sub")),
					CTX_IA_ACT_SUB, String.valueOf(act.get("sub")),
					CTX_IA_RUN, runId == null ? "" : String.valueOf(runId)));
		};
	}

	/** 2025-06-18-generation transport: sessions, GET SSE stream, DELETE close. */
	public static HttpServletStreamableServerTransportProvider statefulTransportProvider() {
		return HttpServletStreamableServerTransportProvider.builder()
			.mcpEndpoint(STATEFUL_ENDPOINT)
			.contextExtractor(identityContextExtractor())
			.build();
	}

	public static McpSyncServer statefulServer(HttpServletStreamableServerTransportProvider provider,
			BridgeObservatory observatory) {
		return McpServer.sync(provider)
			.serverInfo("ia-spike-host", "1.0.0")
			.instructions("InnerAgent spike host bridge")
			.capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
			.tools(IaTools.statefulSpecs(observatory))
			.build();
	}

	/** 2026-07-28-generation transport: POST-only, no session storage, GET answered with 405. */
	public static HttpServletStatelessServerTransport statelessTransport() {
		return HttpServletStatelessServerTransport.builder()
			.messageEndpoint(STATELESS_ENDPOINT)
			.contextExtractor(identityContextExtractor())
			.build();
	}

	public static McpStatelessSyncServer statelessServer(HttpServletStatelessServerTransport transport,
			BridgeObservatory observatory) {
		return McpServer.sync(transport)
			.serverInfo("ia-spike-host", "1.0.0")
			.capabilities(McpSchema.ServerCapabilities.builder().tools(true).build())
			.tools(IaTools.statelessSpecs(observatory))
			.build();
	}

}
