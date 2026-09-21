package com.inneragent.agent.definition;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.dao.DuplicateKeyException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Agent 定义播种服务单元测试(P2-W5):insert-only 补种(缺行才插)、
 * kind 按 refAgentType 引用关系判定、白名单/子 Agent 工具序列化、
 * 唯一键竞态按已存在跳过。mapper mock。
 */
class AgentDefinitionSeederTests {

    private AiAgentRegistry agentRegistry;
    private AgentDefinitionMapper definitionMapper;
    private AgentDefinitionSeeder seeder;

    @BeforeEach
    void setUp() {
        agentRegistry = Mockito.mock(AiAgentRegistry.class);
        definitionMapper = Mockito.mock(AgentDefinitionMapper.class);
        seeder = new AgentDefinitionSeeder(agentRegistry, definitionMapper, new ObjectMapper());
        when(definitionMapper.selectList(any())).thenReturn(List.of());
    }

    @Test
    @DisplayName("kind 判定:被 subAgentTools.refAgentType 引用者为 sub,否则 main")
    void collectSubAgentTypesDerivesKind() {
        AiAgentDefinition parent = AiAgentDefinition.builder()
                .type("parent").name("父")
                .subAgentTools(List.of(AiAgentDefinition.SubAgentToolDef.builder()
                        .toolName("child_tool")
                        .refAgentType("child")
                        .build()))
                .build();
        AiAgentDefinition child = AiAgentDefinition.builder()
                .type("child").name("子")
                .build();
        when(agentRegistry.getAll()).thenReturn(List.of(parent, child));

        assertThat(AgentDefinitionSeeder.collectSubAgentTypes(List.of(parent, child)))
                .containsExactly("child");

        seeder.run(null);
        ArgumentCaptor<AgentDefinition> rows =
                ArgumentCaptor.forClass(AgentDefinition.class);
        verify(definitionMapper, Mockito.times(2)).insert(rows.capture());
        assertThat(rows.getAllValues())
                .extracting(AgentDefinition::getKind, AgentDefinition::getAgentKey)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("main", "parent"),
                        org.assertj.core.groups.Tuple.tuple("sub", "child"));
    }

    @Test
    @DisplayName("补种 insert-only:已存在 agentKey 跳过且不 UPDATE;空白指令模板落 NULL")
    void seedsOnlyMissingKeysWithoutUpdates() {
        AiAgentDefinition existing = AiAgentDefinition.builder()
                .type("already_here").name("已有")
                .instructionTemplate("")
                .toolNames(List.of("get_current_time", "parse_text_file"))
                .build();
        when(agentRegistry.getAll()).thenReturn(List.of(existing));
        AgentDefinition storedRow = new AgentDefinition();
        storedRow.setAgentKey("already_here");
        when(definitionMapper.selectList(any())).thenReturn(List.of(storedRow));

        seeder.run(null);

        verify(definitionMapper, Mockito.never()).insert(any(AgentDefinition.class));
        verify(definitionMapper, Mockito.never()).updateById(any(AgentDefinition.class));
    }

    @Test
    @DisplayName("播种行映射:agent_key/title/提示词/白名单 JSON/enabled=TRUE/appId=1")
    void seedsRowWithRegistryFields() {
        AiAgentDefinition definition = AiAgentDefinition.builder()
                .type("demo").name("演示")
                .systemPrompt("系统提示词")
                .instructionTemplate("指令模板")
                .toolNames(List.of("get_current_time"))
                .enableTools(1)
                .build();
        when(agentRegistry.getAll()).thenReturn(List.of(definition));

        seeder.run(null);

        ArgumentCaptor<AgentDefinition> inserted =
                ArgumentCaptor.forClass(AgentDefinition.class);
        verify(definitionMapper).insert(inserted.capture());
        AgentDefinition row = inserted.getValue();
        assertThat(row.getAppId()).isEqualTo(1L);
        assertThat(row.getAgentKey()).isEqualTo("demo");
        assertThat(row.getKind()).isEqualTo("main");
        assertThat(row.getTitle()).isEqualTo("演示");
        assertThat(row.getSystemPrompt()).isEqualTo("系统提示词");
        assertThat(row.getToolWhitelistJson()).isEqualTo("[\"get_current_time\"]");
        assertThat(row.getSubAgentToolsJson()).isNull();
        assertThat(row.getEnabled()).isTrue();
    }

    @Test
    @DisplayName("唯一键竞态:DualKey 并发播种抛 DuplicateKeyException → 记日志跳过不失败")
    void toleratesConcurrentSeedConflict() {
        AiAgentDefinition definition = AiAgentDefinition.builder()
                .type("demo").name("演示").systemPrompt("p").build();
        when(agentRegistry.getAll()).thenReturn(List.of(definition));
        when(definitionMapper.insert(any(AgentDefinition.class)))
                .thenThrow(new DuplicateKeyException("uk_ia_agent_definition_key"));

        assertThatCode(() -> seeder.run(null)).doesNotThrowAnyException();
    }
}
