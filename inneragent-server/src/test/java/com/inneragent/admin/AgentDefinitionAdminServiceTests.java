package com.inneragent.admin;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentDefinition;
import com.inneragent.agent.mapper.AgentDefinitionMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import com.inneragent.server.admin.AgentDefinitionAdminService.DefinitionView;
import com.inneragent.server.admin.AgentDefinitionBundle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Agent 定义管理服务单元测试(P2-W5):提示词编辑校验与审计留痕(旧值快照)、
 * 分页列表 PageResult 形、导出 bundle 形状(schemaVersion=1/specJson/prompts)、
 * 导入合法 bundle 新建、冲突 skip/overwrite 两策略、bundle 级/条目级非法、
 * dryRun 零副作用。mapper/审计服务 mock。
 */
class AgentDefinitionAdminServiceTests {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AgentDefinitionMapper definitionMapper;
    private ToolAuditService auditService;
    private AgentDefinitionAdminService service;

    @BeforeEach
    void setUp() {
        definitionMapper = Mockito.mock(AgentDefinitionMapper.class);
        auditService = Mockito.mock(ToolAuditService.class);
        service = new AgentDefinitionAdminService(definitionMapper, auditService, MAPPER);
        // 初始化 MP 实体元数据缓存:服务构建 LambdaQueryWrapper(列表/导出)
        // 需要 TableInfo(真实容器由 MapperScan 初始化;口径同审计检索测试)
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(
                        new com.baomidou.mybatisplus.core.MybatisConfiguration(), ""),
                AgentDefinition.class);
    }

    private static AgentDefinition row(long id, String agentKey, String kind) {
        AgentDefinition row = new AgentDefinition();
        row.setId(id);
        row.setAppId(1L);
        row.setAgentKey(agentKey);
        row.setKind(kind);
        row.setTitle("名称-" + agentKey);
        row.setSystemPrompt("旧系统提示词");
        row.setInstructionTemplate("旧指令模板");
        row.setGreeting(null);
        row.setEnabled(true);
        return row;
    }

    // ------------------------------------------------------------------
    // 提示词编辑
    // ------------------------------------------------------------------

    @Test
    @DisplayName("编辑 systemPrompt:落库 + 审计 decision=definition-updated/source=admin 携旧值快照")
    void updatePromptPersistsAndAuditsOldValue() throws Exception {
        AgentDefinition existing = row(7L, "demo", "main");
        when(definitionMapper.selectById(7L)).thenReturn(existing);

        DefinitionView view = service.updatePrompt(7L, "systemPrompt", "新系统提示词");

        assertThat(view.prompts().systemPrompt()).isEqualTo("新系统提示词");
        verify(definitionMapper).updateById(existing);
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("definition-updated");
        assertThat(audit.getValue().decisionSource()).isEqualTo("admin");
        assertThat(audit.getValue().toolFqn()).isEqualTo("agent-definition:demo");
        JsonNode snapshot = MAPPER.readTree(audit.getValue().paramsMaskedJson());
        assertThat(snapshot.path("slot").asText()).isEqualTo("systemPrompt");
        assertThat(snapshot.path("oldContent").asText()).isEqualTo("旧系统提示词");
        assertThat(snapshot.path("agentType").asText()).isEqualTo("demo");
    }

    @Test
    @DisplayName("编辑校验:systemPrompt 空白 400;content 缺失 400;未知槽位 400;超长 400;未找到 404")
    void updatePromptValidations() {
        when(definitionMapper.selectById(7L)).thenReturn(row(7L, "demo", "main"));

        assertThatThrownBy(() -> service.updatePrompt(7L, "systemPrompt", "   "))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("systemPrompt 不能为空白");
        assertThatThrownBy(() -> service.updatePrompt(7L, "systemPrompt", null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("content 不能为空");
        assertThatThrownBy(() -> service.updatePrompt(7L, "brain", "任意"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("槽位");
        assertThatThrownBy(() -> service.updatePrompt(7L, "greeting", "x".repeat(65_537)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("长度上限");
        assertThatThrownBy(() -> service.updatePrompt(404L, "greeting", "hi"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("404");
        verify(definitionMapper, never()).updateById(any(AgentDefinition.class));
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("编辑 instructionTemplate 空白=清空(仅 systemPrompt 强制非空)")
    void updatePromptAllowsBlankInstruction() {
        AgentDefinition existing = row(7L, "demo", "main");
        when(definitionMapper.selectById(7L)).thenReturn(existing);

        DefinitionView view = service.updatePrompt(7L, "instructionTemplate", "  ");

        assertThat(view.prompts().instructionTemplate()).isEqualTo("  ");
        verify(definitionMapper).updateById(existing);
    }

    // ------------------------------------------------------------------
    // 列表与详情
    // ------------------------------------------------------------------

    @Test
    @DisplayName("分页列表:PageResult 形(list/total/pageNo/pageSize 回填)")
    void pageReturnsPageResultShape() {
        when(definitionMapper.selectPage(any(), any())).thenAnswer(invocation -> {
            Page<AgentDefinition> page = invocation.getArgument(0);
            page.setRecords(List.of(row(1L, "demo", "main")));
            page.setTotal(11);
            return page;
        });

        PageResult<DefinitionView> result = service.page(1, 2, 10);

        assertThat(result.getTotal()).isEqualTo(11);
        assertThat(result.getPageNo()).isEqualTo(2);
        assertThat(result.getPageSize()).isEqualTo(10);
        assertThat(result.getList()).hasSize(1);
        assertThat(result.getList().getFirst().agentType()).isEqualTo("demo");
    }

    @Test
    @DisplayName("详情:prompts 三槽 + spec 对象与 bundle specJson 同构")
    void getReturnsDetailWithPromptsAndSpec() {
        AgentDefinition existing = row(7L, "demo", "main");
        existing.setToolWhitelistJson("[\"get_current_time\"]");
        existing.setSubAgentToolsJson(null);
        existing.setContextTemplateJson("{\"a\":1}");
        when(definitionMapper.selectById(7L)).thenReturn(existing);

        DefinitionView view = service.get(7L);

        assertThat(view.prompts().systemPrompt()).isEqualTo("旧系统提示词");
        assertThat(view.prompts().greeting()).isNull();
        assertThat(view.spec().path("kind").asText()).isEqualTo("main");
        assertThat(view.spec().path("enabled").asBoolean()).isTrue();
        assertThat(view.spec().path("toolWhitelist").get(0).asText()).isEqualTo("get_current_time");
        assertThat(view.spec().path("subAgentTools").isNull()).isTrue();
        assertThat(view.spec().path("contextTemplate").path("a").asInt()).isEqualTo(1);
        assertThatThrownBy(() -> service.get(404L))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("404");
    }

    // ------------------------------------------------------------------
    // 导出
    // ------------------------------------------------------------------

    @Test
    @DisplayName("导出:schemaVersion=1 + exportedAt + definitions{definitionId,agentType,name,specJson,prompts[3 槽]}")
    void exportProducesVersionedBundle() throws Exception {
        AgentDefinition existing = row(7L, "demo", "main");
        existing.setToolWhitelistJson("[\"get_current_time\"]");
        when(definitionMapper.selectList(any())).thenReturn(List.of(existing));

        AgentDefinitionBundle.Bundle bundle = service.export(1, null);

        assertThat(bundle.schemaVersion()).isEqualTo(AgentDefinitionBundle.SCHEMA_VERSION);
        assertThat(bundle.exportedAt()).isNotBlank();
        assertThat(bundle.definitions()).hasSize(1);
        AgentDefinitionBundle.DefinitionEntry entry = bundle.definitions().getFirst();
        assertThat(entry.definitionId()).isEqualTo(7L);
        assertThat(entry.agentType()).isEqualTo("demo");
        assertThat(entry.name()).isEqualTo("名称-demo");
        assertThat(entry.specJson().path("kind").asText()).isEqualTo("main");
        assertThat(entry.specJson().path("toolWhitelist").get(0).asText())
                .isEqualTo("get_current_time");
        assertThat(entry.prompts()).hasSize(3);
        assertThat(entry.prompts().get(0).slot()).isEqualTo("systemPrompt");
        assertThat(entry.prompts().get(0).content()).isEqualTo("旧系统提示词");
        // bundle 顶层可整体 JSON 往返(契约冻结面)
        String serialized = MAPPER.writeValueAsString(bundle);
        JsonNode reparsed = MAPPER.readTree(serialized);
        assertThat(reparsed.path("schemaVersion").asInt()).isEqualTo(1);
        assertThat(reparsed.path("definitions").isArray()).isTrue();
    }

    @Test
    @DisplayName("导出:ids 过滤走主键 IN,不叠加 appId(平台视图)")
    void exportByIdsFiltersByPrimaryKey() {
        when(definitionMapper.selectList(any())).thenReturn(List.of());

        service.export(1, List.of(7L, 7L, 9L));

        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>>
                captor = ArgumentCaptor.forClass(wrapperType());
        verify(definitionMapper).selectList(captor.capture());
        String sql = captor.getValue().getSqlSegment();
        assertThat(sql).contains("IN").doesNotContain("app_id");
    }

    @Test
    @DisplayName("导出:无 ids 按 appId 全量(app_id 出现在 SQL 条件)")
    void exportWithoutIdsFiltersByApp() {
        when(definitionMapper.selectList(any())).thenReturn(List.of());

        service.export(3, null);

        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>>
                captor = ArgumentCaptor.forClass(wrapperType());
        verify(definitionMapper).selectList(captor.capture());
        assertThat(captor.getValue().getSqlSegment()).contains("app_id");
    }

    // ------------------------------------------------------------------
    // 导入
    // ------------------------------------------------------------------

    private static String validNewEntry(String agentType) {
        return """
                {
                  "agentType": "%s",
                  "name": "导入定义",
                  "specJson": {
                    "kind": "sub",
                    "enabled": false,
                    "toolWhitelist": ["get_current_time"],
                    "subAgentTools": null
                  },
                  "prompts": [
                    {"slot": "systemPrompt", "content": "导入系统提示词"},
                    {"slot": "greeting", "content": "你好"}
                  ]
                }
                """.formatted(agentType);
    }

    private JsonNode bundleOf(String... entries) {
        StringBuilder raw = new StringBuilder("{\"schemaVersion\":1,\"exportedAt\":\"2026-09-21T00:00:00Z\",\"definitions\":[");
        raw.append(String.join(",", entries)).append("]}");
        try {
            return MAPPER.readTree(raw.toString());
        } catch (Exception parseFailure) {
            throw new IllegalStateException("测试 bundle 构造失败", parseFailure);
        }
    }

    @Test
    @DisplayName("导入:新定义按 (appId,agentType) 不存在 → insert + definition-imported 审计")
    void importCreatesNewDefinition() {
        JsonNode bundle = bundleOf(validNewEntry("fresh_agent"));
        when(definitionMapper.selectByAppAndKey(1, "fresh_agent")).thenReturn(null);

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.created()).isEqualTo(1);
        assertThat(result.updated()).isZero();
        assertThat(result.skipped()).isZero();
        assertThat(result.errors()).isEmpty();
        ArgumentCaptor<AgentDefinition> inserted =
                ArgumentCaptor.forClass(AgentDefinition.class);
        verify(definitionMapper).insert(inserted.capture());
        assertThat(inserted.getValue().getAppId()).isEqualTo(1L);
        assertThat(inserted.getValue().getAgentKey()).isEqualTo("fresh_agent");
        assertThat(inserted.getValue().getKind()).isEqualTo("sub");
        assertThat(inserted.getValue().getEnabled()).isFalse();
        assertThat(inserted.getValue().getSystemPrompt()).isEqualTo("导入系统提示词");
        assertThat(inserted.getValue().getInstructionTemplate()).isNull();
        assertThat(inserted.getValue().getGreeting()).isEqualTo("你好");
        assertThat(inserted.getValue().getToolWhitelistJson()).isEqualTo("[\"get_current_time\"]");
        verify(auditService).append(any());
    }

    @Test
    @DisplayName("导入冲突 skip:现库保留计 skipped,不写不审")
    void importConflictSkipLeavesExisting() {
        JsonNode bundle = bundleOf(validNewEntry("demo"));
        when(definitionMapper.selectByAppAndKey(1, "demo"))
                .thenReturn(row(7L, "demo", "main"));

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.created()).isZero();
        assertThat(result.updated()).isZero();
        verify(definitionMapper, never()).insert(any(AgentDefinition.class));
        verify(definitionMapper, never()).updateById(any(AgentDefinition.class));
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("导入冲突 overwrite:出现字段覆盖、未出现槽位保持现值 + definition-updated 审计")
    void importConflictOverwriteMergesFields() {
        JsonNode bundle = bundleOf(validNewEntry("demo"));
        AgentDefinition existing = row(7L, "demo", "main");
        existing.setContextTemplateJson("{\"keep\":true}");
        when(definitionMapper.selectByAppAndKey(1, "demo")).thenReturn(existing);

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "overwrite", false);

        assertThat(result.updated()).isEqualTo(1);
        verify(definitionMapper).updateById(existing);
        assertThat(existing.getTitle()).isEqualTo("导入定义");
        assertThat(existing.getKind()).isEqualTo("sub");
        assertThat(existing.getEnabled()).isFalse();
        assertThat(existing.getSystemPrompt()).isEqualTo("导入系统提示词");
        // 未出现的槽位/规格字段保持现值
        assertThat(existing.getInstructionTemplate()).isEqualTo("旧指令模板");
        assertThat(existing.getContextTemplateJson()).isEqualTo("{\"keep\":true}");
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("definition-updated");
        assertThat(audit.getValue().decisionSource()).isEqualTo("admin");
    }

    @Test
    @DisplayName("导入 dryRun:全量预演计数,零写零审计")
    void importDryRunHasZeroSideEffects() {
        JsonNode bundle = bundleOf(validNewEntry("fresh_agent"), validNewEntry("demo"));
        when(definitionMapper.selectByAppAndKey(1, "fresh_agent")).thenReturn(null);
        when(definitionMapper.selectByAppAndKey(1, "demo")).thenReturn(row(7L, "demo", "main"));

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "overwrite", true);

        assertThat(result.dryRun()).isTrue();
        assertThat(result.created()).isEqualTo(1);
        assertThat(result.updated()).isEqualTo(1);
        verify(definitionMapper, never()).insert(any(AgentDefinition.class));
        verify(definitionMapper, never()).updateById(any(AgentDefinition.class));
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("导入 bundle 级非法:schemaVersion 不符/definitions 非数组/缺 bundle → 400")
    void importRejectsInvalidBundleShape() {
        assertThatThrownBy(() -> service.importBundle(1,
                MAPPER.readTree("{\"schemaVersion\":2,\"definitions\":[]}"), "skip", false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("schemaVersion");
        assertThatThrownBy(() -> service.importBundle(1,
                MAPPER.readTree("{\"schemaVersion\":1}"), "skip", false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("definitions");
        assertThatThrownBy(() -> service.importBundle(1, null, "skip", false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("bundle 不能为空");
        assertThatThrownBy(() -> service.importBundle(1,
                MAPPER.readTree("{\"schemaVersion\":1,\"definitions\":[]}"), "upsert", false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("conflictPolicy");
    }

    @Test
    @DisplayName("导入条目级非法:逐条进 errors[](不占 skipped),其余条目照常导入")
    void importCollectsPerEntryErrors() {
        String missingAgentType = "{\"name\":\"无标识\"}";
        String unknownSlot = """
                {"agentType":"bad_slot","name":"坏槽位","prompts":[{"slot":"brain","content":"x"}]}
                """;
        String specNotObject = """
                {"agentType":"bad_spec","name":"坏规格","specJson":"not-an-object"}
                """;
        String missingSystemPrompt = """
                {"agentType":"no_prompt","name":"无提示词","prompts":[{"slot":"greeting","content":"hi"}]}
                """;
        JsonNode bundle = bundleOf(
                missingAgentType, unknownSlot, specNotObject, missingSystemPrompt,
                validNewEntry("fresh_agent"));
        when(definitionMapper.selectByAppAndKey(anyLong(), anyString())).thenReturn(null);

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.errors()).hasSize(4);
        assertThat(result.errors().stream().map(AgentDefinitionBundle.ImportError::agentType))
                .containsExactly((String) null, "bad_slot", "bad_spec", "no_prompt");
        assertThat(result.created()).isEqualTo(1);
        assertThat(result.skipped()).isZero();
        verify(definitionMapper).insert(any(AgentDefinition.class));
    }

    @Test
    @DisplayName("conflictPolicy 缺省 = skip(不传时冲突保留现库)")
    void importDefaultsToSkipPolicy() {
        JsonNode bundle = bundleOf(validNewEntry("demo"));
        when(definitionMapper.selectByAppAndKey(1, "demo")).thenReturn(row(7L, "demo", "main"));

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, null, false);

        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.updated()).isZero();
    }

    // ------------------------------------------------------------------
    // P4-W14 kind=sub 定义全链:kind 过滤 + 引用条目校验 + 引用环检测
    // ------------------------------------------------------------------

    @Test
    @DisplayName("分页 kind 过滤:kind=sub 仅出子定义;非法 kind 400;缺省不过滤")
    void pageFiltersByKindWhenRequested() {
        when(definitionMapper.selectPage(any(), any())).thenAnswer(invocation -> {
            Page<AgentDefinition> page = invocation.getArgument(0);
            page.setRecords(List.of());
            page.setTotal(0);
            return page;
        });

        service.page(1, 1, 10, "sub");
        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>>
            captor = ArgumentCaptor.forClass(wrapperType());
        verify(definitionMapper).selectPage(any(), captor.capture());
        assertThat(captor.getValue().getSqlSegment()).contains("kind");

        service.page(1, 1, 10, null);
        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>>
            unfiltered = ArgumentCaptor.forClass(wrapperType());
        verify(definitionMapper, Mockito.times(2)).selectPage(any(), unfiltered.capture());
        assertThat(unfiltered.getAllValues().get(1).getSqlSegment())
                .doesNotContain("kind");

        assertThatThrownBy(() -> service.page(1, 1, 10, "workflow"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("kind");
    }

    private static String entryWithRefs(String agentType, String kind, String refsJson) {
        return """
                {
                  "agentType": "%s",
                  "name": "定义-%s",
                  "specJson": {
                    "kind": "%s",
                    "subAgentTools": %s
                  },
                  "prompts": [{"slot": "systemPrompt", "content": "提示词-%s"}]
                }
                """.formatted(agentType, agentType, kind, refsJson, agentType);
    }

    @Test
    @DisplayName("引用环检测(环全在 bundle 内):A→B→A 双双记 errors[],零落库")
    void importRejectsReferenceCycleInsideBundle() {
        JsonNode bundle = bundleOf(
                entryWithRefs("agent_a", "main",
                        "[{\"toolName\":\"run_b\",\"refAgentType\":\"agent_b\"}]"),
                entryWithRefs("agent_b", "sub",
                        "[{\"toolName\":\"run_a\",\"refAgentType\":\"agent_a\"}]"));
        when(definitionMapper.selectByAppAndKey(anyLong(), anyString())).thenReturn(null);
        when(definitionMapper.selectList(any())).thenReturn(List.of());

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.created()).isZero();
        assertThat(result.errors())
                .extracting(AgentDefinitionBundle.ImportError::agentType)
                .containsExactlyInAnyOrder("agent_a", "agent_b");
        assertThat(result.errors().getFirst().reason()).contains("引用环");
        verify(definitionMapper, never()).insert(any(AgentDefinition.class));
    }

    @Test
    @DisplayName("引用环检测(环跨 DB 与 bundle):DB 行 B→A,导入 A→B 记 errors[]")
    void importRejectsCycleSpanningDatabaseAndBundle() throws Exception {
        JsonNode bundle = bundleOf(
                entryWithRefs("agent_a", "main",
                        "[{\"toolName\":\"run_b\",\"refAgentType\":\"agent_b\"}]"));
        when(definitionMapper.selectByAppAndKey(1, "agent_a")).thenReturn(null);
        AgentDefinition dbRow = row(9L, "agent_b", "sub");
        dbRow.setSubAgentToolsJson(
                "[{\"toolName\":\"run_a\",\"refAgentType\":\"agent_a\"}]");
        when(definitionMapper.selectList(any())).thenReturn(List.of(dbRow));

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.created()).isZero();
        assertThat(result.errors())
                .extracting(AgentDefinitionBundle.ImportError::agentType)
                .containsExactly("agent_a");
        assertThat(result.errors().getFirst().reason()).contains("引用环");
        verify(definitionMapper, never()).insert(any(AgentDefinition.class));
    }

    @Test
    @DisplayName("无环嵌套链放行:main→sub 同 bundle 双建;自引用判环")
    void importAcceptsAcyclicChainButRejectsSelfReference() throws Exception {
        JsonNode chain = bundleOf(
                entryWithRefs("agent_parent", "main",
                        "[{\"toolName\":\"run_child\",\"refAgentType\":\"agent_child\"}]"),
                entryWithRefs("agent_child", "sub", "null"));
        when(definitionMapper.selectByAppAndKey(anyLong(), anyString())).thenReturn(null);
        when(definitionMapper.selectList(any())).thenReturn(List.of());

        AgentDefinitionBundle.ImportResult chainResult =
                service.importBundle(1, chain, "skip", false);
        assertThat(chainResult.created()).isEqualTo(2);
        assertThat(chainResult.errors()).isEmpty();

        JsonNode selfReference = bundleOf(
                entryWithRefs("agent_self", "main",
                        "[{\"toolName\":\"run_self\",\"refAgentType\":\"agent_self\"}]"));
        AgentDefinitionBundle.ImportResult selfResult =
                service.importBundle(1, selfReference, "skip", false);
        assertThat(selfResult.created()).isZero();
        assertThat(selfResult.errors()).hasSize(1);
        assertThat(selfResult.errors().getFirst().reason()).contains("引用环");
    }

    @Test
    @DisplayName("subAgentTools 条目校验:缺 toolName/refAgentType/非对象 → 条目级 errors[]")
    void importValidatesSubAgentToolEntries() {
        JsonNode bundle = bundleOf(
                entryWithRefs("bad_ref", "main", "[{\"toolName\":\"run_x\"}]"),
                entryWithRefs("bad_tool", "main", "[{\"refAgentType\":\"someone\"}]"),
                entryWithRefs("bad_shape", "main", "[\"not-an-object\"]"),
                entryWithRefs("good_agent", "sub", "null"));
        when(definitionMapper.selectByAppAndKey(anyLong(), anyString())).thenReturn(null);
        when(definitionMapper.selectList(any())).thenReturn(List.of());

        AgentDefinitionBundle.ImportResult result =
                service.importBundle(1, bundle, "skip", false);

        assertThat(result.errors())
                .extracting(AgentDefinitionBundle.ImportError::agentType)
                .containsExactlyInAnyOrder("bad_ref", "bad_tool", "bad_shape");
        assertThat(result.created()).isEqualTo(1);
        verify(definitionMapper).insert(any(AgentDefinition.class));
    }

    @SuppressWarnings("unchecked")
    private static Class<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>> wrapperType() {
        return (Class<com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<AgentDefinition>>)
                (Class<?>) com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper.class;
    }
}
