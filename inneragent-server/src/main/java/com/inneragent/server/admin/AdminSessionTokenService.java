package com.inneragent.server.admin;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * 管理会话 token 签发/校验/吊销(P2-admin 18a,02-技术方案 §6.3)。
 *
 * <p>登录成功后签发短时效签名 token(nimbus HS256):claims
 * {@code iss}="inneragent-admin"、{@code sub}=管理员用户名、
 * {@code role}="admin"、{@code jti}=UUID、{@code exp}=now+TTL(默认 4h,
 * {@code IA_ADMIN_SESSION_TTL_HOURS} 可调)。凭据域与 embed/act(M2M/用户级)
 * 完全隔离——embed token 对管理站 API 无效(§6.3)。
 *
 * <p>签名密钥:env {@code IA_ADMIN_SESSION_SECRET}(≥32 字节;HS256 要求);
 * 未配置时生成进程内随机密钥并 <strong>WARN:重启即全体会话失效且多实例
 * 不一致,仅限开发/单机</strong>(与 ActTokenKeyManager 临时密钥同口径)。
 *
 * <p>吊销:logout 将 jti 纳入内存黑名单(Caffeine,按剩余有效期逐条过期)。
 * <strong>黑名单为单实例内存实现:多实例部署需换 Redis 共享(P3 已登记)</strong>,
 * 在此之前吊销仅对当前实例生效。
 */
@Service
@Slf4j
public class AdminSessionTokenService {

    public static final String ISSUER = "inneragent-admin";
    public static final String ROLE_ADMIN = "admin";

    private final byte[] secret;
    private final long ttlSeconds;
    /** jti 吊销黑名单(内存;值=过期时刻,Caffeine 按其逐条过期) */
    private final Cache<String, Instant> revokedJtis;

    public AdminSessionTokenService(
            @Value("${IA_ADMIN_SESSION_SECRET:}") String configuredSecret,
            @Value("${IA_ADMIN_SESSION_TTL_HOURS:4}") long ttlHours) {
        if (configuredSecret != null && !configuredSecret.isBlank()) {
            byte[] bytes = configuredSecret.trim().getBytes(StandardCharsets.UTF_8);
            if (bytes.length < 32) {
                throw new IllegalStateException(
                        "IA_ADMIN_SESSION_SECRET 强度不足:HS256 要求至少 32 字节");
            }
            this.secret = bytes;
        } else {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            this.secret = random;
            log.warn("未配置 IA_ADMIN_SESSION_SECRET:管理会话 token 使用进程内随机密钥,"
                    + "重启即全体会话失效且多实例不一致;生产部署必须注入持久化密钥");
        }
        this.ttlSeconds = ttlHours > 0 ? ttlHours * 3600L : 4 * 3600L;
        this.revokedJtis = Caffeine.newBuilder()
                .expireAfter(new Expiry<String, Instant>() {
                    @Override
                    public long expireAfterCreate(String key, Instant value, long now) {
                        // 吊销记录仅保留到原 token 自然过期为止
                        return Math.max(0, value.toEpochMilli() - System.currentTimeMillis())
                                * 1_000_000L;
                    }

                    @Override
                    public long expireAfterUpdate(String key, Instant value, long now, long current) {
                        return current;
                    }

                    @Override
                    public long expireAfterRead(String key, Instant value, long now, long current) {
                        return current;
                    }
                })
                .build();
    }

    /** 签发管理会话 token(返回值同时携带明文 token 与过期信息供响应)。 */
    public IssuedToken issue(String username) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(ttlSeconds);
        String jti = UUID.randomUUID().toString();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject(username)
                .jwtID(jti)
                .claim("role", ROLE_ADMIN)
                .expirationTime(Date.from(expiresAt))
                .issueTime(Date.from(now))
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).build(), claims);
        try {
            jwt.sign(new MACSigner(secret));
        } catch (JOSEException signingFailure) {
            throw new IllegalStateException("管理会话 token 签发失败", signingFailure);
        }
        return new IssuedToken(jwt.serialize(), username, jti, expiresAt, ttlSeconds);
    }

    /**
     * 校验(签名/签发者/角色/过期/jti 吊销);任一不满足抛
     * {@link InvalidSessionTokenException}(调用方映射 401,不区分失败细节防探测)。
     */
    public SessionPrincipal verify(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!jwt.verify(new MACVerifier(secret))) {
                throw new InvalidSessionTokenException("签名无效");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            if (!ISSUER.equals(claims.getIssuer())
                    || !ROLE_ADMIN.equals(claims.getClaim("role"))) {
                throw new InvalidSessionTokenException("凭据域不符");
            }
            Date expiration = claims.getExpirationTime();
            if (expiration == null || expiration.toInstant().isBefore(Instant.now())) {
                throw new InvalidSessionTokenException("已过期");
            }
            String jti = claims.getJWTID();
            if (jti == null || revokedJtis.getIfPresent(jti) != null) {
                throw new InvalidSessionTokenException("会话已吊销");
            }
            return new SessionPrincipal(
                    claims.getSubject(), jti, expiration.toInstant());
        } catch (java.text.ParseException malformed) {
            throw new InvalidSessionTokenException("令牌格式无效");
        } catch (JOSEException verificationFailure) {
            throw new InvalidSessionTokenException("校验失败");
        }
    }

    /** 吊销(登出):jti 入黑名单至自然过期。幂等。 */
    public void revoke(SessionPrincipal principal) {
        revokedJtis.put(principal.jti(), principal.expiresAt());
    }

    /** 签发结果。 */
    public record IssuedToken(
            String token,
            String username,
            String jti,
            Instant expiresAt,
            long expiresInSeconds) {
    }

    /** 校验通过的管理员身份。 */
    public record SessionPrincipal(String username, String jti, Instant expiresAt) {
    }

    /** 会话 token 无效(签名/过期/吊销/域不符)。 */
    public static final class InvalidSessionTokenException extends RuntimeException {
        public InvalidSessionTokenException(String reason) {
            super(reason);
        }
    }
}
