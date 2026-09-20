package com.inneragent.starter.testsupport;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Supplier;

import com.inneragent.starter.act.IaActTokenVerifier;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;

/**
 * 测试客户端工厂(spike IaMcpClientFactory 同款,对齐 FINDINGS §2.3 第一段挂点:
 * httpRequestCustomizer 每请求注入 X-IA-Act)+ 裸 JSON-RPC post 助手
 * (2026-07-28 无会话形态,FINDINGS T06 gen-B)。
 */
public final class McpClients {

	private McpClients() {
	}

	/** SDK Streamable HTTP 客户端:token 供应器返回 null 时不带头(negative 用例) */
	public static McpSyncClient sdk(String baseUrl, String endpoint, Supplier<String> tokenSupplier) {
		HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(baseUrl)
			.endpoint(endpoint)
			.httpRequestCustomizer((builder, method, uri, body, context) -> {
				String token = tokenSupplier.get();
				if (token != null) {
					builder.header(IaActTokenVerifier.ACT_HEADER, token);
				}
			})
			.build();
		return McpClient.sync(transport).requestTimeout(Duration.ofSeconds(15)).build();
	}

	public static HttpClient rawClient() {
		return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
	}

	/** 裸 JSON-RPC POST(无会话头;token 可空) */
	public static HttpResponse<String> rawPost(HttpClient http, String url, String token, String jsonBody)
			throws Exception {
		HttpRequest.Builder builder = HttpRequest.newBuilder()
			.uri(URI.create(url))
			.timeout(Duration.ofSeconds(10))
			.header("Accept", "application/json, text/event-stream")
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(jsonBody));
		if (token != null) {
			builder.header(IaActTokenVerifier.ACT_HEADER, token);
		}
		return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
	}

	public static HttpResponse<String> rawGet(HttpClient http, String url, String token) throws Exception {
		HttpRequest.Builder builder = HttpRequest.newBuilder()
			.uri(URI.create(url))
			.timeout(Duration.ofSeconds(10))
			.header("Accept", "text/event-stream")
			.GET();
		if (token != null) {
			builder.header(IaActTokenVerifier.ACT_HEADER, token);
		}
		return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
	}

}
