package com.inneragent.platform.safety;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

/**
 * 内容安全缺省装配(P2-safety W6)。
 *
 * <p>缺省链成员:enabled + callback-url 就绪 → {@link CallbackContentSafetyFilter}
 * (可配回调);否则 {@link NoopContentSafetyFilter}(pass-through,零行为变更)。
 * 宿主自声明 {@link ContentSafetyFilter} Bean 时本缺省装配自动让位
 * ({@code @ConditionalOnMissingBean};本配置 {@code @Order(LOWEST_PRECEDENCE)}
 * 保证在宿主配置之后评估,对齐 McpInvokerConfiguration/ToolHubDefaults
 * 的让位模式)。宿主可与缺省过滤器并存:多个过滤器 Bean 按链序全部执行。
 */
@Configuration
@Order(Ordered.LOWEST_PRECEDENCE)
@EnableConfigurationProperties(ContentSafetyProperties.class)
public class ContentSafetyConfiguration {

    @Bean
    @ConditionalOnMissingBean(ContentSafetyFilter.class)
    public ContentSafetyFilter defaultContentSafetyFilter(ContentSafetyProperties properties,
                                                          ObjectMapper objectMapper) {
        if (properties.isEnabled()
                && properties.getCallbackUrl() != null
                && !properties.getCallbackUrl().isBlank()) {
            return new CallbackContentSafetyFilter(properties, objectMapper);
        }
        return new NoopContentSafetyFilter();
    }
}
