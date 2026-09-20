package com.inneragent.starter.testsupport;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.GeneralSecurityException;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * 测试用最小 act token 签发工具(不 import 主工程类;断言口径参考主工程
 * ActTokenIssuerTests:RS256 + RFC 8693 claims 形状 + kid 定位)。
 * kid 算法与主服务 ActTokenKeyManager.kidOf 一致:公钥 DER SHA-256 Base64URL 前 16 位。
 */
public final class TestActTokenFactory {

	public static final String ISSUER = "inneragent";

	private final KeyPair keyPair;
	private final String kid;
	private final String audience;

	public TestActTokenFactory(String audience) {
		this.audience = audience;
		this.keyPair = generateKeyPair();
		this.kid = kidOf((RSAPublicKey) this.keyPair.getPublic());
	}

	public String kid() {
		return this.kid;
	}

	public KeyPair keyPair() {
		return this.keyPair;
	}

	public RSAKey publicJwk() {
		return new RSAKey.Builder((RSAPublicKey) this.keyPair.getPublic()).keyID(this.kid).build();
	}

	/** 标准形态 token(与主服务 ActTokenIssuer claims 对齐):sub/act.sub/aud/appKey/tenantId/toolName/exp=+60s */
	public String issue(String sub, String runId) {
		return issue(sub, runId, Map.of());
	}

	/** claims 覆写:显式 null 移除该 claim */
	public String issue(String sub, String runId, Map<String, Object> overrides) {
		Map<String, Object> claims = new LinkedHashMap<>();
		claims.put("iss", ISSUER);
		claims.put("sub", sub);
		claims.put("aud", List.of(this.audience));
		claims.put("exp", Date.from(Instant.now().plusSeconds(60)));
		claims.put("iat", Date.from(Instant.now()));
		claims.put("act", Map.of("sub", "inneragent-run:" + runId));
		claims.put("appKey", "demo-app");
		claims.put("tenantId", 7);
		claims.put("toolName", "mcp__host__host_lookup");
		for (Map.Entry<String, Object> override : overrides.entrySet()) {
			if (override.getValue() == null) {
				claims.remove(override.getKey());
			}
			else {
				claims.put(override.getKey(), override.getValue());
			}
		}
		return sign(this.keyPair, this.kid, claims);
	}

	/** 用任意私钥 + 任意 kid 签(伪造用例:kid 声明为 A、私钥是 B) */
	public static String sign(KeyPair keyPair, String kid, Map<String, Object> claims) {
		JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder();
		claims.forEach(builder::claim);
		SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(), builder.build());
		try {
			jwt.sign(new RSASSASigner(keyPair.getPrivate()));
			return jwt.serialize();
		}
		catch (JOSEException signingFailure) {
			throw new IllegalStateException("测试 token 签发失败", signingFailure);
		}
	}

	/** 与主服务 ActTokenKeyManager.kidOf 相同的 kid 推导 */
	public static String kidOf(RSAPublicKey publicKey) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(publicKey.getEncoded());
			return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).substring(0, 16);
		}
		catch (GeneralSecurityException digestFailure) {
			throw new IllegalStateException(digestFailure);
		}
	}

	public static KeyPair generateKeyPair() {
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			return generator.generateKeyPair();
		}
		catch (GeneralSecurityException generationFailure) {
			throw new IllegalStateException(generationFailure);
		}
	}

}
