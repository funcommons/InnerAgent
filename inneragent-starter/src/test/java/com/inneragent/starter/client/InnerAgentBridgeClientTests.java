package com.inneragent.starter.client;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.starter.client.InnerAgentBridgeClient.ResolveScopeRequest;
import com.inneragent.starter.client.InnerAgentBridgeClient.ResolveScopeResult;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * InnerAgentBridgeClient 占位(P1-T2b 职责③):转发 resolve_scope 反查。
 * 契约 TODO(P1 收口对齐)—— 本类只钉住「已占位的路径/字段」与失败语义。
 */
class InnerAgentBridgeClientTests {

	private static final ObjectMapper JSON = new ObjectMapper();

	private final AtomicReference<String> path = new AtomicReference<>();
	private final AtomicReference<String> requestBody = new AtomicReference<>();
	private final AtomicReference<Integer> status = new AtomicReference<>(200);

	private HttpServer server;
	private int port;

	@BeforeEach
	void startStub() throws IOException {
		this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		this.port = this.server.getAddress().getPort();
		this.server.createContext("/ia/api/v1/tools/resolve-scope", exchange -> {
			this.path.set(exchange.getRequestURI().getPath());
			this.requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
			byte[] response = """
					{"visibleDomains":["page.objA"],"writableFields":["objA.title"],
					 "forbidden":["objA.delete"],"hints":["仅可编辑标题"]}
					""".getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(this.status.get(), response.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(response);
			}
		});
		this.server.start();
	}

	@AfterEach
	void stopStub() {
		this.server.stop(0);
	}

	private InnerAgentBridgeClient client() {
		return new InnerAgentBridgeClient("http://127.0.0.1:" + this.port + "/", JSON);
	}

	@Test
	void forwardsResolveScopeToContractPathAndParsesResult() {
		ResolveScopeResult result = client().resolveScope(new ResolveScopeRequest("10001", "7", "page-1", "首页",
				"obj-9", "CHANGE_ORDER", java.util.Map.of("kind", " urgent")));

		assertThat(this.path.get()).isEqualTo("/ia/api/v1/tools/resolve-scope");
		assertThat(this.requestBody.get()).contains("page-1").contains("obj-9").contains("urgent");
		assertThat(result.visibleDomains()).containsExactly("page.objA");
		assertThat(result.writableFields()).containsExactly("objA.title");
		assertThat(result.forbidden()).containsExactly("objA.delete");
		assertThat(result.hints()).containsExactly("仅可编辑标题");
	}

	@Test
	void non2xxResponseThrows() {
		this.status.set(500);
		assertThatThrownBy(() -> client().resolveScope(
				new ResolveScopeRequest("u", "t", "p", "n", "o", "T", java.util.Map.of())))
			.isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("500");
	}

	@Test
	void blankServerBaseThrowsWithClearReason() {
		InnerAgentBridgeClient unavailable = new InnerAgentBridgeClient("  ", JSON);
		assertThat(unavailable.available()).isFalse();
		assertThatThrownBy(() -> unavailable.resolveScope(
				new ResolveScopeRequest("u", "t", "p", "n", "o", "T", java.util.Map.of())))
			.isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("server-base");
	}

}
