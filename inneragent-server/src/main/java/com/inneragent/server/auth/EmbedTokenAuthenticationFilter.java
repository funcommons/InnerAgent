package com.inneragent.server.auth;

import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.context.UserContext;
import com.inneragent.platform.security.SecurityUserDetails;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * embed token 认证过滤器(P1-T1,02-技术方案 §6.1/§4.2)。
 *
 * <p>请求头 {@code Authorization: Bearer <jwt>} → {@link EmbedTokenVerifier} 验签 →
 * 构造 {@link SecurityUserDetails}(userId, "embed:"+appKey, 无权限)写入
 * SecurityContext,并将 appId/appKey 映射结果写入 {@link AppContext}、
 * userId+tenantId 写入 {@link UserContext}(同步 TenantContext)。
 *
 * <p>语义:未携带 Bearer 时直接放行(由 demo 匿名链路兜底,P0 演示不破坏);
 * <strong>携带了 Bearer 但验签失败则 401 终止</strong>(fail-closed,不回落匿名)。
 * 请求结束后清理全部 ThreadLocal 上下文。
 */
@RequiredArgsConstructor
public class EmbedTokenAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final EmbedTokenVerifier verifier;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX)) {
            // 无 Bearer:交由后续链路(demo 匿名兜底/管理面独立鉴权)
            filterChain.doFilter(request, response);
            return;
        }
        EmbedTokenVerifier.EmbedTokenClaims claims;
        try {
            claims = verifier.verify(authorization.substring(BEARER_PREFIX.length()));
        } catch (RuntimeException verificationFailure) {
            // 携带 Bearer 但验签失败:fail-closed,401 终止(不回落匿名)
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"msg\":\"embed token 无效: "
                    + verificationFailure.getMessage() + "\",\"data\":null}");
            return;
        }
        SecurityUserDetails userDetails = new SecurityUserDetails(
                claims.userId(),
                "embed:" + claims.appKey(),
                "N/A",
                1,
                claims.tenantId(),
                List.of());
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        userDetails, null, userDetails.getAuthorities());
        SecurityContextHolder.getContext().setAuthentication(authentication);
        // 双层上下文写入:appId(embed appKey→ia_app.id)、userId+tenantId(同步 TenantContext)
        AppContext.setAppId(claims.appId());
        UserContext.set(claims.userId(), claims.tenantId());
        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
            AppContext.clear();
            UserContext.clear();
        }
    }
}
