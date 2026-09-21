package com.inneragent.platform.toolhub;

import com.inneragent.agent.mcp.McpToolHealthChecker;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 工具体检装配(V16,[new])。
 *
 * <p>探活通道依赖 ActTokenIssuer(体检握手携带与调用链同套 X-IA-Act,
 * audience = endpoint_url);探活超时等参数经 {@link ToolHealthProperties}
 * (inneragent.tools.health.*)下发。
 */
@Configuration
@EnableConfigurationProperties(ToolHealthProperties.class)
public class ToolHealthConfiguration {

    @Bean
    public McpToolHealthChecker mcpToolHealthChecker(ActTokenIssuer actTokenIssuer,
                                                     ObjectMapper objectMapper) {
        return new McpToolHealthChecker(actTokenIssuer, objectMapper);
    }
}
