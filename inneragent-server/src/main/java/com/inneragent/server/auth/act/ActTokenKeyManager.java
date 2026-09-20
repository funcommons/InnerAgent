package com.inneragent.server.auth.act;

import com.inneragent.platform.common.BusinessException;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
import java.util.List;

import lombok.extern.slf4j.Slf4j;

/**
 * act token 签名密钥管理(P1-T1,02-技术方案 §6.1:InnerAgent 签发、JWKS 发布)。
 *
 * <p>启动时按优先级加载 RSA keypair:env {@code IA_ACT_KEY_PEM}(PKCS#8 PEM 全文)
 * → {@code IA_ACT_KEY_PATH}(PEM 文件路径)→ 缺省生成临时密钥对
 * (<strong>WARN 提示:重启失效且多实例间不一致,仅限开发/冒烟</strong>)。
 * kid 取公钥 DER 编码 SHA-256 摘要(Base64URL 前 16 字符);轮换时新 key 立即生效,
 * 旧公钥在 JWKS 中保留 72h 宽限(内存,单实例)供宿主侧过渡验签。
 */
@Component
@Slf4j
public class ActTokenKeyManager {

    /** 旧公钥 JWKS 宽限期(PRD:宿主过渡验签) */
    static final Duration GRACE_PERIOD = Duration.ofHours(72);

    private volatile CurrentKey current;
    private final Deque<RetiredKey> retiredKeys = new ArrayDeque<>();

    public ActTokenKeyManager(
            @Value("${IA_ACT_KEY_PEM:}") String keyPem,
            @Value("${IA_ACT_KEY_PATH:}") String keyPath) {
        KeyPair keyPair = loadOrGenerate(keyPem, keyPath);
        this.current = CurrentKey.of(keyPair);
        if (keyPem != null && !keyPem.isBlank()) {
            log.info("act token 密钥已从 IA_ACT_KEY_PEM 加载,kid={}", current.kid());
        } else if (keyPath != null && !keyPath.isBlank()) {
            log.info("act token 密钥已从 IA_ACT_KEY_PATH={} 加载,kid={}", keyPath, current.kid());
        } else {
            log.warn("未配置 IA_ACT_KEY_PEM/IA_ACT_KEY_PATH:已生成临时 act token 密钥对,"
                            + "重启失效且多实例间不一致(kid={});生产环境必须注入持久化密钥",
                    current.kid());
        }
    }

    /** 当前签名密钥(含私钥;仅签发侧使用) */
    public RSAKey signingKey() {
        return current.toJwk();
    }

    /**
     * JWKS 公钥集:当前 key 在首位,其后为 72h 宽限期内的旧 key(P1-T1 内存实现,
     * 多实例部署 P2 统一持久化)。
     */
    public List<JWK> publicJwks() {
        List<JWK> keys = new ArrayList<>();
        keys.add(current.toPublicJwk());
        Instant now = Instant.now();
        for (RetiredKey retired : retiredKeys) {
            if (retired.retiredAt().plus(GRACE_PERIOD).isAfter(now)) {
                keys.add(retired.toPublicJwk());
            }
        }
        return keys;
    }

    /**
     * 轮换密钥:新 key 立即生效,旧 key 保留 JWKS 72h 宽限。
     */
    public synchronized void rotate(KeyPair newKeyPair) {
        CurrentKey next = CurrentKey.of(newKeyPair);
        retiredKeys.addFirst(new RetiredKey(current.kid(), current.publicKey(), Instant.now()));
        this.current = next;
        log.info("act token 密钥已轮换: kid={} -> {}", retiredKeys.peekFirst().kid(), next.kid());
    }

    private record CurrentKey(String kid, RSAPublicKey publicKey, RSAPrivateKey privateKey) {

        static CurrentKey of(KeyPair keyPair) {
            RSAPublicKey publicKey = (RSAPublicKey) keyPair.getPublic();
            return new CurrentKey(kidOf(publicKey), publicKey, (RSAPrivateKey) keyPair.getPrivate());
        }

        RSAKey toJwk() {
            return new RSAKey.Builder(publicKey).privateKey(privateKey).keyID(kid).build();
        }

        RSAKey toPublicJwk() {
            return new RSAKey.Builder(publicKey).keyID(kid).build();
        }
    }

    private record RetiredKey(String kid, RSAPublicKey publicKey, Instant retiredAt) {

        RSAKey toPublicJwk() {
            return new RSAKey.Builder(publicKey).keyID(kid).build();
        }
    }

    private static KeyPair loadOrGenerate(String keyPem, String keyPath) {
        if (keyPem != null && !keyPem.isBlank()) {
            return parsePem(keyPem);
        }
        if (keyPath != null && !keyPath.isBlank()) {
            try {
                return parsePem(Files.readString(Path.of(keyPath.trim())));
            } catch (IOException unreadable) {
                throw new IllegalStateException("IA_ACT_KEY_PATH 不可读: " + keyPath, unreadable);
            }
        }
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException generationFailure) {
            throw new IllegalStateException("act token 临时密钥对生成失败", generationFailure);
        }
    }

    private static KeyPair parsePem(String pem) {
        String base64 = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        try {
            byte[] encoded = Base64.getDecoder().decode(base64);
            RSAPrivateKey privateKey = (RSAPrivateKey) KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(encoded));
            // PKCS#8 RSA 私钥可自恢复公钥(n/e),无需单独配发公钥文件
            PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(
                    new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPrivateExponent()));
            return new KeyPair(publicKey, privateKey);
        } catch (IllegalArgumentException | GeneralSecurityException | ClassCastException invalid) {
            throw new IllegalStateException(
                    "IA_ACT_KEY_PEM 不是合法的 PKCS#8 RSA 私钥 PEM: " + invalid.getMessage(), invalid);
        }
    }

    /**
     * kid = 公钥 DER 编码 SHA-256 摘要的 Base64URL 前 16 字符。
     */
    static String kidOf(RSAPublicKey publicKey) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(publicKey.getEncoded());
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(digest).substring(0, 16);
        } catch (GeneralSecurityException digestFailure) {
            throw new IllegalStateException("SHA-256 不可用", digestFailure);
        }
    }
}
