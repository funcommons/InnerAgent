package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.server.auth.act.ActTokenIssuer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

/**
 * MCP 宿主桥调用端装配(P1-T2b [new])。
 *
 * <p>声明 {@link McpClientToolInvoker} 接管 {@link McpToolInvoker} 端口:
 * {@code ToolHubDefaultsConfiguration} 的缺省实现
 * ({@code UnavailableMcpToolInvoker})以 {@code @ConditionalOnMissingBean}
 * 装配,本配置在组件扫描中先于其处理(agent 包名序在前 + 最高 @Order),
 * 缺省 Bean 即自动让位——内核侧 ObjectProvider 注入零改动切换。
 *
 * <p>装配条件:{@code inneragent.mcp.enabled!=false}(缺省开启)。客户端
 * 懒建懒连(首次 invoke 才连接宿主),无可达宿主不阻断启动、按调用懒失败。
 * 关闭时无本 Bean,缺省实现接管(调用抛 {@link McpInvokerUnavailableException})。
 */
@Configuration
@Order(Ordered.HIGHEST_PRECEDENCE)
@EnableConfigurationProperties(McpInvokerProperties.class)
public class McpInvokerConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "inneragent.mcp", name = "enabled",
            havingValue = "true", matchIfMissing = true)
    public McpClientToolInvoker mcpClientToolInvoker(ToolRegistryMapper registryMapper,
                                                     ActTokenIssuer actTokenIssuer,
                                                     ObjectMapper objectMapper,
                                                     McpInvokerProperties properties,
                                                     org.springframework.beans.factory.ObjectProvider<com.inneragent.agent.observability.GenAiSpanFactory> spanFactories,
                                                     org.springframework.beans.factory.ObjectProvider<com.inneragent.agent.mapper.McpServerConfigMapper> thirdPartyAppMappers,
                                                     org.springframework.beans.factory.ObjectProvider<com.inneragent.agent.mapper.McpUserServerMapper> thirdPartyUserMappers) {
        // [adapt] 任务 #18b(W5):MCP client span 工厂随 Bean 下发(缺省 noop);
        // [P4-W13] 三方服务器配置定位(应用级 + 用户级)随 Bean 下发(ObjectProvider
        // 韧性注入:最小上下文/裁剪部署缺 Mapper 时降级为仅宿主桥解析)。
        return new McpClientToolInvoker(registryMapper, actTokenIssuer, objectMapper,
                properties, spanFactories.getIfAvailable(),
                thirdPartyAppMappers.getIfAvailable(), thirdPartyUserMappers.getIfAvailable());
    }
}
