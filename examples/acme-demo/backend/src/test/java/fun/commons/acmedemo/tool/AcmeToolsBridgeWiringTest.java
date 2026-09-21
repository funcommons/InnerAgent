package fun.commons.acmedemo.tool;

import static org.assertj.core.api.Assertions.assertThat;

import com.inneragent.starter.IaToolDefinition;
import com.inneragent.starter.ToolRiskLevel;
import com.inneragent.starter.bridge.IaMcpServerBridge;
import com.inneragent.starter.bridge.IaToolExposureFilter;
import com.inneragent.starter.bridge.IaToolScanner;
import com.inneragent.starter.config.IaBridgeAutoConfiguration;
import fun.commons.acmedemo.AcmeDemoApplication;
import java.util.List;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;

/**
 * starter 工具桥接线测试:
 * 1) 自动装配扫描到 DEMO 的 3 个 @IaTool 工具并注册进进程内 MCP server;
 * 2) tools.include / tools.exclude 开关(include 白名单、exclude 优先、前缀通配)。
 * 不触达 InnerAgent server:JWKS 拉取是惰性行为,启动仅依赖配置。
 */
class AcmeToolsBridgeWiringTest {

    private static final String[] BASE_PROPS = {
            "inneragent.bridge.server-base=http://localhost:18090",
            "inneragent.bridge.endpoint=/ia-mcp",
            "inneragent.bridge.act.audiences=http://localhost:9300/ia-mcp",
    };

    @Test
    void 自动装配_扫描到demo三个工具并注册进桥() {
        bridgeRunner().withPropertyValues(BASE_PROPS).run(context -> {
            assertThat(context).hasSingleBean(IaMcpServerBridge.class);
            IaMcpServerBridge bridge = context.getBean(IaMcpServerBridge.class);
            assertThat(bridge.registeredTools())
                    .containsExactlyInAnyOrder("create_ticket", "list_tickets", "resolve_scope");
            // 风险级如实声明(影响确认策略:WRITE 先确认,READ 自动执行)
            List<IaToolDefinition> definitions = context.getBean(IaToolScanner.class).scan();
            assertThat(definitions).extracting(IaToolDefinition::name, IaToolDefinition::riskLevel)
                    .containsExactlyInAnyOrder(
                            Tuple.tuple("create_ticket", ToolRiskLevel.WRITE),
                            Tuple.tuple("list_tickets", ToolRiskLevel.READ),
                            Tuple.tuple("resolve_scope", ToolRiskLevel.READ));
        });
    }

    @Test
    void include白名单_仅名单内工具暴露() {
        bridgeRunner().withPropertyValues(BASE_PROPS)
                .withPropertyValues("inneragent.bridge.tools.include=create_ticket")
                .run(context -> assertThat(context.getBean(IaMcpServerBridge.class).registeredTools())
                        .containsExactly("create_ticket"));
    }

    @Test
    void exclude黑名单_优先于include_支持前缀通配() {
        bridgeRunner().withPropertyValues(BASE_PROPS)
                .withPropertyValues("inneragent.bridge.tools.include=create_ticket,list_tickets",
                        "inneragent.bridge.tools.exclude=list_*")
                .run(context -> assertThat(context.getBean(IaMcpServerBridge.class).registeredTools())
                        .containsExactly("create_ticket"));
    }

    @Test
    void enabledFalse_不装配任何桥组件() {
        new WebApplicationContextRunner()
                .withPropertyValues("inneragent.bridge.enabled=false")
                .withConfiguration(AutoConfigurations.of(IaBridgeAutoConfiguration.class))
                .withUserConfiguration(AcmeTicketTools.class)
                .run(context -> assertThat(context).doesNotHaveBean(IaMcpServerBridge.class));
    }

    @Test
    void 真实应用上下文_桥与工具同容器就绪() {
        // 全应用上下文(含 @Component 形态工具类):验证 starter 经
        // AutoConfiguration.imports 自动装配,无需宿主任何 @EnableXxx
        new WebApplicationContextRunner()
                .withPropertyValues(BASE_PROPS)
                .withUserConfiguration(AcmeDemoApplication.class)
                .run(context -> {
                    assertThat(context).hasSingleBean(IaMcpServerBridge.class);
                    assertThat(context.getBean(IaMcpServerBridge.class).registeredTools())
                            .containsExactlyInAnyOrder("create_ticket", "list_tickets", "resolve_scope");
                });
    }

    @Test
    void 暴露过滤器_空配置原样返回() throws Exception {
        IaToolDefinition definition = IaToolDefinition.of(
                AcmeTicketTools.class.getDeclaredMethod("createTicket",
                        String.class, String.class, String.class, com.inneragent.starter.act.IaActClaims.class),
                new AcmeTicketTools());
        assertThat(new IaToolExposureFilter(List.of(), List.of()).apply(List.of(definition)))
                .containsExactly(definition);
    }

    private WebApplicationContextRunner bridgeRunner() {
        return new WebApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(IaBridgeAutoConfiguration.class))
                .withUserConfiguration(AcmeTicketTools.class);
    }
}
