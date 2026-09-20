package com.inneragent.starter.bridge;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.inneragent.starter.IaToolDefinition;
import com.inneragent.starter.IaToolInvoker;
import com.inneragent.starter.act.IaActClaims;
import com.inneragent.starter.act.IaActTokenFilter;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.McpTransportContextExtractor;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import jakarta.servlet.http.HttpServletRequest;

/**
 * MCP Server 桥(P1-T2b 职责①):宿主工具 → stateless 形态的 /ia-mcp。
 *
 * <p>形态裁定(FINDINGS §2.5/Q7):{@code HttpServletStatelessServerTransport} +
 * {@code McpServer.sync(statelessTransport)} —— GET→405、不下发 {@code Mcp-Session-Id}、
 * 每请求独立语义,同一端点同时兼容 2025-06-18(会话态客户端)与 2026-07-28
 * (裸 JSON-RPC)两代调用方。
 *
 * <p>动态刷新入口:{@link #register}/{@link #unregister} 运行期增删工具。注意
 * stateless 形态无 GET/SSE 通道,<strong>无法推送 tools/list_changed</strong>
 * (FINDINGS R4);主服务按周期性 listTools 指纹轮询感知变更 —— 本注册表即
 * 轮询可见的变更入口,桥侧不承担推送职责。
 */
public class IaMcpServerBridge {

	private final HttpServletStatelessServerTransport transport;
	private final McpStatelessSyncServer server;
	private final IaToolInvoker invoker;
	private final Set<String> registeredTools = ConcurrentHashMap.newKeySet();

	public IaMcpServerBridge(String endpoint, String serverName, String serverVersion, IaToolInvoker invoker) {
		if (endpoint == null || !endpoint.startsWith("/")) {
			throw new IllegalArgumentException("inneragent.bridge.endpoint 必须以 / 开头: " + endpoint);
		}
		this.invoker = invoker;
		this.transport = HttpServletStatelessServerTransport.builder()
			.messageEndpoint(endpoint)
			.contextExtractor(contextExtractor())
			.build();
		this.server = McpServer.sync(this.transport)
			.serverInfo(serverName, serverVersion)
			.capabilities(io.modelcontextprotocol.spec.McpSchema.ServerCapabilities.builder().tools(true).build())
			.build();
	}

	/** 挂到嵌入式 servlet 容器的传输(经 ServletRegistrationBean 注册在端点上)。 */
	public HttpServletStatelessServerTransport transport() {
		return this.transport;
	}

	public synchronized void register(IaToolDefinition definition) {
		this.server.addTool(specification(definition));
		this.registeredTools.add(definition.name());
	}

	public synchronized void unregister(String toolName) {
		this.server.removeTool(toolName);
		this.registeredTools.remove(toolName);
	}

	/** 当前已注册工具名(含宽限状态观测)。 */
	public Set<String> registeredTools() {
		return Set.copyOf(this.registeredTools);
	}

	private McpStatelessServerFeatures.SyncToolSpecification specification(IaToolDefinition definition) {
		return McpStatelessServerFeatures.SyncToolSpecification.builder()
			.tool(definition.toMcpTool())
			.callHandler((context, request) -> this.invoker.invoke(definition, context, request))
			.build();
	}

	/**
	 * SDK 官方挂点(FINDINGS §2.3 第三段):把 Filter 验签后暂存的 claims
	 * 提升为 {@code McpTransportContext},stateless 处理器直接以其为参数接收。
	 */
	private static McpTransportContextExtractor<HttpServletRequest> contextExtractor() {
		return request -> {
			if (request.getAttribute(IaActTokenFilter.ATTR_ACT_CLAIMS) instanceof IaActClaims claims) {
				return McpTransportContext.create(claims.toContextMap());
			}
			// 防御分支:正常流量已被 Filter 401,不应到达
			return McpTransportContext.create(Map.of());
		};
	}

}
