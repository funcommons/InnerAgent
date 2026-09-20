package com.inneragent.starter.act;

import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * act token 验签(P1-T2b 职责②):RS256 + exp/nbf + iss + aud 全量校验,
 * 任一不满足抛 {@link IaActTokenException}(Filter 统一 401 fail-closed)。
 *
 * <p>契约(02-技术方案 §6.1,「P1 收口对齐」核对点):{@code iss}="inneragent"、
 * {@code aud}=宿主 MCP URI(audience 绑定)、{@code sub}=终端用户、exp 60s 短时效。
 * aud 期望值默认占位,宿主按注册到主服务的 MCP URI 配置。
 */
public class IaActTokenVerifier {

	/** 自定义头(不占用 Authorization,02-技术方案 §6.1) */
	public static final String ACT_HEADER = "X-IA-Act";

	private static final Logger log = LoggerFactory.getLogger(IaActTokenVerifier.class);

	private final IaActJwksCache jwksCache;
	private final String expectedIssuer;
	private final Set<String> expectedAudiences;
	private final Duration clockSkew;
	private final Clock clock;

	public IaActTokenVerifier(IaActJwksCache jwksCache, String expectedIssuer, List<String> expectedAudiences,
			Duration clockSkew, Clock clock) {
		this.jwksCache = jwksCache;
		this.expectedIssuer = expectedIssuer;
		this.expectedAudiences = Set.copyOf(expectedAudiences);
		this.clockSkew = clockSkew;
		this.clock = clock;
	}

	/** 验签并重建身份;失败抛 {@link IaActTokenException}。 */
	public IaActClaims verify(String token) {
		if (token == null || token.isBlank()) {
			throw new IaActTokenException("缺少 " + ACT_HEADER);
		}
		SignedJWT jwt = parse(token);
		if (!JWSAlgorithm.RS256.equals(jwt.getHeader().getAlgorithm())) {
			throw new IaActTokenException("alg 必须为 RS256");
		}
		String kid = jwt.getHeader().getKeyID();
		if (kid == null || kid.isBlank()) {
			throw new IaActTokenException("缺少 kid");
		}
		RSAKey key = this.jwksCache.byKid(kid);
		if (key == null) {
			throw new IaActTokenException("kid 未知(且 JWKS 中无此 key): " + kid);
		}
		try {
			if (!jwt.verify(new RSASSAVerifier(key.toRSAPublicKey()))) {
				throw new IaActTokenException("签名校验失败");
			}
		}
		catch (IaActTokenException verificationFailure) {
			throw verificationFailure;
		}
		catch (Exception keyFailure) {
			throw new IaActTokenException("验签公钥不可用");
		}
		IaActClaims claims;
		try {
			claims = checkClaims(jwt.getJWTClaimsSet());
		}
		catch (java.text.ParseException unreadableClaims) {
			throw new IaActTokenException("claims 不可解析");
		}
		log.debug("act token 验签通过: userId={}, toolName={}, kid={}", claims.userId(), claims.toolName(), kid);
		return claims;
	}

	private static SignedJWT parse(String token) {
		try {
			return SignedJWT.parse(token);
		}
		catch (Exception malformed) {
			throw new IaActTokenException("token 不是合法的 JWT");
		}
	}

	private IaActClaims checkClaims(JWTClaimsSet claims) {
		Instant now = this.clock.instant();
		Date expiration = claims.getExpirationTime();
		if (expiration == null) {
			throw new IaActTokenException("缺少 exp");
		}
		if (expiration.toInstant().plus(this.clockSkew).isBefore(now)) {
			throw new IaActTokenException("token 已过期");
		}
		Date notBefore = claims.getNotBeforeTime();
		if (notBefore != null && notBefore.toInstant().minus(this.clockSkew).isAfter(now)) {
			throw new IaActTokenException("token 尚未生效");
		}
		if (!this.expectedIssuer.equals(claims.getIssuer())) {
			throw new IaActTokenException("iss 不匹配");
		}
		List<String> audience = claims.getAudience();
		if (audience == null || audience.stream().noneMatch(this.expectedAudiences::contains)) {
			throw new IaActTokenException("aud 不匹配");
		}
		String subject = claims.getSubject();
		if (subject == null || subject.isBlank()) {
			throw new IaActTokenException("缺少 sub");
		}
		return IaActClaims.from(claims.getClaims());
	}

}
