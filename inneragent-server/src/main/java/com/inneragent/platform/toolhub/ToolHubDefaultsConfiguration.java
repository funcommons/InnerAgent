package com.inneragent.platform.toolhub;

import com.inneragent.agent.mcp.McpToolInvoker;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 工具中枢缺省 Bean 装配(P1-T2a [new])。
 *
 * <p>{@link McpToolInvoker} 缺省实现:{@link UnavailableMcpToolInvoker};
 * T2b 声明自己的 McpToolInvoker Bean 后本条件装配自动让位——内核侧
 * ObjectProvider 注入随之拿到真实实现,行为切换零改动。
 */
@Configuration
public class ToolHubDefaultsConfiguration {

    @Bean
    @ConditionalOnMissingBean(McpToolInvoker.class)
    public McpToolInvoker unavailableMcpToolInvoker() {
        return new UnavailableMcpToolInvoker();
    }
}
