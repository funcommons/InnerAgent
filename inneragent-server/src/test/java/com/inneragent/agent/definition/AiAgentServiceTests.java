package com.inneragent.agent.definition;

import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * P4 数据驱动内核:运行面定义解析优先级单测(DB 优先/代码注册表回落/
 * 端口缺失回落/同型补缺/fail-closed)。
 */
class AiAgentServiceTests {

    private static AiAgentDefinition definition(
            String type, String systemPrompt, String instructionTemplate) {
        return AiAgentDefinition.builder()
                .type(type)
                .name("数据驱动定义")
                .systemPrompt(systemPrompt)
                .instructionTemplate(instructionTemplate)
                .enableTools(1)
                .toolNames(List.of("get_current_time"))
                .subAgentTools(List.of())
                .build();
    }

    @Test
    void dbDefinitionWinsOverCodeRegistryForSameType() {
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentDefinition dbSide = definition(
                "demo", "DB 优先人设(管理面改完即生效)", "DB 指令");
        AiAgentService service = new AiAgentService(registry, stubPort(dbSide));

        AiAgentDefinition resolved = service.getByType("demo");

        assertThat(resolved).isSameAs(dbSide);
        assertThat(resolved.getSystemPrompt())
                .isEqualTo("DB 优先人设(管理面改完即生效)");
        assertThat(resolved.getInstructionTemplate()).isEqualTo("DB 指令");
        // getRequiredByType 同口:命中 DB 不再抛「类型不存在」
        assertThat(service.getRequiredByType("demo")).isSameAs(dbSide);
    }

    @Test
    void missesFallBackToCodeRegistry() {
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentDefinition codeSide = registry.getByType("demo");
        AiAgentService service = new AiAgentService(registry, stubPort(null));

        assertThat(service.getByType("demo")).isSameAs(codeSide);
    }

    @Test
    void dbOnlyTypeIsInvisibleWithoutDbAndUnknownTypeStillThrows() {
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentService service = new AiAgentService(registry, stubPort(null));

        assertThatThrownBy(() -> service.getRequiredByType("db-only-agent"))
                .isInstanceOf(com.inneragent.platform.common.BusinessException.class)
                .hasMessageContaining("Agent 类型不存在");
    }

    @Test
    void missingPortKeepsPreSwitchRegistryOnlyBehavior() {
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentDefinition codeSide = registry.getByType("demo");
        AiAgentService service = new AiAgentService(registry);

        assertThat(service.getByType("demo")).isSameAs(codeSide);
    }

    @Test
    void blankTypeSkipsDefinitionStoreLookup() {
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentService service = new AiAgentService(registry, stubPort(definition(
                "demo", "不应被命中", null)));

        assertThat(service.getByType(null)).isNull();
        assertThat(service.getByType("  ")).isNull();
    }

    @Test
    void tableUnrepresentedSlotsFillFromCodeTwin() {
        AiAgentRegistry registry = new AiAgentRegistry();
        // DB 行缺 defaultUserMessage(表未承载)→ 代码孪生补缺(无消息 Pipeline 场景零回归)
        AiAgentDefinition dbSide = definition("script_full_parse", "DB 人设", null);
        AiAgentService service = new AiAgentService(registry, stubPort(dbSide));

        AiAgentDefinition resolved = service.getByType("script_full_parse");

        assertThat(resolved).isSameAs(dbSide);
        assertThat(resolved.getDefaultUserMessage())
                .isEqualTo(registry.getByType("script_full_parse").getDefaultUserMessage());
    }

    @Test
    void parseFailurePropagatesInsteadOfSilentFallback() {
        AiAgentRegistry registry = new AiAgentRegistry();
        // fail-closed:DB 行命中但规格不可解析 → 抛真实原因,不静默回落代码
        AiAgentService service = new AiAgentService(registry, (appId, type) -> {
            throw new IllegalStateException("Agent 定义工具白名单不可解析: agentKey=" + type);
        });

        assertThatThrownBy(() -> service.getByType("demo"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("工具白名单不可解析");
    }

    private AgentDefinitionDataPort stubPort(AiAgentDefinition hit) {
        return (appId, agentKey) ->
                hit != null && hit.getType().equals(agentKey) ? hit : null;
    }
}
