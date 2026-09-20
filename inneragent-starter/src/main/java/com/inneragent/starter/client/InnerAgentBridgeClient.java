package com.inneragent.starter.client;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 宿主 → InnerAgent 的 HTTP 客户端占位(P1-T2b 职责③)。
 *
 * <p><strong>starter 不签发 act token</strong>:act 由主服务 ActTokenIssuer 签发
 * (RS256,JWKS 发布于 /.well-known/jwks.json,starter 只消费,见职责②)。
 * 本客户端面向宿主侧回调/事件/反查转发场景 —— 当前仅实现 resolve_scope 反查请求
 * 的转发占位;宿主在自身 MCP 中实现 {@code resolve_scope} 工具时,可用本客户端
 * 把反查转发给 InnerAgent(或替换为宿主自有实现,PRD §6.1.4:宿主可覆写、
 * 未实现则走降级)。
 *
 * <p><strong>TODO(P1 收口对齐)</strong>:resolve_scope 反查的 REST 契约未定。
 * 当前占位:POST {@code {serverBase}/ia/api/v1/tools/resolve-scope},请求/响应字段
 * 取 PRD §6.1.4(入参 pageId/objectId/objectType/custom,出参 visibleDomains/
 * writableFields/forbidden/hints)。P1 收口若定为 MCP 内建工具转发,本方法退役或
 * 迁移,不留兼容负担。
 */
public class InnerAgentBridgeClient {

	/** TODO(P1 收口对齐):契约未定,路径为 /ia/api/v1 基路径下的占位值 */
	public static final String RESOLVE_SCOPE_PATH = "/ia/api/v1/tools/resolve-scope";

	private final String serverBase;
	private final ObjectMapper mapper;
	private final HttpClient http;

	public InnerAgentBridgeClient(String serverBase, ObjectMapper mapper) {
		this.serverBase = serverBase == null || serverBase.isBlank() ? null : stripTrailingSlash(serverBase);
		this.mapper = mapper;
		this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
	}

	/** serverBase 未配置时宿主仍可装配;调用即失败并给出明确原因。 */
	public boolean available() {
		return this.serverBase != null;
	}

	public ResolveScopeResult resolveScope(ResolveScopeRequest request) {
		if (!available()) {
			throw new IllegalStateException("inneragent.bridge.server-base 未配置,无法转发 resolve_scope 反查");
		}
		try {
			String body = this.mapper.writeValueAsString(request);
			HttpResponse<String> response = this.http.send(HttpRequest.newBuilder()
				.uri(URI.create(this.serverBase + RESOLVE_SCOPE_PATH))
				.timeout(Duration.ofSeconds(10))
				.header("Content-Type", "application/json")
				.header("Accept", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body))
				.build(), HttpResponse.BodyHandlers.ofString());
			if (response.statusCode() < 200 || response.statusCode() >= 300) {
				throw new IllegalStateException("resolve_scope 反查失败: HTTP " + response.statusCode());
			}
			return this.mapper.readValue(response.body(), ResolveScopeResult.class);
		}
		catch (IllegalStateException contractFailure) {
			throw contractFailure;
		}
		catch (Exception transportFailure) {
			throw new IllegalStateException("resolve_scope 反查请求不可达: " + transportFailure, transportFailure);
		}
	}

	private static String stripTrailingSlash(String base) {
		return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
	}

	/**
	 * 反查请求(PRD §6.1.4 前端上下文字段;TODO(P1 收口对齐):字段命名与携带方式)。
	 */
	public record ResolveScopeRequest(String userId, String tenantId, String pageId, String pageName, String objectId,
			String objectType, Map<String, Object> custom) {
	}

	/**
	 * 反查结果(可见对象域/可写字段/禁止操作/提示;宿主仍是最终权限裁决方,ADR-3)。
	 */
	public record ResolveScopeResult(List<String> visibleDomains, List<String> writableFields, List<String> forbidden,
			List<String> hints) {
	}

}
