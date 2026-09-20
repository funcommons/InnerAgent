package com.inneragent.server.security;

import com.inneragent.platform.security.SecurityUserDetails;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
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
 * P0 演示认证链。
 *
 * <p>P0 阶段所有请求 permitAll(无真实鉴权);@PreAuthorize 因未开启
 * {@code @EnableMethodSecurity} 而暂不生效,属有意为之。
 * <strong>P1 换 embed token 认证</strong>:启用方法安全并替换本配置。
 *
 * <p>当 {@code inneragent.security.allow-anonymous-demo=true} 时,额外注册
 * {@link DemoUserAuthenticationFilter}:从请求头 {@code X-IA-Demo-User} 取演示用户 ID
 * (缺省 12993),构造 {@link SecurityUserDetails} 写入 SecurityContext,请求结束后清理,
 * 供本地联调时 Agent 运行链路获得 userId。local profile 默认开启该开关。
 */
@Configuration
@EnableWebSecurity
public class DemoSecurityConfiguration {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            ObjectProvider<DemoUserAuthenticationFilter> demoFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                // P0 全放行;P1 换 embed token 认证后按端点收敛
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/ia/api-docs/**", "/ia/swagger-ui/**").permitAll()
                        .anyRequest().permitAll())
                // swagger-ui 需要内联展示,不能 default(DENY)
                .headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()))
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        DemoUserAuthenticationFilter filter = demoFilter.getIfAvailable();
        if (filter != null) {
            http.addFilterBefore(filter, UsernamePasswordAuthenticationFilter.class);
        }
        return http.build();
    }

    /**
     * 演示用户认证过滤器:仅 local/演示环境注册(allow-anonymous-demo=true)。
     */
    @Bean
    @ConditionalOnProperty(name = "inneragent.security.allow-anonymous-demo", havingValue = "true")
    public DemoUserAuthenticationFilter demoUserAuthenticationFilter() {
        return new DemoUserAuthenticationFilter();
    }

    /**
     * 从 {@code X-IA-Demo-User} 请求头解析演示用户(缺省 12993)并注入 SecurityContext。
     */
    static final class DemoUserAuthenticationFilter extends OncePerRequestFilter {

        static final String HEADER = "X-IA-Demo-User";
        static final long DEFAULT_DEMO_USER_ID = 12993L;

        @Override
        protected void doFilterInternal(HttpServletRequest request,
                                        HttpServletResponse response,
                                        FilterChain filterChain)
                throws ServletException, IOException {
            SecurityUserDetails userDetails = new SecurityUserDetails(
                    parseDemoUserId(request.getHeader(HEADER)),
                    "demo-user",
                    "N/A",
                    1,
                    null,
                    List.of());
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            userDetails, null, userDetails.getAuthorities());
            SecurityContextHolder.getContext().setAuthentication(authentication);
            try {
                filterChain.doFilter(request, response);
            } finally {
                SecurityContextHolder.clearContext();
            }
        }

        private static Long parseDemoUserId(String headerValue) {
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
