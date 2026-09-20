package com.inneragent.auth.support;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

/**
 * embed token 测试支撑(仅测试域):用测试私钥签发各类令牌矩阵样本。
 *
 * <p>模拟宿主后端签发行为(RS256,iss=appKey,sub=userId,tenantId 可选,exp):
 * 测试内存认钥加载器以 {@link #publicKeyPem()} 注册 ia_app 公钥。
 */
public final class EmbedTokenTestSupport {

    private static final KeyPair TEST_KEY = generateRsa2048();

    private EmbedTokenTestSupport() {
    }

    /** 测试应用公钥 PEM(注册进内存 ia_app 假实现) */
    public static String publicKeyPem() {
        return "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes())
                        .encodeToString(TEST_KEY.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----";
    }

    public static RSAPublicKey publicKey() {
        return (RSAPublicKey) TEST_KEY.getPublic();
    }

    /** 用测试私钥签 RS256 token:claims 按宿主签发语义 */
    public static String sign(Map<String, Object> claims) {
        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder();
        claims.forEach(builder::claim);
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).build(), builder.build());
        try {
            jwt.sign(new RSASSASigner(TEST_KEY.getPrivate()));
        } catch (JOSEException signingFailure) {
            throw new IllegalStateException("测试令牌签发失败", signingFailure);
        }
        return jwt.serialize();
    }

    /** 标准有效令牌样本 */
    public static String validToken(String appKey, long userId, long tenantId, Date exp) {
        return sign(Map.of(
                "iss", appKey,
                "sub", String.valueOf(userId),
                "tenantId", tenantId,
                "exp", exp));
    }

    /** alg=none 的伪造三段令牌(混淆攻击样本:header 声明无算法,签名段为空) */
    public static String unsignedToken(String appKey, long userId) {
        String header = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"none\"}".getBytes());
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("{\"iss\":\"" + appKey + "\",\"sub\":\"" + userId
                        + "\",\"exp\":" + (System.currentTimeMillis() / 1000 + 600) + "}")
                        .getBytes());
        // 第三段给非空占位签名:保证能通过 JWT 结构解析、命中"算法必须为 RS256"检查
        String fakeSignature = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("not-a-real-signature".getBytes());
        return header + "." + payload + "." + fakeSignature;
    }

    /** 用错误私钥(与注册公钥不配对)签发,模拟伪造签名 */
    public static String tokenSignedWithForeignKey(String appKey, long userId) {
        KeyPair foreign = generateRsa2048();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).build(),
                new JWTClaimsSet.Builder()
                        .issuer(appKey)
                        .subject(String.valueOf(userId))
                        .expirationTime(new Date(System.currentTimeMillis() + 600_000))
                        .build());
        try {
            jwt.sign(new RSASSASigner(foreign.getPrivate()));
        } catch (JOSEException signingFailure) {
            throw new IllegalStateException("测试令牌签发失败", signingFailure);
        }
        return jwt.serialize();
    }

    /** 篡改载荷(保留原签名):payload 段替换为超高权限 claims */
    public static String tamperedToken(String validToken, String forgedPayloadBase64Url) {
        String[] parts = validToken.split("\\.");
        return parts[0] + "." + forgedPayloadBase64Url + "." + parts[2];
    }

    /** HS256(HMAC)令牌:经典算法混淆攻击样本(用公钥当 HMAC 密钥) */
    public static String hmacToken(String appKey, long userId) {
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).build(),
                new JWTClaimsSet.Builder()
                        .issuer(appKey)
                        .subject(String.valueOf(userId))
                        .expirationTime(new Date(System.currentTimeMillis() + 600_000))
                        .build());
        try {
            jwt.sign(new com.nimbusds.jose.crypto.MACSigner(
                    java.util.Arrays.copyOf(publicKey().getEncoded(), 32)));
        } catch (JOSEException signingFailure) {
            throw new IllegalStateException("测试令牌签发失败", signingFailure);
        }
        return jwt.serialize();
    }

    private static KeyPair generateRsa2048() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
