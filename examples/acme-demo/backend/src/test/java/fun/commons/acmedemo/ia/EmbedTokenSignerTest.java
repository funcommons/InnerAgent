package fun.commons.acmedemo.ia;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * embed token 签发契约测试(逐字段对齐 InnerAgent EmbedTokenVerifier 的期望):
 * RS256 / iss=appKey / sub=用户 ID(Long 串) / tenantId 可选 / exp 必填 / 无 aud。
 * 验签用登记侧公钥(nimbus RSASSAVerifier,与 EmbedTokenVerifier 同库)。
 */
class EmbedTokenSignerTest {

    private static final String APP_KEY = "acme-demo";
    private static final long TTL = 12 * 3600;

    private KeyPair keyPair;
    private IaProperties props;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        props = new IaProperties();
        props.setAppKey(APP_KEY);
        props.setEmbedTtlSeconds((int) TTL);
        props.setSignPrivateKeyPem(pem("PRIVATE KEY", keyPair.getPrivate().getEncoded())); // PKCS#8
    }

    @Test
    void 契约_RS256_iss_sub_Long串_exp_无aud_公钥验签通过() throws Exception {
        SignedJWT jwt = SignedJWT.parse(new EmbedTokenSigner(props).sign(10086L, 7L).token());

        assertThat(jwt.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.RS256);
        JWTClaimsSet claims = jwt.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo(APP_KEY);                 // iss = appKey
        assertThat(claims.getSubject()).isEqualTo("10086");                // sub = Long 串
        assertThat(Long.parseLong(claims.getSubject())).isEqualTo(10086L); // EmbedTokenVerifier.requireUserId 语义
        assertThat(claims.getClaim("tenantId")).isEqualTo(7L);             // 可选透传租户
        assertThat(claims.getAudience()).isEmpty();                        // 无 aud claim
        assertThat(claims.getExpirationTime()).isNotNull();                // exp 必填
        assertThat((claims.getExpirationTime().toInstant().getEpochSecond()
                - claims.getIssueTime().toInstant().getEpochSecond())).isEqualTo(TTL);
        // 登记侧公钥验签(EmbedTokenVerifier.verifyWith 同款)
        assertThat(jwt.verify(new RSASSAVerifier((RSAPublicKey) keyPair.getPublic()))).isTrue();
    }

    @Test
    void 契约_tenantId缺省时不带该claim_服务端按0处理() throws Exception {
        SignedJWT jwt = SignedJWT.parse(new EmbedTokenSigner(props).sign(1L, null).token());
        assertThat(jwt.getJWTClaimsSet().getClaim("tenantId")).isNull();
        assertThat(jwt.getJWTClaimsSet().getSubject()).isEqualTo("1");
    }

    @Test
    void 私钥未配置_503守卫() {
        props.setSignPrivateKeyPem("");
        EmbedTokenSigner signer = new EmbedTokenSigner(props);
        assertThatThrownBy(() -> signer.sign(1L, null))
                .isInstanceOfSatisfying(BizException.class, e -> assertThat(e.getCode()).isEqualTo(503));
    }

    @Test
    void 私钥非法_503守卫() {
        props.setSignPrivateKeyPem("-----BEGIN PRIVATE KEY-----\nZm9v\n-----END PRIVATE KEY-----");
        EmbedTokenSigner signer = new EmbedTokenSigner(props);
        assertThatThrownBy(() -> signer.sign(1L, null))
                .isInstanceOfSatisfying(BizException.class, e -> assertThat(e.getCode()).isEqualTo(503));
    }

    @Test
    void 契约_PKCS1形态私钥同样可签发() throws Exception {
        // PKCS#8 DER 剥掉 26 字节头(SEQUENCE3 + ver4 + algid15 + octet4)即 PKCS#1
        byte[] pkcs8 = keyPair.getPrivate().getEncoded();
        byte[] pkcs1 = new byte[pkcs8.length - 26];
        System.arraycopy(pkcs8, 26, pkcs1, 0, pkcs1.length);
        props.setSignPrivateKeyPem(pem("RSA PRIVATE KEY", pkcs1));

        SignedJWT jwt = SignedJWT.parse(new EmbedTokenSigner(props).sign(42L, null).token());
        assertThat(jwt.verify(new RSASSAVerifier((RSAPublicKey) keyPair.getPublic()))).isTrue();
    }

    private static String pem(String label, byte[] der) {
        return "-----BEGIN " + label + "-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(der)
                + "\n-----END " + label + "-----";
    }
}
