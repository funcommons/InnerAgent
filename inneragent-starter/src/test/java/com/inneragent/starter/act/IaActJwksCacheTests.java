package com.inneragent.starter.act;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;

import com.inneragent.starter.testsupport.MutableClock;
import com.inneragent.starter.testsupport.TestActTokenFactory;
import com.inneragent.starter.testsupport.TestJwksServer;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.RSAKey;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JWKS 缓存单元用例:kid 定位、未知 kid 强制刷新、拉取失败保留缓存、
 * 轮换宽限期(保留 + 届满淘汰)、非 RSA/无 kid 条目忽略。
 */
class IaActJwksCacheTests {

	private static final Instant START = Instant.parse("2026-09-20T08:00:00Z");

	private final TestJwksServer jwks = new TestJwksServer();
	private final MutableClock clock = new MutableClock(START);
	private final TestActTokenFactory keyA = new TestActTokenFactory("aud");

	private IaActJwksCache cache;

	@BeforeEach
	void setUp() throws Exception {
		this.jwks.start();
		this.jwks.setKeys(this.keyA.publicJwk());
		this.cache = cacheWith(Duration.ofHours(72), Duration.ZERO);
	}

	@AfterEach
	void tearDown() {
		this.jwks.stop();
	}

	private IaActJwksCache cacheWith(Duration retention, Duration cooldown) {
		return new IaActJwksCache(URI.create(this.jwks.base() + "/.well-known/jwks.json"), Duration.ofSeconds(60),
				retention, cooldown, this.clock);
	}

	@Test
	void fetchesAndLocatesByKid() {
		assertThat(this.cache.byKid(this.keyA.kid()).getKeyID()).isEqualTo(this.keyA.kid());
		assertThat(this.cache.cachedKids()).containsExactly(this.keyA.kid());
	}

	@Test
	void unknownKidTriggersForcedRefresh() {
		TestActTokenFactory keyB = new TestActTokenFactory("aud");
		this.jwks.setKeys(this.keyA.publicJwk(), keyB.publicJwk());

		// cooldown=0:未知 kid 立即强制刷新拿到 B
		assertThat(this.cache.byKid(keyB.kid()).getKeyID()).isEqualTo(keyB.kid());
	}

	@Test
	void refreshFailureKeepsPreviousKeys() {
		// 先成功缓存 A,再让 JWKS 不可达
		assertThat(this.cache.byKid(this.keyA.kid())).isNotNull();
		this.jwks.stop();
		// 未知 kid 触发的刷新失败:返回 null,但既有 key 保留(宽限兜底)
		assertThat(this.cache.byKid("never-seen")).isNull();
		assertThat(this.cache.cachedKids()).containsExactly(this.keyA.kid());
	}

	@Test
	void retiredKeyDroppedAfterRetention() {
		TestActTokenFactory keyB = new TestActTokenFactory("aud");
		IaActJwksCache shortRetention = cacheWith(Duration.ofSeconds(120), Duration.ZERO);
		assertThat(shortRetention.byKid(this.keyA.kid())).isNotNull();

		// 轮换:A 消失进入宽限;宽限期内仍可验
		this.jwks.setKeys(keyB.publicJwk());
		this.clock.advance(Duration.ofSeconds(61)); // 越过 refreshTtl 触发刷新
		assertThat(shortRetention.byKid(this.keyA.kid())).isNotNull();
		assertThat(shortRetention.cachedKids()).containsExactlyInAnyOrder(this.keyA.kid(), keyB.kid());

		// 宽限届满(retiredAt+120s)+ 下次刷新:A 被淘汰
		this.clock.advance(Duration.ofSeconds(121));
		assertThat(shortRetention.byKid(this.keyA.kid())).isNull();
		assertThat(shortRetention.cachedKids()).containsExactly(keyB.kid());
	}

	@Test
	void nonRsaOrKidlessEntriesAreIgnored() throws Exception {
		java.security.KeyPairGenerator ecGenerator = java.security.KeyPairGenerator.getInstance("EC");
		ecGenerator.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
		java.security.KeyPair ecPair = ecGenerator.genKeyPair();
		ECKey ecKey = new ECKey.Builder(Curve.P_256,
				(java.security.interfaces.ECPublicKey) ecPair.getPublic()).build();
		RSAKey kidlessRsa = new RSAKey.Builder(this.keyA.publicJwk().toRSAPublicKey()).build();
		String mixed = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of("keys",
				java.util.List.of(ecKey.toJSONObject(), kidlessRsa.toJSONObject(), this.keyA.publicJwk().toJSONObject())));
		this.jwks.setRawBody(mixed);
		this.clock.advance(Duration.ofSeconds(61)); // 强制下一轮刷新吃到混合集

		// 混合集不致命:正常 A 仍可验,无 kid 条目被忽略(不覆盖 A)
		assertThat(this.cache.byKid(this.keyA.kid()).getKeyID()).isEqualTo(this.keyA.kid());
		assertThat(this.cache.cachedKids()).containsExactly(this.keyA.kid());
	}

}
