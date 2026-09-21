package fun.commons.acmedemo.ia;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import fun.commons.acmedemo.common.BizException;
import fun.commons.acmedemo.config.IaProperties;
import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * embed token 签发器(接入指南 §2 步骤⑤ / §4.1;消费方为 InnerAgent
 * {@code EmbedTokenVerifier},本类是其签发侧镜像,claims 逐字段对齐):
 *
 * <ul>
 *   <li>算法固定 RS256(验签端拒绝 alg=none/HMAC 混淆);</li>
 *   <li>iss = appKey(InnerAgent 据此定位 ia_app 行并取登记公钥验签);</li>
 *   <li>sub = 宿主用户 ID(必填,Long 字符串);</li>
 *   <li>tenantId = 宿主声明透传的租户(可选,缺省 0;<strong>无 aud claim</strong>);</li>
 *   <li>exp 必填,有效期建议 12h({@code ia.embed-ttl-seconds});过期由 SDK
 *       401 懒换无缝续签,无需本端做 refresh token。</li>
 * </ul>
 *
 * <p>私钥持有红线:RSAPrivateKey 仅存在于本进程内存,来源是环境变量
 * {@code IA_SIGN_PRIVATE_KEY}(PEM);未配置时签发请求统一 503
 * (运维问题,与 webhook 未配置同语义),绝不静默降级为无鉴权。
 */
@Slf4j
@Component
public class EmbedTokenSigner {

    private static final JWSAlgorithm ALGORITHM = JWSAlgorithm.RS256;

    private final IaProperties props;

    /** 惰性解析:进程内只解析一次;私钥未配置时保持 null(签发时 503)。 */
    private volatile RSAPrivateKey cachedKey;
    private volatile boolean parseFailed;

    public EmbedTokenSigner(IaProperties props) {
        this.props = props;
    }

    /**
     * 为已认证宿主用户签发 embed token。
     *
     * @param userId   宿主用户 ID(写入 sub,Long 字符串)
     * @param tenantId 透传租户(null = 不带该 claim,服务端缺省 0)
     * @return 紧凑序列化 JWT(compact JWS)
     * @throws BizException 503 = 私钥未配置/不可解析(运维问题)
     */
    public SignedToken sign(long userId, Long tenantId) {
        RSAPrivateKey key = key();
        long now = Instant.now().getEpochSecond();
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(props.getAppKey())                       // iss = appKey
                .subject(String.valueOf(userId))                 // sub = 用户 ID(Long 串)
                .issueTime(Date.from(Instant.ofEpochSecond(now)))
                .expirationTime(Date.from(Instant.ofEpochSecond(now + props.getEmbedTtlSeconds())));
        if (tenantId != null) {
            claims.claim("tenantId", tenantId);                  // 可选,无 aud
        }
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(ALGORITHM).build(), claims.build());
        try {
            jwt.sign(new RSASSASigner(key));
        } catch (JOSEException e) {
            throw new BizException(500, "embed token 签名失败");
        }
        return new SignedToken(jwt.serialize(), props.getEmbedTtlSeconds());
    }

    /** 签发结果:compact JWT + 有效期秒数(响应体透出,前端做临期重签)。 */
    public record SignedToken(String token, long expiresIn) {
    }

    /** 取解析后的私钥;未配置/不可解析 → 503(与 webhook secret 未配置同语义)。 */
    private RSAPrivateKey key() {
        RSAPrivateKey key = this.cachedKey;
        if (key == null) {
            synchronized (this) {
                if (this.cachedKey == null) {
                    if (parseFailed) {
                        throw new BizException(503, "签名私钥不可解析,请检查 IA_SIGN_PRIVATE_KEY");
                    }
                    String pem = props.getSignPrivateKeyPem();
                    if (pem == null || pem.isBlank()) {
                        throw new BizException(503,
                                "签名私钥未配置:请以 IA_SIGN_PRIVATE_KEY 注入与管理面登记 signPublicKey 配对的 RSA 私钥 PEM");
                    }
                    try {
                        this.cachedKey = RSAPrivateKeys.parse(pem);
                        log.info("embed token 签名私钥已加载(appKey={})", props.getAppKey());
                    } catch (IllegalArgumentException badPem) {
                        this.parseFailed = true;
                        throw new BizException(503, "签名私钥不可解析,请检查 IA_SIGN_PRIVATE_KEY: " + badPem.getMessage());
                    }
                }
                key = this.cachedKey;
            }
        }
        return key;
    }
}
