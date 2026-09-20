package com.inneragent.auth;

import com.inneragent.auth.support.EmbedTokenTestSupport;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.auth.AppSigningKeyProvider;
import com.inneragent.server.auth.EmbedTokenVerifier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * embed token 验签矩阵单测(P1-T1,开发计划 §6 令牌矩阵):
 * 有效 / 过期 / 篡改签名 / 错 appKey / alg=none / 缺 sub / 轮换宽限期双 key。
 * 内存认钥假实现,不依赖 DB。
 */
class EmbedTokenVerifierTests {

    private static final String APP_KEY = "demo-app";

    /** 轮换前的旧 keypair(P2-key 宽限期验签链用) */
    private static final java.security.KeyPair PREVIOUS_KEY =
            EmbedTokenTestSupport.generateKeyPair();

    private EmbedTokenVerifier verifier;

    @BeforeEach
    void setUp() {
        // 内存 ia_app 假实现:仅注册 demo-app → 测试公钥(未轮换,无 previous)
        verifier = new EmbedTokenVerifier(new InMemoryAppSigningKeys(Map.of(
                APP_KEY, new AppSigningKeyProvider.AppSigningKey(
                        42L, APP_KEY, EmbedTokenTestSupport.publicKey(), null))));
    }

    /** 组装带轮换宽限公钥的验证器(previous 供宽限期内存量令牌验签) */
    private EmbedTokenVerifier verifierWithPreviousKey() {
        return new EmbedTokenVerifier(new InMemoryAppSigningKeys(Map.of(
                APP_KEY, new AppSigningKeyProvider.AppSigningKey(
                        42L, APP_KEY, EmbedTokenTestSupport.publicKey(),
                        (RSAPublicKey) PREVIOUS_KEY.getPublic()))));
    }

    @Test
    @DisplayName("有效令牌:验签通过并解出 appId/appKey/userId/tenantId")
    void validTokenPasses() {
        String token = EmbedTokenTestSupport.validToken(
                APP_KEY, 10001L, 7L,
                new Date(System.currentTimeMillis() + 600_000));

        EmbedTokenVerifier.EmbedTokenClaims claims = verifier.verify(token);

        assertThat(claims.appId()).isEqualTo(42L);
        assertThat(claims.appKey()).isEqualTo(APP_KEY);
        assertThat(claims.userId()).isEqualTo(10001L);
        assertThat(claims.tenantId()).isEqualTo(7L);
    }

    @Test
    @DisplayName("过期令牌:拒绝(401 语义)")
    void expiredTokenRejected() {
        String token = EmbedTokenTestSupport.validToken(
                APP_KEY, 10001L, 7L,
                new Date(System.currentTimeMillis() - 1_000));

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("过期");
    }

    @Test
    @DisplayName("缺 exp:拒绝")
    void missingExpirationRejected() {
        String token = EmbedTokenTestSupport.sign(Map.of(
                "iss", APP_KEY, "sub", "10001"));

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("exp");
    }

    @Test
    @DisplayName("伪造签名(外域私钥):拒绝")
    void forgedSignatureRejected() {
        String token = EmbedTokenTestSupport.tokenSignedWithForeignKey(APP_KEY, 10001L);

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("签名不匹配");
    }

    @Test
    @DisplayName("篡改载荷(保留原签名):拒绝")
    void tamperedPayloadRejected() {
        String valid = EmbedTokenTestSupport.validToken(
                APP_KEY, 10001L, 7L, new Date(System.currentTimeMillis() + 600_000));
        String forgedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("{\"iss\":\"" + APP_KEY + "\",\"sub\":\"1\",\"exp\":9999999999}")
                        .getBytes());
        String tampered = EmbedTokenTestSupport.tamperedToken(valid, forgedPayload);

