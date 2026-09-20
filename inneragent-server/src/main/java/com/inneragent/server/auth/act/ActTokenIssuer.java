package com.inneragent.server.auth.act;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * act token 签发(P1-T1,02-技术方案 §6.1:RS256,exp 60s)。
 *
 * <p>claims 按 RFC 8693(令牌交换)语义建模:
 * <ul>
 *   <li>{@code iss}="inneragent"、{@code aud}=宿主 MCP URI(audience 绑定);</li>
 *   <li>{@code sub}=终端用户 ID(字符串化);</li>
 *   <li>{@code act.sub}="inneragent-run:{runId}"(运行身份,RFC 8693 act 载荷);</li>
 *   <li>自定义 {@code appKey}/{@code tenantId}/{@code toolName};</li>
 *   <li>{@code exp}=now+60s(仅限宿主桥内环调用,短时效防重放)。</li>
 * </ul>
 * 以 X-IA-Act 自定义头携带(不占用 Authorization);三方 MCP 一律走规范 OAuth,
 * 不使用本令牌。
 */
@Component
public class ActTokenIssuer {

    public static final String ISSUER = "inneragent";
    public static final String ACT_SUB_PREFIX = "inneragent-run:";
    /** 短时效:仅覆盖单次 tools/call 内环调用 */
    public static final long TTL_SECONDS = 60L;

    private final ActTokenKeyManager keyManager;

    public ActTokenIssuer(ActTokenKeyManager keyManager) {
        this.keyManager = keyManager;
    }

    public String issue(ActTokenRequest request) {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .audience(List.of(request.audience()))
                .subject(String.valueOf(request.userId()))
                .expirationTime(Date.from(now.plusSeconds(TTL_SECONDS)))
                .issueTime(Date.from(now))
                // RFC 8693 act 载荷:仅 sub 一项(运行身份),以 JSON 对象承载保证往返
                .claim("act", Map.of("sub", ACT_SUB_PREFIX + request.runId()))
                .claim("appKey", request.appKey())
                .claim("tenantId", request.tenantId())
                .claim("toolName", request.toolName())
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(keyManager.signingKey().getKeyID()).build(),
                claims);
        try {
            jwt.sign(new RSASSASigner(keyManager.signingKey()));
        } catch (JOSEException signingFailure) {
            throw new IllegalStateException("act token 签发失败", signingFailure);
        }
        return jwt.serialize();
    }

    /**
     * 签发请求(调用点:P1-T2 McpToolAdapter;宿主 MCP URI 由注册表携带)。
     */
    public record ActTokenRequest(
            long userId,
            long tenantId,
            String appKey,
            String runId,
            String toolName,
            String audience) {
    }
}
