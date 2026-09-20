package com.inneragent.server.admin;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * 管理面 M2M 凭据过滤器(P1-T1,02-技术方案 §6.3)。
 *
 * <p>仅拦截 {@code /ia/api/v1/admin/**}:请求头 {@code X-IA-Admin-Key} 必须等于
 * env {@code IA_ADMIN_KEY}。密钥未配置时<strong>整个 admin API 一律 403</strong>
 * 并 WARN(缺省封闭,防误开放)。值比较使用常量时间比较。
 *
 * <p>说明:P1 以静态密钥过渡,P2 起(02-方案 §6.3)管理面换
 * client_credentials 换 token,本过滤器届时替换。
 */
@Slf4j
public class AdminTokenFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-IA-Admin-Key";
    static final String ADMIN_PATH_PREFIX = "/ia/api/v1/admin/";

    private final byte[] expectedKey;

    public AdminTokenFilter(@Value("${IA_ADMIN_KEY:}") String adminKey) {
        this.expectedKey = adminKey == null || adminKey.isBlank()
                ? null
                : adminKey.trim().getBytes(StandardCharsets.UTF_8);
        if (expectedKey == null) {
            log.warn("IA_ADMIN_KEY 未设置:/ia/api/v1/admin/** 管理面 API 将全部拒绝(403);"
                    + "如需使用应用注册等管理 API,请配置环境变量 IA_ADMIN_KEY");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(ADMIN_PATH_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String provided = request.getHeader(HEADER);
        if (expectedKey == null) {
            // 缺省封闭:未配置管理密钥时一律拒绝(构造时已 WARN 一次)
            reject(response, "管理面未启用:未配置 IA_ADMIN_KEY");
            return;
        }
        if (provided == null
                || !MessageDigest.isEqual(
                        expectedKey, provided.trim().getBytes(StandardCharsets.UTF_8))) {
            reject(response, "管理面凭据无效:请携带 X-IA-Admin-Key 请求头");
            return;
        }
        filterChain.doFilter(request, response);
    }

    private static void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(
                "{\"code\":403,\"msg\":\"" + message + "\",\"data\":null}");
    }
}
