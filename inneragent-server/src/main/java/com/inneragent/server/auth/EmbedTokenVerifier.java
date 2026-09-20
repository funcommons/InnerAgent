package com.inneragent.server.auth;

import com.inneragent.platform.common.BusinessException;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import lombok.extern.slf4j.Slf4j;

import java.text.ParseException;
import java.time.Instant;
import java.util.Date;

/**
 * embed token 验签(P1-T1,02-技术方案 §6.1)。
 *
 * <p>宿主后端注册时上传 RSA 公钥(ia_app.sign_public_key),签发 embed token:
 * <ul>
 *   <li>算法固定 RS256(拒 alg=none/HMAC 混淆);</li>
 *   <li>iss = appKey(以此定位 ia_app 行并取公钥验签);</li>
 *   <li>sub = 终端用户 ID(必填,Long);</li>
 *   <li>tenantId = 宿主声明透传的租户(可选,缺省 0);</li>
 *   <li>exp 必须存在且未过期(建议 12h)。</li>
 * </ul>
 * 任一不满足即拒绝(401 语义异常)。
 *
 * <p><strong>轮换宽限验签链(P2-key)</strong>:当前公钥验签失败时,若 provider
 * 暴露了宽限期内的上一代公钥(ia_app.previous_sign_public_key,grace 默认 72h)
 * 则以旧 key 兜底再验一次;命中即通过并以 INFO 登记(宿主在宽限窗口内完成
 * 换签,存量用户不被轮换下线)。伪造签名在两把 key 上都不匹配,宽限链不放大伪造面。
 */
@Slf4j
public class EmbedTokenVerifier {

    private static final JWSAlgorithm REQUIRED_ALGORITHM = JWSAlgorithm.RS256;

    private final AppSigningKeyProvider signingKeyProvider;

    public EmbedTokenVerifier(AppSigningKeyProvider signingKeyProvider) {
        this.signingKeyProvider = signingKeyProvider;
    }

    /**
     * 验签并提取身份 claims。
     *
     * @throws BusinessException 令牌非法/过期/签名不符/应用未知(401)
     */
    public EmbedTokenClaims verify(String token) {
        if (token == null || token.isBlank()) {
            throw new BusinessException(401, "embed token 为空");
        }
        SignedJWT jwt;
        try {
            jwt = SignedJWT.parse(token.trim());
        } catch (ParseException malformed) {
            throw new BusinessException(401, "embed token 不是合法 JWT");
        }
        // 算法固定 RS256:防 alg=none 与 HMAC/RSA 混淆攻击(JWSHeader 算法先行校验)
        JWSHeader header = jwt.getHeader();
        if (!REQUIRED_ALGORITHM.equals(header.getAlgorithm())) {
            throw new BusinessException(401, "embed token 算法必须为 RS256: " + header.getAlgorithm());
        }
        JWTClaimsSet claims;
        try {
            claims = jwt.getJWTClaimsSet();
        } catch (ParseException malformedClaims) {
            throw new BusinessException(401, "embed token claims 不可解析");
        }
        String appKey = claims.getIssuer();
        if (appKey == null || appKey.isBlank()) {
            throw new BusinessException(401, "embed token 缺少 iss(appKey)");
        }
        // iss(appKey) 定位应用:公钥来自 ia_app 而非令牌自带,杜绝自签公钥
        AppSigningKeyProvider.AppSigningKey signingKey;
        try {
            signingKey = signingKeyProvider.load(appKey);
        } catch (BusinessException unknownApp) {
            throw unknownApp;
        }
        boolean signatureValid = verifyWith(jwt, signingKey.publicKey());
        boolean verifiedWithPreviousKey = false;
        if (!signatureValid && signingKey.previousPublicKey() != null) {
            // 轮换宽限期:当前 key 不匹配 → 旧 key 兜底(仅 provider 在宽限期内才暴露)
            signatureValid = verifyWith(jwt, signingKey.previousPublicKey());
            verifiedWithPreviousKey = signatureValid;
        }
        if (!signatureValid) {
            throw new BusinessException(401, "embed token 签名不匹配");
        }
        if (verifiedWithPreviousKey) {
            log.info("embed token 以轮换宽限期内的旧公钥验签通过(旧 key 验签): "
                            + "appId={}, appKey={}, sub={}",
                    signingKey.appId(), signingKey.appKey(), claims.getSubject());
        }
        Long userId = requireUserId(claims);
        long tenantId = optionalTenantId(claims);
        requireNotExpired(claims);
        return new EmbedTokenClaims(
                signingKey.appId(), signingKey.appKey(), userId, tenantId);
    }

    /**
     * 单把公钥验签(JOSE 异常按不匹配处理,交由验签链/上层统一 401)。
     */
    private static boolean verifyWith(SignedJWT jwt, java.security.interfaces.RSAPublicKey publicKey) {
        try {
            return jwt.verify(new RSASSAVerifier(publicKey));
        } catch (JOSEException verifyFailure) {
            return false;
        }
    }

    private static Long requireUserId(JWTClaimsSet claims) {
        String subject = claims.getSubject();
        if (subject == null || subject.isBlank()) {
            throw new BusinessException(401, "embed token 缺少 sub(userId)");
        }
        try {
            return Long.parseLong(subject.trim());
        } catch (NumberFormatException invalidSubject) {
            throw new BusinessException(401, "embed token sub 必须为用户 ID(Long)");
        }
    }

    private static long optionalTenantId(JWTClaimsSet claims) {
        Object tenantId = claims.getClaim("tenantId");
        if (tenantId == null) {
            // 宿主未声明租户:缺省 0(与 ia_* 表 tenant_id DDL 默认一致)
            return 0L;
        }
        try {
            return Long.parseLong(String.valueOf(tenantId).trim());
        } catch (NumberFormatException invalidTenant) {
            throw new BusinessException(401, "embed token tenantId 必须为 Long");
        }
    }

    private static void requireNotExpired(JWTClaimsSet claims) {
        Date expiration = claims.getExpirationTime();
        if (expiration == null) {
            throw new BusinessException(401, "embed token 缺少 exp");
        }
        if (!expiration.toInstant().isAfter(Instant.now())) {
            throw new BusinessException(401, "embed token 已过期");
        }
    }

    /**
     * 验签通过后的身份快照(appId 为 ia_app.id,写入 AppContext)。
     */
    public record EmbedTokenClaims(long appId, String appKey, long userId, long tenantId) {
    }
}
