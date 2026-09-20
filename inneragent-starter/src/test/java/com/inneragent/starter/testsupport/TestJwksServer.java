package com.inneragent.starter.testsupport;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.RSAKey;
import com.sun.net.httpserver.HttpServer;

/**
 * 测试用 JWKS 端点(stand-in for InnerAgent /.well-known/jwks.json):
 * JDK 内置 HttpServer,可随时换 key 集(轮换用例)或停机(不可达 fail-closed 用例)。
 */
public final class TestJwksServer {

	private final ObjectMapper mapper = new ObjectMapper();
	private final AtomicReference<String> body = new AtomicReference<>("{\"keys\":[]}");
	private HttpServer server;
	private int port;

	public void start() throws IOException {
		this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		this.port = this.server.getAddress().getPort();
		this.server.createContext("/.well-known/jwks.json", exchange -> {
			byte[] payload = this.body.get().getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, payload.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(payload);
			}
		});
		this.server.start();
	}

	public void stop() {
		if (this.server != null) {
			this.server.stop(0);
			this.server = null;
		}
	}

	public boolean isRunning() {
		return this.server != null;
	}

	public int port() {
		return this.port;
	}

	public String base() {
		return "http://127.0.0.1:" + this.port;
	}

	/** 发布 key 集(轮换:替换即可,旧 key 从响应中消失) */
	public void setKeys(RSAKey... keys) {
		List<Object> jsonKeys = new ArrayList<>();
		for (RSAKey key : keys) {
			jsonKeys.add(key.toJSONObject());
		}
		try {
			this.body.set(this.mapper.writeValueAsString(Map.of("keys", jsonKeys)));
		}
		catch (IOException serializationFailure) {
			throw new IllegalStateException(serializationFailure);
		}
	}

	/** 直接发布任意 JWKS JSON(异常条目用例:EC key / 无 kid key) */
	public void setRawBody(String rawJwksJson) {
		this.body.set(rawJwksJson);
	}

}
