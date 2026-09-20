package com.inneragent.agent.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.toolhub.ToolHubDefaultsConfiguration;
import com.inneragent.platform.toolhub.UnavailableMcpToolInvoker;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import com.inneragent.server.auth.act.ActTokenIssuer;
import com.inneragent.server.auth.act.ActTokenKeyManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * P1-T2b 接管证明:T2a 缺省实现({@link UnavailableMcpToolInvoker})的
 * back-off 与 {@code inneragent.mcp.enabled} 开关。
 *
 * <p> takeover 机制 = {@code ToolHubDefaultsConfiguration} 的
 * {@code @ConditionalOnMissingBean(McpToolInvoker.class)}:本任务声明
 * {@link McpClientToolInvoker} Bean 后缺省 Bean 自动让位(组件扫描按包名序
 * agent &lt; platform + 最高 @Order,先处理本配置类)。
 */
class McpInvokerTakeoverTests {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(ObjectMapper.class)
            .withBean(ActTokenKeyManager.class, () -> new ActTokenKeyManager(null, null))
            .withBean(ActTokenIssuer.class)
            .withBean(ToolRegistryMapper.class, () -> Mockito.mock(ToolRegistryMapper.class));

    @Test
    @DisplayName("接管:两个配置类共存时仅 McpClientToolInvoker 装配,缺省实现让位(back-off)")
    void realInvokerBacksOffDefaultInvoker() {
        runner.withUserConfiguration(McpInvokerConfiguration.class, ToolHubDefaultsConfiguration.class)
                .run(context -> {
                    assertThat(context).hasSingleBean(McpToolInvoker.class);
                    assertThat(context.getBean(McpToolInvoker.class))
                            .isInstanceOf(McpClientToolInvoker.class);
                    Map<String, McpToolInvoker> all = context.getBeansOfType(McpToolInvoker.class);
                    assertThat(all).as("缺省实现必须让位,不得出现双候选").hasSize(1);
                    assertThat(context.getBean(McpClientToolInvoker.class)).isNotNull();
                    assertThat(context.getBeansOfType(UnavailableMcpToolInvoker.class)).isEmpty();
                });
    }

    @Test
    @DisplayName("基线:仅 T2a 缺省配置时 UnavailableMcpToolInvoker 装配")
    void defaultInvokerServesWithoutBridgeConfiguration() {
        runner.withUserConfiguration(ToolHubDefaultsConfiguration.class)
                .run(context -> {
                    assertThat(context).hasSingleBean(McpToolInvoker.class);
                    assertThat(context.getBean(McpToolInvoker.class))
                            .isInstanceOf(UnavailableMcpToolInvoker.class);
                });
    }

    @Test
    @DisplayName("开关:inneragent.mcp.enabled=false 时不装配真实调用端,回退缺省实现")
    void disabledPropertyFallsBackToDefaultInvoker() {
        runner.withPropertyValues("inneragent.mcp.enabled=false")
                .withUserConfiguration(McpInvokerConfiguration.class, ToolHubDefaultsConfiguration.class)
                .run(context -> {
                    assertThat(context.getBeansOfType(McpClientToolInvoker.class)).isEmpty();
                    assertThat(context).hasSingleBean(McpToolInvoker.class);
                    assertThat(context.getBean(McpToolInvoker.class))
                            .isInstanceOf(UnavailableMcpToolInvoker.class);
                });
    }

    @Test
    @DisplayName("缺省属性:matchIfMissing=true,未配置 inneragent.mcp 时真实调用端接管")
    void missingPropertyStillTakesOver() {
        runner.withUserConfiguration(McpInvokerConfiguration.class, ToolHubDefaultsConfiguration.class)
                .run(context -> assertThat(context.getBean(McpToolInvoker.class))
                        .isInstanceOf(McpClientToolInvoker.class));
    }

    @Test
    @DisplayName("装配产物:配置属性默认值(30s 超时/重试一次/200ms 退避基数)")
    void propertiesCarryDocumentedDefaults() {
        runner.withUserConfiguration(McpInvokerConfiguration.class).run(context -> {
            McpInvokerProperties properties = context.getBean(McpInvokerProperties.class);
            assertThat(properties.isEnabled()).isTrue();
            assertThat(properties.getCallTimeout()).hasSeconds(30);
            assertThat(properties.getMaxClients()).isEqualTo(32);
            assertThat(properties.getClientExpireAfterAccess()).hasMinutes(30);
            assertThat(properties.getReconnect().getInitialBackoff()).hasMillis(200);
            assertThat(properties.getReconnect().getMaxBackoff()).hasSeconds(5);
            assertThat(properties.getReconnect().getMaxAttempts()).isEqualTo(1);
        });
    }
}
