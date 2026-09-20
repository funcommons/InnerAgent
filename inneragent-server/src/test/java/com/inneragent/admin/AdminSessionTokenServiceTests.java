package com.inneragent.admin;

import com.inneragent.server.admin.AdminSessionTokenService;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 管理会话 token 服务测试(签发/校验矩阵/吊销/密钥强度)。
 */
class AdminSessionTokenServiceTests {

    /** 32 字节测试密钥(HS256 下限) */
    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    private final AdminSessionTokenService service =
            new AdminSessionTokenService(SECRET, 4);

    @Test
    @DisplayName("签发→校验往返:sub=username、role=admin、jti 非空、exp≈now+TTL")
    void issueAndVerifyRoundTrip() {
        AdminSessionTokenService.IssuedToken issued = service.issue("ops-admin");

        AdminSessionTokenService.SessionPrincipal principal = service.verify(issued.token());
        assertThat(principal.username()).isEqualTo("ops-admin");
        assertThat(principal.jti()).isEqualTo(issued.jti());
        assertThat(principal.jti()).isNotBlank();
        long now = Instant.now().getEpochSecond();
        long expiresAt = principal.expiresAt().getEpochSecond();
        assertThat(expiresAt).isBetween(now + 3600L * 3, now + 3600L * 4);
    }

    @Test
    @DisplayName("篡改签名/伪造格式 → InvalidSessionTokenException(401 语义)")
    void tamperedOrMalformedTokensRejected() {
        AdminSessionTokenService.IssuedToken issued = service.issue("ops-admin");
        String tampered = issued.token().substring(0, issued.token().length() - 4) + "AAAA";

        assertThatThrownBy(() -> service.verify(tampered))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
        assertThatThrownBy(() -> service.verify("not-a-jwt"))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
    }

    @Test
    @DisplayName("过期 token 拒绝:同密钥自签 exp 过去时")
    void expiredTokenRejected() throws Exception {
        String expired = craft(SECRET, "inneragent-admin", "admin", Instant.now().minusSeconds(60));
        assertThatThrownBy(() -> service.verify(expired))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
    }

    @Test
    @DisplayName("凭据域隔离:embed/act 域签发者(inneragent)或非 admin 角色的 token 均拒绝")
    void foreignDomainTokensRejected() throws Exception {
        String wrongIssuer = craft(SECRET, "inneragent", "admin", Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> service.verify(wrongIssuer))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);

        String wrongRole = craft(SECRET, "inneragent-admin", "user", Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> service.verify(wrongRole))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
    }

    @Test
    @DisplayName("密钥域隔离:他方密钥签发的同域 token 拒绝")
    void foreignSecretRejected() throws Exception {
        String otherSecret = "ffffffffffffffffffffffffffffffff";
        String forged = craft(otherSecret, "inneragent-admin", "admin",
                Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> service.verify(forged))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
    }

    @Test
    @DisplayName("登出吊销:verify 通过→revoke→verify 拒绝;幂等不抛")
    void revokedTokenRejected() {
        AdminSessionTokenService.IssuedToken issued = service.issue("ops-admin");
        AdminSessionTokenService.SessionPrincipal principal = service.verify(issued.token());
        service.revoke(principal);
        assertThatThrownBy(() -> service.verify(issued.token()))
                .isInstanceOf(AdminSessionTokenService.InvalidSessionTokenException.class);
        // 幂等:重复 revoke 不抛
        org.assertj.core.api.Assertions.assertThatCode(() -> service.revoke(principal))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("密钥强度:未配置→临时密钥可用;过短(<32B)→启动失败")
    void secretStrengthEnforced() {
        AdminSessionTokenService ephemeral = new AdminSessionTokenService("", 4);
        AdminSessionTokenService.IssuedToken issued = ephemeral.issue("ops-admin");
        assertThat(ephemeral.verify(issued.token()).username()).isEqualTo("ops-admin");

        assertThatThrownBy(() -> new AdminSessionTokenService("short-secret", 4))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32");
    }

    /** 测试辅助:以指定密钥/iss/role 自签 token(过期与域隔离用例)。 */
    private static String craft(String secret, String issuer, String role, Instant expiresAt)
            throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject("ops-admin")
                .jwtID(java.util.UUID.randomUUID().toString())
                .claim("role", role)
                .expirationTime(Date.from(expiresAt))
                .issueTime(Date.from(Instant.now()))
                .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).build(), claims);
        jwt.sign(new MACSigner(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return jwt.serialize();
    }
}
