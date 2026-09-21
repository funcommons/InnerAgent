package com.inneragent.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.toolhub.ToolAuditLog;
import com.inneragent.platform.toolhub.mapper.ToolAuditLogMapper;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import com.inneragent.server.admin.AgentDefinitionAdminService.DefinitionView;
import com.inneragent.server.admin.AgentDefinitionBundle;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Agent 定义导入导出真库旅程(P2-W5 真机抽查;ia_agent_definition 实表):
 * 启动播种(代码注册表 → 缺行补种)→ 导出 bundle → 编辑提示词 →
 * dryRun 导入(零副作用)→ 实导 overwrite(回读一致)→ skip 保留现库 →
 * 条目级错误收集 → 编辑留痕落 ia_audit_log(decision=definition-updated,
 * source=admin)。连接串与运行态 application.yml 同形(不加
 * stringtype=unspecified,口径同 {@link AppRegistrationWritePathsIT})。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AgentDefinitionImportExportIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "def-io-node");
    }

    @Autowired
    private AgentDefinitionAdminService definitionService;

    @Autowired
    private AgentDefinitionMapper definitionMapper;

    @Autowired
    private ToolAuditLogMapper auditMapper;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void seederPopulatesDefinitionsFromCodeRegistry() {
        List<AgentDefinition> rows = definitionMapper.selectList(
                new LambdaQueryWrapper<AgentDefinition>()
                        .eq(AgentDefinition::getAppId, 1L)
                        .orderByAsc(AgentDefinition::getAgentKey));
        assertThat(rows).isNotEmpty();
        // kind 引用判定:episode_scene_writer 被父 Agent 的 refAgentType 引用 → sub
        assertThat(rows).anySatisfy(row -> {
            assertThat(row.getAgentKey()).isEqualTo("episode_scene_writer");
            assertThat(row.getKind()).isEqualTo("sub");
        });
        // 无子 Agent 引用 → main
        assertThat(rows).anySatisfy(row -> {
            assertThat(row.getAgentKey()).isEqualTo("demo");
            assertThat(row.getKind()).isEqualTo("main");
            assertThat(row.getSystemPrompt()).isNotBlank();
        });
    }

    @Test
    void exportEditImportRoundtripRestoresPrompt() throws Exception {
        AgentDefinition demo = definitionMapper.selectByAppAndKey(1, "demo");
        String originalPrompt = demo.getSystemPrompt();

        // 1. 导出 bundle(单定义;形状 schemaVersion=1 + definitions 元数据)
        AgentDefinitionBundle.Bundle bundle = definitionService.export(1, List.of(demo.getId()));
        assertThat(bundle.schemaVersion()).isEqualTo(1);
        assertThat(bundle.exportedAt()).isNotBlank();
        assertThat(bundle.definitions()).hasSize(1);
        assertThat(bundle.definitions().getFirst().agentType()).isEqualTo("demo");
        JsonNode bundleNode = objectMapper.readTree(objectMapper.writeValueAsString(bundle));

        // 2. 编辑提示词(admin 面)
        DefinitionView edited = definitionService.updatePrompt(
                demo.getId(), "systemPrompt", "IT 临时改写后的提示词");
        assertThat(edited.prompts().systemPrompt()).isEqualTo("IT 临时改写后的提示词");

        // 3. dryRun 导入原 bundle:报告 updated=1 且零副作用
        AgentDefinitionBundle.ImportResult dryRun = definitionService.importBundle(
                1, bundleNode, "overwrite", true);
        assertThat(dryRun.dryRun()).isTrue();
        assertThat(dryRun.updated()).isEqualTo(1);
        assertThat(dryRun.errors()).isEmpty();
        assertThat(definitionMapper.selectById(demo.getId()).getSystemPrompt())
                .as("dryRun 不得有任何写副作用")
                .isEqualTo("IT 临时改写后的提示词");

        // 4. 实导 overwrite:bundle 原值回写,回读一致
        AgentDefinitionBundle.ImportResult applied = definitionService.importBundle(
                1, bundleNode, "overwrite", false);
        assertThat(applied.updated()).isEqualTo(1);
        assertThat(applied.created()).isZero();
        assertThat(definitionMapper.selectById(demo.getId()).getSystemPrompt())
                .as("export → 改 prompt → import 回读一致")
                .isEqualTo(originalPrompt);

        // 5. skip 策略:冲突保留现库(先改再 skip 导入,现库值不被覆盖)
        definitionService.updatePrompt(demo.getId(), "systemPrompt", "skip 策略前改写");
        AgentDefinitionBundle.ImportResult skipped = definitionService.importBundle(
                1, bundleNode, "skip", false);
        assertThat(skipped.skipped()).isEqualTo(1);
        assertThat(definitionMapper.selectById(demo.getId()).getSystemPrompt())
                .isEqualTo("skip 策略前改写");
    }

    @Test
    void importCollectsPerEntryErrorsWithoutBlockingValidEntries() throws Exception {
        AgentDefinition demo = definitionMapper.selectByAppAndKey(1, "demo");
        String rawBundle = """
                {
                  "schemaVersion": 1,
                  "exportedAt": "2026-09-21T00:00:00Z",
                  "definitions": [
                    {"agentType": "bad_slot", "name": "坏槽位",
                     "prompts": [{"slot": "brain", "content": "x"}]},
                    {"agentType": "demo", "name": "覆盖名称",
                     "prompts": [{"slot": "greeting", "content": "你好,我是演示助手"}]}
                  ]
                }
                """;
        JsonNode bundleNode = objectMapper.readTree(rawBundle);

        AgentDefinitionBundle.ImportResult result =
                definitionService.importBundle(1, bundleNode, "overwrite", false);

        assertThat(result.errors()).hasSize(1);
        assertThat(result.errors().getFirst().agentType()).isEqualTo("bad_slot");
        assertThat(result.errors().getFirst().reason()).contains("槽位");
        assertThat(result.updated()).isEqualTo(1);
        AgentDefinition reloaded = definitionMapper.selectById(demo.getId());
        assertThat(reloaded.getGreeting()).isEqualTo("你好,我是演示助手");
        assertThat(reloaded.getTitle()).isEqualTo("覆盖名称");
    }

    @Test
    void promptEditAndImportLeaveAuditTrail() {
        AgentDefinition demo = definitionMapper.selectByAppAndKey(1, "demo");

        definitionService.updatePrompt(demo.getId(), "instructionTemplate", "IT 审计留痕指令");

        List<ToolAuditLog> audits = auditMapper.selectList(
                new LambdaQueryWrapper<ToolAuditLog>()
                        .eq(ToolAuditLog::getToolFqn, "agent-definition:demo")
                        .orderByAsc(ToolAuditLog::getId));
        assertThat(audits).isNotEmpty();
        assertThat(audits).anySatisfy(entry -> {
            assertThat(entry.getDecision()).isEqualTo("definition-updated");
            assertThat(entry.getDecisionSource()).isEqualTo("admin");
            assertThat(entry.getParamsMaskedJson()).contains("instructionTemplate");
        });
    }
}