        assertThatThrownBy(() -> verifier.verify(tampered))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("签名不匹配");
    }

    @Test
    @DisplayName("错 appKey(iss 未注册):拒绝")
    void unknownAppKeyRejected() {
        String token = EmbedTokenTestSupport.validToken(
                "not-registered", 10001L, 7L,
                new Date(System.currentTimeMillis() + 600_000));

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not-registered");
    }

    @Test
    @DisplayName("alg=none 未签名令牌:拒绝(防算法混淆)")
    void algNoneRejected() {
        String token = EmbedTokenTestSupport.unsignedToken(APP_KEY, 10001L);

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("alg=HS256 混淆令牌:拒绝并点名 RS256")
    void hmacConfusionRejected() {
        String token = EmbedTokenTestSupport.hmacToken(APP_KEY, 10001L);

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("RS256");
    }

    @Test
    @DisplayName("缺 sub:拒绝")
    void missingSubjectRejected() {
        String token = EmbedTokenTestSupport.sign(new HashMap<>(Map.of(
                "iss", APP_KEY,
                "exp", new Date(System.currentTimeMillis() + 600_000))));

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("sub");
    }

    @Test
    @DisplayName("sub 非 Long:拒绝")
    void nonNumericSubjectRejected() {
        String token = EmbedTokenTestSupport.sign(Map.of(
                "iss", APP_KEY,
                "sub", "not-a-number",
                "exp", new Date(System.currentTimeMillis() + 600_000)));

        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("sub");
    }

    @Test
    @DisplayName("缺 tenantId claim:缺省租户 0(与 ia_* 表 DDL 默认一致)")
    void missingTenantDefaultsToZero() {
        String token = EmbedTokenTestSupport.sign(Map.of(
                "iss", APP_KEY,
                "sub", "10001",
                "exp", new Date(System.currentTimeMillis() + 600_000)));

        EmbedTokenVerifier.EmbedTokenClaims claims = verifier.verify(token);

        assertThat(claims.tenantId()).isZero();
    }

    @Test
    @DisplayName("空串令牌与乱码:拒绝")
    void garbageTokenRejected() {
        assertThatThrownBy(() -> verifier.verify("garbage"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> verifier.verify("  "))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("轮换宽限期内:旧私钥签发的存量令牌经 previous key 验签通过")
    void oldKeyTokenPassesWithinGrace() {
        // 宿主轮换公钥前签发的存量 token(旧私钥),宽限期内 provider 仍暴露旧公钥
        String legacyToken = EmbedTokenTestSupport.signWith(PREVIOUS_KEY, Map.of(
                "iss", APP_KEY,
                "sub", "10001",
                "exp", new Date(System.currentTimeMillis() + 600_000)));

        EmbedTokenVerifier.EmbedTokenClaims claims =
                verifierWithPreviousKey().verify(legacyToken);

        assertThat(claims.appId()).isEqualTo(42L);
        assertThat(claims.appKey()).isEqualTo(APP_KEY);
        assertThat(claims.userId()).isEqualTo(10001L);
    }

    @Test
    @DisplayName("宽限期外(provider 不再暴露 previous):旧私钥存量令牌拒绝")
    void oldKeyTokenRejectedBeyondGrace() {
        String legacyToken = EmbedTokenTestSupport.signWith(PREVIOUS_KEY, Map.of(
                "iss", APP_KEY,
                "sub", "10001",
                "exp", new Date(System.currentTimeMillis() + 600_000)));

        // 未轮换/超宽限:previousPublicKey 为 null,只认当前公钥
        assertThatThrownBy(() -> verifier.verify(legacyToken))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("签名不匹配");
    }

    @Test
    @DisplayName("宽限链不放大伪造面:伪造签名在 current 与 previous 上均不匹配 → 拒绝")
    void forgedTokenRejectedEvenWithPreviousKey() {
        assertThatThrownBy(() -> verifierWithPreviousKey()
                .verify(EmbedTokenTestSupport.tokenSignedWithForeignKey(APP_KEY, 10001L)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("签名不匹配");
    }

    /**
     * 内存认钥表(测试替身:替代 ia_app 查询)。
     */
    private record InMemoryAppSigningKeys(Map<String, AppSigningKeyProvider.AppSigningKey> keys)
            implements AppSigningKeyProvider {

        @Override
        public AppSigningKey load(String appKey) {
            AppSigningKey key = keys.get(appKey);
            if (key == null) {
                throw new BusinessException(401, "未知或禁用的应用: " + appKey);
            }
            return key;
        }
    }
}
