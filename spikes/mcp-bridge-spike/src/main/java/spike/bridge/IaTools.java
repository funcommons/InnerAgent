package spike.bridge;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import spike.bridge.server.BridgeObservatory;

/**
 * The two example host tools (checklist item 3): one read, one write with annotations.
 *
 * This is the spike's model of the starter's tool bridge: it converts host tool beans
 * (ToolExecutor SPI in production) into MCP tool specifications. JSON schemas are
 * built BY HAND as plain maps - the official SDK core has no POJO-to-schema generator
 * (that lives in the Spring AI annotations module, which the tech spec excludes).
 * Production bridge takes the schema from ToolExecutor#getParametersSchema instead.
 */
public final class IaTools {

	public static final String LOOKUP = "host_lookup";

	public static final String CREATE_TICKET = "host_create_ticket";

	private IaTools() {
	}

	public static McpSchema.Tool lookupTool() {
		Map<String, Object> schema = new LinkedHashMap<>();
		schema.put("type", "object");
		Map<String, Object> properties = new LinkedHashMap<>();
		properties.put("query", Map.of("type", "string", "description", "free text to look up"));
		properties.put("delayMs", Map.of("type", "integer", "description", "artificial latency for concurrency tests"));
		properties.put("nonce", Map.of("type", "string", "description", "caller-provided correlation token"));
		schema.put("properties", properties);
		schema.put("required", List.of("query"));
		return McpSchema.Tool.builder(LOOKUP, schema)
			.title("Host Lookup")
			.description("Read-only host lookup tool (models a readOnlyHint=true ToolExecutor)")
			.annotations(McpSchema.ToolAnnotations.builder()
				.title("Host Lookup")
				.readOnlyHint(true)
				.idempotentHint(true)
				.destructiveHint(false)
				.openWorldHint(false)
				.build())
			.build();
	}

	public static McpSchema.Tool createTicketTool() {
		Map<String, Object> schema = new LinkedHashMap<>();
		schema.put("type", "object");
		Map<String, Object> properties = new LinkedHashMap<>();
		properties.put("title", Map.of("type", "string", "description", "ticket title"));
		properties.put("priority", Map.of("type", "string", "enum", List.of("low", "normal", "high")));
		schema.put("properties", properties);
		schema.put("required", List.of("title", "priority"));
		return McpSchema.Tool.builder(CREATE_TICKET, schema)
			.title("Host Create Ticket")
			.description("Mutating host tool (models a readOnlyHint=false ToolExecutor)")
			.annotations(McpSchema.ToolAnnotations.builder()
				.title("Host Create Ticket")
				.readOnlyHint(false)
				.destructiveHint(false)
				.idempotentHint(false)
				.openWorldHint(false)
				.build())
			.build();
	}

	/** Shared read handler. Returns identity + nonce so tests can prove end-to-end propagation and correlation. */
	public static McpSchema.CallToolResult handleLookup(BridgeObservatory observatory, McpTransportContext context,
			McpSchema.CallToolRequest request) {
		Map<String, Object> args = request.arguments();
		String query = String.valueOf(args.get("query"));
		String nonce = String.valueOf(args.getOrDefault("nonce", ""));
		String caller = String.valueOf(context.get(IaMcpBridge.CTX_IA_USER));
		String runId = String.valueOf(context.get(IaMcpBridge.CTX_IA_RUN));
		long delayMs = args.get("delayMs") instanceof Number n ? n.longValue() : 0;
		observatory.enterLookup();
		try {
			if (delayMs > 0) {
				try {
					Thread.sleep(delayMs);
				}
				catch (InterruptedException ex) {
					Thread.currentThread().interrupt();
				}
			}
			Map<String, Object> structured = new LinkedHashMap<>();
			structured.put("status", "ok");
			structured.put("query", query);
			structured.put("nonce", nonce);
			structured.put("caller", caller);
			structured.put("runId", runId);
			observatory.servedLookupNonces.add(nonce);
			return McpSchema.CallToolResult.builder()
				.addTextContent("lookup:" + query)
				.structuredContent(structured)
				.build();
		}
		finally {
			observatory.exitLookup();
		}
	}

	/** Shared write handler. */
	public static McpSchema.CallToolResult handleCreateTicket(BridgeObservatory observatory,
			McpTransportContext context, McpSchema.CallToolRequest request) {
		Map<String, Object> args = request.arguments();
		String caller = String.valueOf(context.get(IaMcpBridge.CTX_IA_USER));
		Map<String, Object> structured = new LinkedHashMap<>();
		structured.put("status", "ok");
		structured.put("ticketId", "T-" + observatory.ticketSeq.incrementAndGet());
		structured.put("title", String.valueOf(args.get("title")));
		structured.put("priority", String.valueOf(args.get("priority")));
		structured.put("createdBy", caller);
		return McpSchema.CallToolResult.builder()
			.addTextContent("ticket created")
			.structuredContent(structured)
			.build();
	}

	/** Stateful (session-based) specs: handler receives an exchange that carries McpTransportContext. */
	public static List<McpServerFeatures.SyncToolSpecification> statefulSpecs(BridgeObservatory observatory) {
		McpServerFeatures.SyncToolSpecification lookup = McpServerFeatures.SyncToolSpecification.builder()
			.tool(lookupTool())
			.callHandler((exchange, request) -> handleLookup(observatory, exchange.transportContext(), request))
			.build();
		McpServerFeatures.SyncToolSpecification ticket = McpServerFeatures.SyncToolSpecification.builder()
			.tool(createTicketTool())
			.callHandler((exchange, request) -> handleCreateTicket(observatory, exchange.transportContext(), request))
			.build();
		return List.of(lookup, ticket);
	}

	/** Stateless specs: the transport context arrives directly as a handler parameter. */
	public static List<McpStatelessServerFeatures.SyncToolSpecification> statelessSpecs(BridgeObservatory observatory) {
		McpStatelessServerFeatures.SyncToolSpecification lookup = McpStatelessServerFeatures.SyncToolSpecification
			.builder()
			.tool(lookupTool())
			.callHandler((context, request) -> handleLookup(observatory, context, request))
			.build();
		McpStatelessServerFeatures.SyncToolSpecification ticket = McpStatelessServerFeatures.SyncToolSpecification
			.builder()
			.tool(createTicketTool())
			.callHandler((context, request) -> handleCreateTicket(observatory, context, request))
			.build();
		return List.of(lookup, ticket);
	}

}
