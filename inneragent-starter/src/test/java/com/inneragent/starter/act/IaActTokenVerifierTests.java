package com.inneragent.starter.act;

import java.net.URI;
import java.time.Duration;
import java.util.List;

import com.inneragent.starter.testsupport.TestActTokenFactory;
import com.inneragent.starter.testsupport.TestJwksServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验签器单元用例(断言口径对齐主工程 ActTokenIssuerTests:claims RFC 8693 全量吻合),
 * 签发走测试自备最小工具(不 import 主工程类)。
 */
class IaActTokenVerifierTests {

	private final TestJwksServer jwks = new TestJwksServer();
	private final TestActTokenFactory tokens = new TestActTokenFactory("ia-mcp-test");
	private final TestActTokenFactory offKey = new TestActTokenFactory("ia-mcp-test");

	private IaActTokenVerifier verifier;

	@BeforeEach
	void setUp() throws Exception {
		this.jwks.start();
		this.jwks.setKeys(this.tokens.publicJwk());
		this.verifier = new IaActTokenVerifier(
				new IaActJwksCache(URI.create(this.jwks.base() + "/.well-known/jwks.json"), Duration.ofSeconds(60),
						Duration.ofHours(72), Duration.ZERO, java.time.Clock.systemUTC()),
				"inneragent", List.of("ia-mcp-test"), Duration.ofSeconds(30), java.time.Clock.systemUTC());
	}

	@AfterEach
	void tearDown() {
		this.jwks.stop();
	}

	@Test
	@DisplayName("签发→验回:claims 全量吻合,runId 从 act.sub 前缀推导")
	void verifyReturnsRebuiltClaims() {
		IaActClaims claims = this.verifier.verify(this.tokens.issue("10001", "run-abc-123"));

		assertThat(claims.userId()).isEqualTo("10001");
		assertThat(claims.actSub()).isEqualTo("inneragent-run:run-abc-123");
		assertThat(claims.runId()).isEqualTo("run-abc-123");
		assertThat(claims.appKey()).isEqualTo("demo-app");
		assertThat(claims.tenantId()).isEqualTo("7");
		assertThat(claims.toolName()).isEqualTo("mcp__host__host_lookup");
	}

	@Test
	@DisplayName("显式 runId claim 优先于 act.sub 推导")
	void explicitRunIdClaimWins() {
		IaActClaims claims = this.verifier.verify(
				this.tokens.issue("10001", "run-abc", java.util.Map.of("runId", "run-explicit")));

		assertThat(claims.runId()).isEqualTo("run-explicit");
	}

	@Test
	@DisplayName("非 RS256 算法拒绝(HS256 不进入验签)")
	void nonRs256AlgorithmRejected() {
		String forgedAlg = stubJwt("{\"alg\":\"HS256\",\"kid\":\"" + this.tokens.kid() + "\"}");
		assertThatThrownBy(() -> this.verifier.verify(forgedAlg)).isInstanceOf(IaActTokenException.class);
	}

	@Test
	@DisplayName("缺 kid 的 header 拒绝")
	void kidlessHeaderRejected() {
		String kidless = stubJwt("{\"alg\":\"RS256\"}");
		assertThatThrownBy(() -> this.verifier.verify(kidless)).isInstanceOf(IaActTokenException.class);
	}

	private static String stubJwt(String headerJson) {
		java.util.Base64.Encoder encoder = java.util.Base64.getUrlEncoder().withoutPadding();
		return encoder.encodeToString(headerJson.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + "."
				+ encoder.encodeToString("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".stub";
	}

	@Test
	@DisplayName("未知 kid 抛 IaActTokenException")
	void unknownKidThrows() {
		assertThatThrownBy(() -> this.verifier.verify(this.offKey.issue("10001", "run-1")))
			.isInstanceOf(IaActTokenException.class)
			.hasMessageContaining("kid");
	}

}
