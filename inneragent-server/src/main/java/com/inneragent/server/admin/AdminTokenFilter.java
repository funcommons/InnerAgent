package com.inneragent.server.admin;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * 管理面凭据过滤器(P1-T1 静态密钥;P2-admin 18a 双轨升级,02-技术方案 §6.3)。
 *
 * <p>仅拦截 {@code /ia/api/v1/admin/**}(登录端点豁免,见
 * {@link #shouldNotFilter})。接受两类凭据,先到先验:
 * <ol>
 *   <li><strong>管理会话 token</strong>(人类管理员,{@code Authorization:
 *       Bearer <jwt>}):{@link AdminSessionTokenService} 校验签名/过期/吊销;
 *       通过后写入 SecurityContext(principal=用户名,ROLE_ADMIN)。
 *       无效/过期/已吊销 → <strong>401</strong>(与 embed Bearer 失败语义一致);
 *       本过滤器先于 embed 过滤器,admin 路径上 Bearer 即管理会话 token,
 *       embed token 不可能到达管理面(两套凭据域隔离,§6.3)。</li>
 *   <li><strong>env 引导 key</strong>(M2M/自动化,{@code X-IA-Admin-Key} =
 *       env {@code IA_ADMIN_KEY}):沿用 P1 语义——未配置时整个 admin API
 *       一律 <strong>403</strong>(缺省封闭);缺失/错误 → <strong>403</strong>;
 *       值比较常量时间。既有守卫矩阵不变,存量 admin 测试不破。</li>
 * </ol>
 * 优先级:Bearer 存在即按会话 token 处理(人类通道),key 头被忽略。
 */
@Slf4j
public class AdminTokenFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-IA-Admin-Key";
    static final String ADMIN_PATH_PREFIX = "/ia/api/v1/admin/";
    /** 登录端点豁免:登录本身不能要求已有凭据(引导路径) */
    static final String LOGIN_PATH = "/ia/api/v1/admin/auth/login";

    private static final String BEARER_PREFIX = "Bearer ";

    private final byte[] expectedKey;
    private final AdminSessionTokenService sessionTokenService;

    /** P1 兼容构造(仅静态密钥;存量单测沿用,会话 token 通道关闭)。 */
    public AdminTokenFilter(@Value("${IA_ADMIN_KEY:}") String adminKey) {
        this(adminKey, null);
    }

    public AdminTokenFilter(String adminKey, AdminSessionTokenService sessionTokenService) {
        this.expectedKey = adminKey == null || adminKey.isBlank()
                ? null
                : adminKey.trim().getBytes(StandardCharsets.UTF_8);
        this.sessionTokenService = sessionTokenService;
        if (expectedKey == null) {
            log.warn("IA_ADMIN_KEY 未设置:/ia/api/v1/admin/** 管理面 API 将全部拒绝(403);"
                    + "如需使用应用注册等管理 API,请配置环境变量 IA_ADMIN_KEY"
                    + "(管理站账号登录通道不受此影响,见 IA_ADMIN_BOOTSTRAP_PASSWORD)");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        // 登录端点豁免(登出仍受守卫:须持有效会话 token)
        if (LOGIN_PATH.equals(uri)) {
            return true;
        }
        return !uri.startsWith(ADMIN_PATH_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization != null && authorization.startsWith(BEARER_PREFIX)) {
            if (sessionTokenService == null) {
                // 单测便捷构造:会话通道未装配 → 无有效凭据
                reject(response, HttpServletResponse.SC_FORBIDDEN,
                        "管理面凭据无效:请携带 X-IA-Admin-Key 请求头");
                return;
            }
            try {
                AdminSessionTokenService.SessionPrincipal principal =
                        sessionTokenService.verify(authorization.substring(BEARER_PREFIX.length()));
                UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(
                                principal.username(), null,
                                List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
                SecurityContextHolder.getContext().setAuthentication(authentication);
                try {
                    filterChain.doFilter(request, response);
                } finally {
                    SecurityContextHolder.clearContext();
                }
            } catch (AdminSessionTokenService.InvalidSessionTokenException invalidSession) {
                // 会话 token 无效:401(对齐 embed Bearer 失败语义;不区分细节防探测)
                reject(response, HttpServletResponse.SC_UNAUTHORIZED,
                        "管理会话 token 无效或已过期,请重新登录");
            }
            return;
        }
        // 静态引导 key 通道(P1 矩阵原样保留:未配置/缺失/错误一律 403)
        String provided = request.getHeader(HEADER);
        if (expectedKey == null) {
            // 缺省封闭:未配置管理密钥时一律拒绝(构造时已 WARN 一次)
            reject(response, HttpServletResponse.SC_FORBIDDEN,
                    "管理面未启用:未配置 IA_ADMIN_KEY");
            return;
        }
        if (provided == null
                || !MessageDigest.isEqual(
                        expectedKey, provided.trim().getBytes(StandardCharsets.UTF_8))) {
            reject(response, HttpServletResponse.SC_FORBIDDEN,
                    "管理面凭据无效:请携带 X-IA-Admin-Key 请求头或 Authorization: Bearer 管理会话 token");
            return;
        }
        filterChain.doFilter(request, response);
    }

    private static void reject(HttpServletResponse response, int status, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(
                "{\"code\":" + status + ",\"msg\":\"" + message + "\",\"data\":null}");
    }
}
