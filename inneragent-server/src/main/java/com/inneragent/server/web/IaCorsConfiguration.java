package com.inneragent.server.web;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.List;

/**
 * iframe 跨源 CORS(P4 差距收口,K 清单②:SDK iframe 模式跨源嵌宿时浏览器
 * 预检与响应头缺位)。
 *
 * <p><strong>缺省关闭</strong>:env {@code IA_CORS_ALLOWED_ORIGINS}(逗号分隔)
 * 为空(缺省)时不注册任何 CORS 映射——零 CORS 头,与同源反代姿态下未引入
 * 本配置前的行为完全一致(零回归)。配置后仅对 {@code /ia/api/**} 生效:
 * <ul>
 *   <li>允许方法 GET / POST / OPTIONS(SSE 端点
 *       {@code GET /ia/api/v1/runs/{runId}/events} 同规则);</li>
 *   <li>允许头 Authorization(embed token)/ X-IA-Act / X-IA-Admin-Key /
 *       Content-Type / Last-Event-ID(SSE 断点续传);</li>
 *   <li>credentials=true(allowlist 恒为显式来源清单,永不回退 {@code *},
 *       同源反代部署不受影响)。</li>
 * </ul>
 *
 * <p>来源之外的取值(空白项)忽略;放行裁决在 handler-mapping 层
 * ({@code PreFlightHandler}),管理面/admin 与 actuator 域不设例外——
 * 跨源管理面如需开放,把其来源一并入 allowlist(凭据仍由双轨鉴权把关)。
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IaCorsConfiguration.Properties.class)
public class IaCorsConfiguration implements WebMvcConfigurer {

    /** CORS 作用域:embed 用户面 + SSE + 管理面共用 /ia/api/** 前缀。 */
    static final String API_PATH_PATTERN = "/ia/api/**";

    private final Properties properties;

    public IaCorsConfiguration(Properties properties) {
        this.properties = properties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        List<String> origins = effectiveOrigins();
        if (origins.isEmpty()) {
            // 缺省关闭:不注册映射,零 CORS 头(与未引入本配置前完全一致)
            return;
        }
        registry.addMapping(API_PATH_PATTERN)
                .allowedOrigins(origins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("Authorization", "X-IA-Act", "X-IA-Admin-Key",
                        "Content-Type", "Last-Event-ID")
                .allowCredentials(true)
                .maxAge(1800);
    }

    /** 有效来源:去空白、剔空项;全空 = 关闭。 */
    List<String> effectiveOrigins() {
        if (properties.getAllowedOrigins() == null) {
            return List.of();
        }
        return properties.getAllowedOrigins().stream()
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
    }

    /**
     * 来源 allowlist(env {@code IA_CORS_ALLOWED_ORIGINS},逗号分隔;缺省空
     * = 关闭)。逗号分隔字符串由 Spring 自动绑定为列表。
     */
    @ConfigurationProperties(prefix = "inneragent.cors")
    public static final class Properties {

        /** 允许的跨源来源(精确 scheme://host[:port];空 = 关闭 CORS)。 */
        private List<String> allowedOrigins = List.of();

        public List<String> getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = allowedOrigins;
        }

        /** 便捷构造(测试用)。 */
        public static Properties of(String... origins) {
            Properties properties = new Properties();
            properties.setAllowedOrigins(Arrays.asList(origins));
            return properties;
        }
    }
}
