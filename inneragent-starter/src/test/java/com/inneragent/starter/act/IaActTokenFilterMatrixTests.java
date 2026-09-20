package com.inneragent.starter.act;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;

import com.inneragent.starter.TestHostApp;
import com.inneragent.starter.testsupport.McpClients;
import com.inneragent.starter.testsupport.TestActTokenFactory;
import com.inneragent.starter.testsupport.TestJwksServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * X-IA-Act 验签矩阵(P1-T2b 职责②,失败一律 401 fail-closed):
 * 有效 / 过期 / 错 kid / 缺 claims / 伪造 / iss / aud / JWKS 不可达 / 轮换宽限。
 * JWKS 由进程内 TestJwksServer 提供(不起真 InnerAgent)。
 */
@SpringBootTest(classes = TestHostApp.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "inneragent.bridge.act.audiences=ia-mcp-test",
				"inneragent.bridge.act.cache-ttl=100ms",
				"inneragent.bridge.act.forced-refresh-cooldown=0s" })
class IaActTokenFilterMatrixTests {

	/** JWKS 中登记的密钥(A;轮换用例后变为 B,但 A 因宽限仍可验) */
	private static final TestActTokenFactory KEY_A = new TestActTokenFactory("ia-mcp-test");
	/** 轮换后的 JWKS 密钥(B) */
	private static final TestActTokenFactory KEY_B = new TestActTokenFactory("ia-mcp-test");
	/** 从不在 JWKS 中的密钥(C:未知 kid / 伪造签名用例) */
	private static final TestActTokenFactory KEY_C = new TestActTokenFactory("ia-mcp-test");

	private static final TestJwksServer JWKS = new TestJwksServer();

	@LocalServerPort
	int port;

	@BeforeAll
	static void startJwks() throws Exception {
		JWKS.start();
		JWKS.setKeys(KEY_A.publicJwk());
	}

	@AfterAll
	static void stopJwks() {
		JWKS.stop();
	}

	@DynamicPropertySource
	static void bridgeProperties(DynamicPropertyRegistry registry) {
		registry.add("inneragent.bridge.server-base", () -> JWKS.base());
	}

	private HttpResponse<String> listToolsWith(String token) throws Exception {
		return McpClients.rawPost(McpClients.rawClient(), "http://127.0.0.1:" + this.port + "/ia-mcp", token, """
				{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
				""");
	}

	@Test
	void validTokenIsAccepted() throws Exception {
		assertThat(listToolsWith(KEY_A.issue("10001", "run-1")).statusCode()).isEqualTo(200);
	}

	/** 允许 null 值的覆写 Map(null = 移除该 claim) */
	private static java.util.Map<String, Object> overrides(Object... keyValues) {
		java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
		for (int i = 0; i < keyValues.length; i += 2) {
			map.put((String) keyValues[i], keyValues[i + 1]);
		}
		return map;
	}

	@Test
	void expiredTokenIsRejected() throws Exception {
		String expired = KEY_A.issue("10001", "run-1",
				overrides("exp", java.util.Date.from(java.time.Instant.now().minusSeconds(300))));
		assertThat(listToolsWith(expired).statusCode()).isEqualTo(401);
	}

	@Test
	void unknownKidIsRejected() throws Exception {
		// KEY_C 的 kid 从不在 JWKS 中:强制刷新后仍无 → fail-closed
		assertThat(listToolsWith(KEY_C.issue("10001", "run-1")).statusCode()).isEqualTo(401);
	}

	@Test
	void forgedSignatureIsRejected() throws Exception {
		// kid 声明为 JWKS 中的 A,但私钥是 C —— 签名校验必须失败
		String forged = TestActTokenFactory.sign(KEY_C.keyPair(), KEY_A.kid(),
				new com.nimbusds.jwt.JWTClaimsSet.Builder()
					.issuer("inneragent")
					.subject("10001")
					.audience("ia-mcp-test")
					.expirationTime(java.util.Date.from(java.time.Instant.now().plusSeconds(60)))
					.claim("act", java.util.Map.of("sub", "inneragent-run:run-evil"))
					.build()
					.getClaims());
		assertThat(listToolsWith(forged).statusCode()).isEqualTo(401);
	}

	@Test
	void missingSubIsRejected() throws Exception {
		assertThat(listToolsWith(KEY_A.issue("", "run-1")).statusCode()).isEqualTo(401);
	}

	@Test
	void missingExpIsRejected() throws Exception {
		assertThat(listToolsWith(KEY_A.issue("10001", "run-1", overrides("exp", null))).statusCode())
			.isEqualTo(401);
	}

	@Test
	void missingActClaimStillAcceptedWhenSubPresent() throws Exception {
		// act.sub 缺失:runId 推导为空串,但验签只强约束 sub/exp/iss/aud(字段可缺省传播空值)
		String token = KEY_A.issue("10001", "run-1", overrides("act", null, "runId", "run-explicit"));
		assertThat(listToolsWith(token).statusCode()).isEqualTo(200);
	}

	@Test
	void wrongIssuerIsRejected() throws Exception {
		String token = KEY_A.issue("10001", "run-1", java.util.Map.of("iss", "someone-else"));
		assertThat(listToolsWith(token).statusCode()).isEqualTo(401);
	}

	@Test
	void wrongAudienceIsRejected() throws Exception {
		String token = KEY_A.issue("10001", "run-1", java.util.Map.of("aud", java.util.List.of("other-host")));
		assertThat(listToolsWith(token).statusCode()).isEqualTo(401);
	}

	@Test
	void missingHeaderAndMalformedTokenAreRejected() throws Exception {
		assertThat(listToolsWith(null).statusCode()).isEqualTo(401);
		assertThat(listToolsWith("garbage.not-a-jwt").statusCode()).isEqualTo(401);
	}

	@Test
	void jwksUnreachableFailsClosed() throws Exception {
		// 未验过的 kid + JWKS 不可达:强制刷新失败且无缓存 → 401,绝不放行
		JWKS.stop();
		try {
			assertThat(listToolsWith(KEY_C.issue("10001", "run-1")).statusCode()).isEqualTo(401);
		}
		finally {
			JWKS.start();
			JWKS.setKeys(KEY_A.publicJwk());
		}
	}

	@Test
	void rotationKeepsOldKeyVerifiableWithinGrace() throws Exception {
		String oldToken = KEY_A.issue("10001", "run-old");

		// 轮换:JWKS 换成 B,A 从响应中消失(starter 侧宽限默认 72h,此处进程内验证)
		JWKS.setKeys(KEY_B.publicJwk());

		// 新 key 的 token:未知 kid → 强制刷新拿到 B → 通过
		assertThat(listToolsWith(KEY_B.issue("10001", "run-new")).statusCode()).isEqualTo(200);
		// 旧 key 的 token:虽已不在 JWKS,宽限期内本地保留仍可验
		assertThat(listToolsWith(oldToken).statusCode()).isEqualTo(200);
	}

}
