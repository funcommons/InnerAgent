package com.inneragent.starter.act;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * act token JWKS 缓存(P1-T2b 职责②),语义对齐主服务 ActTokenKeyManager:
 * <ul>
 *   <li>从 {@code {serverBase}/.well-known/jwks.json} 拉取(JDK HttpClient,零额外依赖);</li>
 *   <li>按 TTL 周期刷新;kid 定位;未知 kid 触发一次受限强制刷新(cooldown 可配,
 *       防未知 kid 洪水放大拉取);</li>
 *   <li><strong>轮换宽限</strong>:某 key 从最新 JWKS 消失时本地保留
 *       {@code keyRetention}(默认 72h,与主服务 ActTokenKeyManager GRACE_PERIOD 对齐),
 *       供宿主侧过渡验签;拉取失败保留既有缓存(fail-closed 的兜底是「旧 key 仍可验、
 *       新 kid 拒绝」)。</li>
 * </ul>
 * 线程模型:读路径无锁(ConcurrentHashMap),刷新路径 synchronized 单飞。
 */
public class IaActJwksCache {

	private static final Logger log = LoggerFactory.getLogger(IaActJwksCache.class);

	private final URI jwksUri;
	private final Duration refreshTtl;
	private final Duration keyRetention;
	private final Duration forcedRefreshCooldown;
	private final Clock clock;
	private final HttpClient http;
	private final Map<String, CachedKey> keys = new ConcurrentHashMap<>();
	private volatile Instant lastRefreshAttemptAt = Instant.MIN;

	public IaActJwksCache(URI jwksUri, Duration refreshTtl, Duration keyRetention, Duration forcedRefreshCooldown,
			Clock clock) {
		this.jwksUri = jwksUri;
		this.refreshTtl = refreshTtl;
		this.keyRetention = keyRetention;
		this.forcedRefreshCooldown = forcedRefreshCooldown;
		this.clock = clock;
		this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
	}

	/** kid 定位;未知 kid 触发受限强制刷新,仍无则返回 null(调用方 fail-closed)。 */
	public RSAKey byKid(String kid) {
		if (this.jwksUri == null || kid == null || kid.isBlank()) {
			return null;
		}
		refreshIfDue(false);
		CachedKey cached = this.keys.get(kid);
		if (cached != null) {
			return cached.key();
		}
		refreshIfDue(true);
		CachedKey retried = this.keys.get(kid);
		return retried != null ? retried.key() : null;
	}

	/** 观测入口(运维/测试):当前缓存中的 kid 集合(含宽限期内的旧 key)。 */
	public Set<String> cachedKids() {
		return Set.copyOf(this.keys.keySet());
	}

	void refreshIfDue(boolean force) {
		Instant now = this.clock.instant();
		Duration cooldown = force ? this.forcedRefreshCooldown : this.refreshTtl;
		Instant last = this.lastRefreshAttemptAt;
		if (!last.equals(Instant.MIN) && last.plus(cooldown).isAfter(now)) {
			return;
		}
		synchronized (this) {
			if (!this.lastRefreshAttemptAt.equals(Instant.MIN)
					&& this.lastRefreshAttemptAt.plus(cooldown).isAfter(this.clock.instant())) {
				return;
			}
			this.lastRefreshAttemptAt = this.clock.instant();
			refresh(this.clock.instant());
		}
	}

	private void refresh(Instant now) {
		try {
			HttpRequest request = HttpRequest.newBuilder(this.jwksUri)
				.timeout(Duration.ofSeconds(5))
				.header("Accept", "application/json")
				.GET()
				.build();
			HttpResponse<String> response = this.http.send(request, HttpResponse.BodyHandlers.ofString());
			if (response.statusCode() < 200 || response.statusCode() >= 300) {
				throw new IllegalStateException("HTTP " + response.statusCode());
			}
			apply(JWKSet.parse(response.body()), now);
		}
		catch (Exception fetchFailure) {
			// fail-safe:拉取失败不清空既有缓存 —— 宽限期内旧 key 仍可验,新 kid 401
			log.warn("JWKS 拉取失败(保留既有 {} 把 key): {}", this.keys.size(), fetchFailure.toString());
		}
	}

	private void apply(JWKSet jwkSet, Instant now) {
		Map<String, RSAKey> fresh = new HashMap<>();
		for (JWK jwk : jwkSet.getKeys()) {
			if (!(jwk instanceof RSAKey rsaKey) || rsaKey.getKeyID() == null || rsaKey.getKeyID().isBlank()) {
				log.warn("JWKS 含非 RSA 或无 kid 的 key,已忽略(kind={})", jwk == null ? "null" : jwk.getClass().getSimpleName());
				continue;
			}
			fresh.put(rsaKey.getKeyID(), rsaKey.toRSAKey());
		}
		// 本轮消失的 key 打上 retiredAt(进入轮换宽限期);重現的 key 摘除标记
		for (Map.Entry<String, CachedKey> entry : this.keys.entrySet()) {
			if (!fresh.containsKey(entry.getKey()) && entry.getValue().retiredAt() == null) {
				entry.setValue(entry.getValue().retired(now));
				log.info("act token key 已从 JWKS 消失,进入轮换宽限期(保留至 {}): kid={}",
						now.plus(this.keyRetention), entry.getKey());
			}
		}
		for (Map.Entry<String, RSAKey> entry : fresh.entrySet()) {
			this.keys.put(entry.getKey(), new CachedKey(entry.getValue(), null));
		}
		// 宽限期届满淘汰
		this.keys.entrySet().removeIf(entry -> entry.getValue().retiredAt() != null
				&& entry.getValue().retiredAt().plus(this.keyRetention).isBefore(now));
	}

	private record CachedKey(RSAKey key, Instant retiredAt) {

		CachedKey retired(Instant at) {
			return new CachedKey(this.key, at);
		}
	}

}
