package fun.commons.acmedemo.config;

import fun.commons.acmedemo.session.DemoAuthInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 配置:
 * 1) CORS 放行本地前端(http://localhost:*),不开 allowCredentials——
 *    前端以 Authorization 头携带宿主演示登录态,不依赖 cookie;
 * 2) 注册演示登录拦截器,只拦需要登录的 /api/** 端点(排除演示登录、公开配置、
 *    InnerAgent webhook 回调 /ia/webhook、starter 桥端点 /ia-mcp、swagger 文档路径)。
 */
@Configuration
@RequiredArgsConstructor
@EnableConfigurationProperties(IaProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final DemoAuthInterceptor demoAuthInterceptor;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("http://localhost:*")
                .allowedMethods("*")
                .allowedHeaders("*");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(demoAuthInterceptor)
                .addPathPatterns("/api/ia/embed-token", "/api/ia/server-status",
                        "/api/ia/agent-admin/**",
                        "/api/tickets/**", "/api/webhook-events",
                        "/api/demo/me", "/api/demo/logout")
                .excludePathPatterns("/api/demo/login", "/api/demo/config",
                        "/ia/**", "/ia-mcp/**", "/v3/api-docs/**", "/swagger-ui/**");
    }
}
