package com.inneragent.auth.act;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.inneragent.server.auth.act.ActTokenKeyManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * act token 签发→JWKS 公钥验回(P1-T1,02-技术方案 §6.1):
 * claims 按 RFC 8693 语义断言 + kid 存在。
 */
class ActTokenIssuerTests {

    private final ActTokenKeyManager keyManager = new ActTokenKeyManager(null, null);
    private final ActTokenIssuer issuer = new ActTokenIssuer(keyManager);

    @Test
    @DisplayName("签发→以 JWKS 公钥验回:claims 全量吻合")
    void issueThenVerifyWithJwksPublicKey() throws Exception {
        String token = issuer.issue(new ActTokenIssuer.ActTokenRequest(
                10001L, 7L, "demo-app", "run-abc-123", "mcp__host__update_page",
                "https://host.example.com/mcp"));

        SignedJWT jwt = SignedJWT.parse(token);
        // 验签公钥取自 JWKS 端点输出(与宿主侧 starter 相同路径)
        RSAKey jwk = jwkByKid(keyManager, jwt.getHeader().getKeyID());
        assertThat(jwk).as("JWKS 应包含 token header 的 kid").isNotNull();
        assertThat(jwt.verify(new RSASSAVerifier(jwk.toRSAPublicKey()))).isTrue();

        JWTClaimsSet claims = jwt.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("inneragent");
        assertThat(claims.getAudience()).containsExactly("https://host.example.com/mcp");
        assertThat(claims.getSubject()).isEqualTo("10001");
        // act.sub = 运行身份(RFC 8693 act 载荷);解析后为 JSON 对象(Map)
        Object act = claims.getClaim("act");
        assertThat(act).isInstanceOf(Map.class);
        assertThat(((Map<?, ?>) act).get("sub")).isEqualTo("inneragent-run:run-abc-123");
        assertThat(claims.getStringClaim("appKey")).isEqualTo("demo-app");
        assertThat(claims.getLongClaim("tenantId")).isEqualTo(7L);
        assertThat(claims.getStringClaim("toolName")).isEqualTo("mcp__host__update_page");
        // exp ≈ now+60s(短时效,仅覆盖单次内环调用)
        Instant exp = claims.getExpirationTime().toInstant();
        assertThat(exp).isAfter(Instant.now());
        assertThat(Math.abs(exp.getEpochSecond() - Instant.now().plusSeconds(60).getEpochSecond()))
                .isLessThanOrEqualTo(2);
        assertThat(jwt.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.RS256);
    }

    @Test
    @DisplayName("JWKS:当前 key 在列且带 kid;签名私钥不外泄")
    void jwksExposesOnlyPublicKeysWithKid() {
        List<JWK> keys = keyManager.publicJwks();

        assertThat(keys).hasSize(1);
        RSAKey jwk = keys.getFirst().toRSAKey();
        assertThat(jwk.getKeyID()).isNotBlank();
        assertThat(jwk.toJSONObject().containsKey("d")).as("不得泄露私钥参数").isFalse();
        assertThat(jwk.getModulus()).isEqualTo(keyManager.signingKey().toRSAKey().getModulus());
    }

    @Test
    @DisplayName("轮换:新 key 签发生效,旧 key 保留 JWKS 72h 宽限")
    void rotateKeepsOldKeyInGrace() throws Exception {
        String oldKid = keyManager.signingKey().getKeyID();
        String oldToken = issuer.issue(new ActTokenIssuer.ActTokenRequest(
                1L, 0L, "app", "run-1", "tool", "aud"));

        keyManager.rotate(generateRsa2048());

        String newKid = keyManager.signingKey().getKeyID();
        assertThat(newKid).isNotEqualTo(oldKid);
        List<JWK> keys = keyManager.publicJwks();
        assertThat(keys).hasSize(2);
        assertThat(keys.stream().map(JWK::getKeyID))
                .containsExactlyInAnyOrder(oldKid, newKid);

        // 新 token 由新 key 签发;旧 token 仍可用宽限中的旧 key 验签
        String newToken = issuer.issue(new ActTokenIssuer.ActTokenRequest(
                1L, 0L, "app", "run-2", "tool", "aud"));
        RSAKey oldJwk = jwkByKid(keyManager, oldKid);
        RSAKey newJwk = jwkByKid(keyManager, newKid);
        assertThat(SignedJWT.parse(oldToken).verify(new RSASSAVerifier(oldJwk.toRSAPublicKey())))
                .isTrue();
        assertThat(SignedJWT.parse(newToken).verify(new RSASSAVerifier(newJwk.toRSAPublicKey())))
                .isTrue();
    }

    private static RSAKey jwkByKid(ActTokenKeyManager manager, String kid) {
        return manager.publicJwks().stream()
                .map(JWK::toRSAKey)
                .filter(key -> key.getKeyID().equals(kid))
                .findFirst()
                .orElse(null);
    }

    private static KeyPair generateRsa2048() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
