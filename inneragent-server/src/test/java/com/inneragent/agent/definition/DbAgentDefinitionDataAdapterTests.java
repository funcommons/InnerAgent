package com.inneragent.agent.definition;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P4 数据驱动内核:ia_agent_definition 行 → 内核定义形态映射单测
 * (工具面三分法/子工具规格解析/启用态过滤/fail-closed)。
 */
class DbAgentDefinitionDataAdapterTests {

    private final AgentDefinitionMapper mapper = mock(AgentDefinitionMapper.class);
    private final DbAgentDefinitionDataAdapter adapter =
            new DbAgentDefinitionDataAdapter(mapper, new ObjectMapper());

    @Test
    void blankToolWhitelistMapsToNoToolFace() {
        // 播种侧 enableTools=0 代码定义 → 行 toolWhitelistJson=null → 还原无工具面
        when(mapper.selectByAppAndKey(1L, "no-face")).thenReturn(row("no-face", null));

        AiAgentDefinition definition = adapter.loadEnabled(1L, "no-face");

        assertThat(definition.getEnableTools()).isZero();
        assertThat(definition.getToolNames()).isNull();
        assertThat(definition.getSubAgentTools()).isEmpty();
    }

    @Test
    void emptyArrayKeepsEnabledFaceWithEmptyWhitelist() {
        // 导入侧「toolWhitelist: []」→ enableTools=1 空白名单(MCP 缺省可见性)
        when(mapper.selectByAppAndKey(1L, "empty-face"))
                .thenReturn(row("empty-face", "[]"));

        AiAgentDefinition definition = adapter.loadEnabled(1L, "empty-face");

        assertThat(definition.getEnableTools()).isEqualTo(1);
        assertThat(definition.getToolNames()).isEmpty();
    }

    @Test
    void declaredWhitelistAndSubToolsRoundTrip() {
        AgentDefinition row = row("db-driven", """
                ["get_current_time","mcp__crm__list_users"]""");
        row.setSubAgentToolsJson("""
                [{"toolName":"db_sub_tool","description":"调起子定义",
                  "parametersSchema":"{\\"type\\":\\"object\\"}",
                  "refAgentType":"db-child","outputSchema":null,
                  "systemPromptOverride":"子人设覆盖"}]""");
        row.setContextTemplateJson("{\"风格\":\"简洁\"}");
        when(mapper.selectByAppAndKey(1L, "db-driven")).thenReturn(row);

        AiAgentDefinition definition = adapter.loadEnabled(1L, "db-driven");

        assertThat(definition.getEnableTools()).isEqualTo(1);
        assertThat(definition.getToolNames())
                .containsExactly("get_current_time", "mcp__crm__list_users");
        assertThat(definition.getSubAgentTools()).singleElement().satisfies(sub -> {
            assertThat(sub.getToolName()).isEqualTo("db_sub_tool");
            assertThat(sub.getRefAgentType()).isEqualTo("db-child");
            assertThat(sub.getSystemPromptOverride()).isEqualTo("子人设覆盖");
            assertThat(sub.getParametersSchema()).contains("\"type\"");
        });
        assertThat(definition.getContextTemplateJson()).contains("风格");
    }

    @Test
    void adminImportedObjectSchemasAndUnknownFieldsAreTolerated() {
        // 管理面导入按 bundle 原样落库:schema 可为对象节点、条目可携带宿主自有
        // 规格(未知字段向前兼容);内核形态统一收敛(schema 字符串化)
        AgentDefinition row = row("host-shaped", "[\"get_current_time\"]");
        row.setSubAgentToolsJson("""
                [{"toolName":"db_sub_tool","description":"调起子定义",
                  "parametersSchema":{"type":"object","properties":{"message":{"type":"string"}}},
                  "refAgentType":"db-child",
                  "hostSpec":{"extra":"宿主自有规格"}}]""");
        when(mapper.selectByAppAndKey(1L, "host-shaped")).thenReturn(row);

        AiAgentDefinition definition = adapter.loadEnabled(1L, "host-shaped");

        assertThat(definition.getSubAgentTools()).singleElement().satisfies(sub -> {
            assertThat(sub.getParametersSchema())
                    .startsWith("{\"type\":\"object\"")
                    .contains("\"message\"");
            assertThat(sub.getRefAgentType()).isEqualTo("db-child");
        });
    }

    @Test
    void missingRowAndDisabledRowBothMiss() {
        when(mapper.selectByAppAndKey(1L, "absent")).thenReturn(null);
        AgentDefinition disabled = row("disabled", "[\"get_current_time\"]");
        disabled.setEnabled(false);
        when(mapper.selectByAppAndKey(1L, "disabled")).thenReturn(disabled);

        assertThat(adapter.loadEnabled(1L, "absent")).isNull();
        assertThat(adapter.loadEnabled(1L, "disabled")).isNull();
    }

    @Test
    void malformedStoredSpecFailsClosedWithRealReason() {
        when(mapper.selectByAppAndKey(anyLong(), anyString()))
                .thenReturn(row("corrupted", "{not-json"));

        assertThatThrownBy(() -> adapter.loadEnabled(1L, "corrupted"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("工具白名单不可解析")
                .hasMessageContaining("corrupted");
    }

    @Test
    void malformedSubAgentSpecFailsClosedWithRealReason() {
        AgentDefinition row = row("corrupted-subs", "[\"get_current_time\"]");
        row.setSubAgentToolsJson("[{broken");
        when(mapper.selectByAppAndKey(anyLong(), anyString())).thenReturn(row);

        assertThatThrownBy(() -> adapter.loadEnabled(1L, "corrupted-subs"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("子 Agent 工具规格不可解析");
    }

    private AgentDefinition row(String agentKey, String toolWhitelistJson) {
        AgentDefinition row = new AgentDefinition();
        row.setId(1L);
        row.setAppId(1L);
        row.setAgentKey(agentKey);
        row.setKind(AgentDefinitionSeeder.KIND_MAIN);
        row.setTitle("DB 定义 " + agentKey);
        row.setSystemPrompt("DB 人设: " + agentKey);
        row.setInstructionTemplate(null);
        row.setToolWhitelistJson(toolWhitelistJson);
        row.setSubAgentToolsJson(null);
        row.setContextTemplateJson(null);
        row.setEnabled(true);
        return row;
    }
}
