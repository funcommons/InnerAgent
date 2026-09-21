package com.inneragent.server.security;

import com.inneragent.platform.context.UserContext;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.server.admin.AdminSessionTokenService;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.auth.EmbedTokenAuthenticationFilter;
import com.inneragent.server.auth.EmbedTokenVerifier;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * 认证链([adapt] P0 演示认证链 → P1 embed token 认证,02-技术方案 §6.1)。
 *
 * <p>过滤器顺序:AdminTokenFilter(仅 /ia/api/v1/admin/**,独立密钥)→
 * {@link EmbedTokenAuthenticationFilter}(Bearer embed token)→
 * {@link DemoUserAuthenticationFilter}(仅 allow-anonymous-demo=true 且
 * <strong>无 Bearer</strong> 时兜底,P0 演示不破坏)。
 *
 * <p>{@code @EnableMethodSecurity} 自 P1 起开启:控制器已有
 * {@code @PreAuthorize("hasRole('ADMIN')")} 生效——embed/演示用户无 ADMIN 权限,
 * 管理/配置接口收敛为管理面(独立 X-IA-Admin-Key 鉴权);演示/对话控制器
 * (pipeline/assistant 等)无 @PreAuthorize,不受影响。
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class DemoSecurityConfiguration {

    /**
     * embed token 验签器(生产公钥来源:ia_app.sign_public_key)。
     */
    @Bean
    public EmbedTokenVerifier embedTokenVerifier(
            com.inneragent.server.auth.DbAppSigningKeyProvider signingKeyProvider) {
        return new EmbedTokenVerifier(signingKeyProvider);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            EmbedTokenVerifier embedTokenVerifier,
            ObjectProvider<DemoUserAuthenticationFilter> demoFilter,
            ObjectProvider<AdminTokenFilter> adminFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                // 认证由过滤器链完成(embed/demo/admin-key);端点级授权交
                // @PreAuthorize(方法安全)与各过滤器自身,HTTP 层保持放行入口
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/ia/api-docs/**", "/ia/swagger-ui/**").permitAll()
                        .anyRequest().permitAll())
                // swagger-ui 需要内联展示,不能 default(DENY)
                .headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()))
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.addFilterBefore(
                new EmbedTokenAuthenticationFilter(embedTokenVerifier),
                UsernamePasswordAuthenticationFilter.class);
        AdminTokenFilter admin = adminFilter.getIfAvailable();
        if (admin != null) {
            http.addFilterBefore(admin, EmbedTokenAuthenticationFilter.class);
        }
        DemoUserAuthenticationFilter filter = demoFilter.getIfAvailable();
        if (filter != null) {
            http.addFilterAfter(filter, EmbedTokenAuthenticationFilter.class);
        }
        return http.build();
    }

    /**
     * 管理面凭据过滤器(P2-admin 双轨:X-IA-Admin-Key 引导 key + 管理会话
     * token;IA_ADMIN_KEY 未配置时会话通道仍可用,构造 WARN 保留)。
     */
    @Bean
    public AdminTokenFilter adminTokenFilter(
            @Value("${IA_ADMIN_KEY:}") String adminKey,
            AdminSessionTokenService sessionTokenService) {
        return new AdminTokenFilter(adminKey, sessionTokenService);
    }

    /**
     * 演示用户认证过滤器:仅 local/演示环境注册(allow-anonymous-demo=true),
     * 且仅在请求未携带 Bearer embed token 时兜底。
     */
    @Bean
    @ConditionalOnProperty(name = "inneragent.security.allow-anonymous-demo", havingValue = "true")
    public DemoUserAuthenticationFilter demoUserAuthenticationFilter() {
        return new DemoUserAuthenticationFilter();
    }

    /**
     * 从 {@code X-IA-Demo-User} 请求头解析演示用户(缺省 12993)并注入
     * SecurityContext 与 UserContext;无 Bearer 时才兜底([adapt] P1-T1)。
     * 演示身份不携带租户(UserContext.tenantId=null,不改写 TenantContext),
     * 会话/运行归属仍按 P0 行为落默认值,运行租户由协调器兜底解析。
     */
    static final class DemoUserAuthenticationFilter extends OncePerRequestFilter {

        static final String HEADER = "X-IA-Demo-User";
        static final long DEFAULT_DEMO_USER_ID = 12993L;

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            // 已携带 embed token 的请求交给 Embed 认证,不再叠加演示身份
            String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
            if (authorization != null && authorization.startsWith("Bearer ")) {
                return true;
            }
            // actuator 域豁免(IA-1 指标出口):部署层内网端点不注入演示身份,
            // 与 embed 域豁免同口径(抓取请求保持无凭据、凭据域干净)
            String uri = request.getRequestURI();
            if (uri.startsWith("/actuator/")) {
                return true;
            }
            // 管理面凭据由 AdminTokenFilter 双轨裁决(Bearer 会话 / X-IA-Admin-Key),
            // 演示身份不得注入管理面:引导 key 通道无认证时 currentOperator 才能按
            // 契约回落 admin(OBS-R3-1:演示环境经 key 通道 terminate-run,操作者
            // 被本过滤器覆写成 demo-user,误入熔断事件与审计)
            return uri.startsWith(AdminTokenFilter.ADMIN_PATH_PREFIX);
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request,
                                        HttpServletResponse response,
                                        FilterChain filterChain)
                throws ServletException, IOException {
            long demoUserId = parseDemoUserId(request.getHeader(HEADER));
            SecurityUserDetails userDetails = new SecurityUserDetails(
                    demoUserId,
                    "demo-user",
                    "N/A",
                    1,
                    null,
                    List.of());
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            userDetails, null, userDetails.getAuthorities());
            SecurityContextHolder.getContext().setAuthentication(authentication);
            // 演示身份写入 UserContext(tenantId=null,不触发 TenantContext 同步)
            UserContext.set(demoUserId, null);
            try {
                filterChain.doFilter(request, response);
            } finally {
                SecurityContextHolder.clearContext();
                UserContext.clear();
            }
        }

        private static long parseDemoUserId(String headerValue) {
            if (headerValue != null) {
                try {
                    return Long.parseLong(headerValue.trim());
                } catch (NumberFormatException ignored) {
                    // 非法取值回落默认演示用户
                }
            }
            return DEFAULT_DEMO_USER_ID;
        }
    }
}
