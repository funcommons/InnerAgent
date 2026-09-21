package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.model.entity.AiModel;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.agent.tool.AiToolConfigService;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.kernel.AgentScopeModelFactory;
import com.inneragent.agent.context.ProjectContext;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentKernelSpecFactoryTests {

    private static final Pattern UNRESOLVED = Pattern.compile("\\{[A-Za-z][A-Za-z0-9]*}");

    private AiAgentRegistry registry;
    private AgentKernelSpecFactory factory;
    private AiModel model;
    private AgentScopeMcpRegistry mcp;

    @BeforeEach
    void setUp() {
        registry = new AiAgentRegistry();
        AiAgentService agents = new AiAgentService(registry);
        AiToolConfigService tools = new AiToolConfigService(List.of(), agents);
        AgentScopeModelFactory models = mock(AgentScopeModelFactory.class);
        model = AiModel.builder()
                .id(9L)
                .name("test-model")
                .code("test-model")
                .modelProtocol("openai")
                .status(1)
                .config("{}")
                .build();
        when(models.modelConfigFingerprint(model)).thenReturn("a".repeat(64));
        mcp = mock(AgentScopeMcpRegistry.class);
        when(mcp.manifestsForAgent(anyString())).thenReturn(List.of());
        factory = new AgentKernelSpecFactory(
                agents,
                tools,
                models,
                new AgentScopeV2Properties(),
                new ObjectMapper(),
                mcp);
    }

    @Test
    void includesDiscoveredMcpToolsInTheImmutableRootKernel() {
        AgentKernelToolManifest manifest = new AgentKernelToolManifest(
                "search_assets",
                AgentKernelToolManifest.schemaSha256("{}"),
                true,
                false);
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY))
                .thenReturn(List.of(manifest));

        AgentKernelSpec spec = factory.createRoot(
                request(), model, "root prompt");

        assertThat(spec.toolWhitelist()).containsExactly("search_assets");
        assertThat(spec.toolManifest()).containsExactly(manifest);
        assertThat(spec.key().toolManifestFingerprint())
                .isEqualTo(AgentKernelKey.manifestFingerprint(List.of(manifest)));
    }

    @Test
    void userMcpKernelIsBoundToTheAuthenticatedUser() {
        AgentKernelToolManifest manifest = new AgentKernelToolManifest(
                "private_search",
                AgentKernelToolManifest.schemaSha256("{}"),
                true,
                false);
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY, 42L))
                .thenReturn(List.of(manifest));
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY, 43L))
                .thenReturn(List.of(manifest));

        AgentKernelSpec first = factory.createRoot(
                request(), model, "root prompt", 42L);
        AgentKernelSpec second = factory.createRoot(
                request(), model, "root prompt", 43L);

        assertThat(AgentKernelSpecFactory.ownerUserId(first)).isEqualTo(42L);
        assertThat(first.toolWhitelist()).containsExactly("private_search");
        assertThat(first.key()).isNotEqualTo(second.key());
    }

    @Test
    void changingUserMcpConfigurationRotatesTheKernelKey() {
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY, 42L))
                .thenReturn(List.of());
        when(mcp.userConfigurationFingerprint(42L))
                .thenReturn("a".repeat(64), "b".repeat(64));

        AgentKernelSpec first = factory.createRoot(
                request(), model, "root prompt", 42L);
        AgentKernelSpec second = factory.createRoot(
                request(), model, "root prompt", 42L);

        assertThat(first.key()).isNotEqualTo(second.key());
    }

    @Test
    void activeMcpReferencesFilterOnlyMcpTools() {
        AgentKernelToolManifest search = new AgentKernelToolManifest(
                "search_assets",
                AgentKernelToolManifest.schemaSha256("{}"),
                true,
                false);
        AgentKernelToolManifest inspect = new AgentKernelToolManifest(
                "inspect_media",
                AgentKernelToolManifest.schemaSha256("{}"),
                true,
                false);
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY))
                .thenReturn(List.of(search, inspect));

        AgentKernelSpec spec = factory.createRoot(
                request().setEnabledMcpTools(List.of("inspect_media")),
                model,
                "root prompt");

        assertThat(spec.toolWhitelist()).containsExactly("inspect_media");
        assertThat(spec.toolManifest()).containsExactly(inspect);
    }

    @Test
    void emptyMcpReferencesFallBackToDefaultVisibility() {
        // DEF-07:[] 与 null 同为「未指定」(SDK 空引用下发 [] 不再屏蔽注册工具)
        AgentKernelToolManifest search = new AgentKernelToolManifest(
                "search_assets",
                AgentKernelToolManifest.schemaSha256("{}"),
                true,
                false);
        when(mcp.manifestsForAgent(AgentKernelSpecFactory.DEFAULT_AGENT_KEY))
                .thenReturn(List.of(search));

        AgentKernelSpec spec = factory.createRoot(
                request().setEnabledMcpTools(List.of()),
                model,
                "root prompt");

        assertThat(spec.toolWhitelist()).containsExactly("search_assets");
        assertThat(spec.toolManifest()).containsExactly(search);
    }

    @Test
    void activeReferenceContextUsesSupportedPromptVariableNames() {        AiChatReqVO request = request().setContext(Map.of(
                "activeSkillReferences", "test-skill",
                "activeMcpReferences", "assets/search_assets"));

        AgentKernelSpec spec = factory.createRoot(request, model, "root prompt");

        assertThat(spec.promptVariables())
                .containsEntry("activeSkillReferences", "test-skill")
                .containsEntry("activeMcpReferences", "assets/search_assets");
    }

    @Test
    void inheritedRootVariablesRenderEveryConfiguredPlatformChildKernel() {
        AiChatReqVO request = request()
                .setProjectId(7L)
                .setContext(Map.of("scriptId", 41L, "storyboardId", 73L));

        assertChildrenRender(request, "script_full_parse",
                Map.of("scriptEpisodeId", 5L));
        assertChildrenRender(request, "story_to_script",
                Map.of("scriptEpisodeId", 6L));
        assertChildrenRender(request, "script_to_storyboard",
                Map.of(
                        "scriptEpisodeId", 7L,
                        "scriptEpisodeIds", "7,8"));
    }

    @Test
    void durableSnapshotRetainsVariablesNeededByFutureChildCalls() {
        AiChatReqVO request = request()
                .setAgentType("script_full_parse")
                .setProjectId(7L)
                .setContext(Map.of("scriptId", 41L));
        AgentKernelSpec root = factory.createRoot(request, model, "root prompt");

        var snapshot = new CanonicalAgentKernelSnapshotBuilder().build(root);

        assertThat(snapshot.payload().promptVariables())
                .containsEntry("projectId", "7")
                .containsEntry("scriptId", "41");
        assertThat(snapshot.snapshotJson()).contains("\"promptVariables\"");
    }

    @Test
    void capabilityPresetDoesNotReplaceMissingSnapshotProtocolIdentity() {
        AiChatReqVO request = requestForScript(41L)
                .setAgentType("script_full_parse");
        model.setModelProtocol(null);
        model.setCapabilityPresetCode("gpt-image-1");
        AgentKernelSpec spec = factory.createRoot(request, model, "root prompt");

        assertThatThrownBy(() -> new CanonicalAgentKernelSnapshotBuilder().build(spec))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("provider must not be blank");
    }

    @Test
    void scriptFullParseTemplateMatchesFrontendRequestWithoutScriptContent() {
        AiChatReqVO request = request()
                .setAgentType("script_full_parse")
                .setProjectId(7L)
                .setContext(Map.of("scriptId", 41L));
        AiAgentDefinition definition = registry.getByType("script_full_parse");
        Map<String, String> variables = AgentPromptVariables.fromRequest(request);

        String instruction = AgentPromptVariables.render(
                definition.getInstructionTemplate(), variables);
        String userMessage = AgentPromptVariables.render(
                definition.getDefaultUserMessage(), variables);

        assertThat(instruction)
                .contains("<project_id>7</project_id>")
                .contains("<script_id>41</script_id>")
                .doesNotContain("scriptContent");
        assertThat(userMessage).contains("项目 7", "ID: 41");
    }

    @Test
    void typedSubAgentPromptsDoNotRequireNaturalLanguageIdParsing() {
        for (String parentType : List.of(
                "script_full_parse", "story_to_script", "script_to_storyboard")) {
            assertThat(registry.getByType(parentType).getSystemPrompt())
                    .as(parentType)
                    .doesNotContain("message 参数", "从 message", "message 中");
        }
        for (String childType : List.of(
                "episode_scene_writer", "episode_script_creator",
                "episode_storyboard_writer")) {
            assertThat(registry.getByType(childType).getSystemPrompt())
                    .as(childType)
                    .doesNotContain("message 参数", "从 message", "message 中");
        }
    }

    @Test
    void childOnlyPromptVariablesParticipateInHarnessCacheIdentity() {
        AiChatReqVO firstRequest = requestForScript(41L);
        AiChatReqVO secondRequest = requestForScript(42L);

        AgentKernelSpec first = factory.createRoot(firstRequest, model, "same root prompt");
        AgentKernelSpec second = factory.createRoot(secondRequest, model, "same root prompt");

        assertThat(first.systemPrompt()).isEqualTo(second.systemPrompt());
        assertThat(first.key()).isNotEqualTo(second.key());
        assertThat(first.key().promptVersion()).isNotEqualTo(second.key().promptVersion());
    }

    @Test
    void platformSubAgentToolsAreDeclaredConcurrencySafe() {
        AiChatReqVO request = requestForScript(41L)
                .setAgentType("script_full_parse");

        AgentKernelSpec spec = factory.createRoot(request, model, "root prompt");

        assertThat(spec.toolManifest())
                .filteredOn(manifest -> "episode_scene_writer".equals(
                        manifest.toolName()))
                .singleElement()
                .satisfies(manifest -> {
                    assertThat(manifest.readOnly()).isFalse();
                    assertThat(manifest.concurrencySafe()).isTrue();
                });
    }

    @Test
    void restoresPersistedToolsOnlyWhenTheLiveContractStillMatches() {
        ToolExecutor tool = mock(ToolExecutor.class);
        when(tool.getToolName()).thenReturn("read_script");
        when(tool.getParametersSchema()).thenReturn("""
                {"type":"object","properties":{"scriptId":{"type":"integer"}}}
                """);
        when(tool.isEnabled()).thenReturn(true);
        when(tool.isReadOnly()).thenReturn(true);
        when(tool.isConcurrencySafe()).thenReturn(true);
        AgentScopeModelFactory models = mock(AgentScopeModelFactory.class);
        when(models.modelConfigFingerprint(model)).thenReturn("a".repeat(64));
        AgentKernelSpecFactory toolFactory = new AgentKernelSpecFactory(
                new AiAgentService(registry),
                new AiToolConfigService(List.of(tool), new AiAgentService(registry)),
                models,
                new AgentScopeV2Properties(),
                new ObjectMapper(),
                mcp);
        AgentKernelSpec original = toolFactory.createRoot(
                request().setEnabledTools(List.of("read_script")),
                model,
                "root prompt");
        var payload = new CanonicalAgentKernelSnapshotBuilder().build(original).payload();

        AgentKernelSpec restored = toolFactory.restore(payload, model, "b".repeat(64));

        assertThat(restored.toolWhitelist()).containsExactly("read_script");
        assertThat(restored.toolManifest()).containsExactlyElementsOf(original.toolManifest());
        assertThat(restored.key().modelConfigFingerprint()).isEqualTo("b".repeat(64));

        when(tool.isReadOnly()).thenReturn(false);
        assertThatThrownBy(() -> toolFactory.restore(payload, model, "b".repeat(64)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Persisted AgentScope tool is unavailable: read_script");
    }

    private void assertChildrenRender(
            AiChatReqVO request,
            String parentType,
            Map<String, Object> allInputs) {
        request.setAgentType(parentType);
        AgentKernelSpec parent = factory.createRoot(request, model, "root prompt");
        AiAgentDefinition definition = registry.getByType(parentType);
        for (AiAgentDefinition.SubAgentToolDef childDefinition : definition.getSubAgentTools()) {
            Map<String, Object> input = childDefinition.getToolName()
                    .equals("storyboard_asset_preprocessor")
                    ? Map.of("scriptEpisodeIds", allInputs.get("scriptEpisodeIds"))
                    : Map.of("scriptEpisodeId", allInputs.get("scriptEpisodeId"));
            AgentKernelSpec child = factory.createChild(
                    parent, childDefinition, new ProjectContext(7L), input);

            assertThat(UNRESOLVED.matcher(child.systemPrompt()).find())
                    .as(childDefinition.getToolName())
                    .isFalse();
            assertThat(child.systemPrompt())
                    .contains("<project_id>7</project_id>")
                    .contains("<script_id>41</script_id>")
                    .doesNotContain("message 参数", "从 message", "message 中");
            assertThat(child.promptVariables())
                    .containsEntry("scriptId", "41")
                    .containsEntry("projectId", "7");
            if (childDefinition.getToolName().equals("episode_storyboard_writer")) {
                assertThat(child.systemPrompt())
                        .contains("<storyboard_id>73</storyboard_id>")
                        .contains("<script_episode_id>7</script_episode_id>");
            }
        }
    }

    private AiChatReqVO requestForScript(long scriptId) {
        return request()
                .setAgentType("script_full_parse")
                .setProjectId(7L)
                .setContext(Map.of("scriptId", scriptId));
    }

    private AiChatReqVO request() {
        return new AiChatReqVO()
                .setToolExecutionMode(ToolExecutionMode.DEFAULT.name());
    }

    // ------------------------------------------------------------------
    // [adapt] U1/D1:MCP 工具目录(ia_tool_registry 聚合)并入内核工具面
    // ------------------------------------------------------------------

    @Test
    void catalogToolsEnterTheKernelWhitelistByFqn() {
        AgentKernelSpecFactory catalogFactory = factoryWithCatalog(catalogWith(hostRegistryTool()));

        AgentKernelSpec spec = catalogFactory.createRoot(
                request(), model, "root prompt", 42L);

        assertThat(spec.toolWhitelist()).containsExactly("mcp__crm__list_users");
        AgentKernelToolManifest manifest = spec.toolManifest().getFirst();
        assertThat(manifest.toolName()).isEqualTo("mcp__crm__list_users");
        // 可信宿主 readOnlyHint 采信(V15)→ manifest 只读位
        assertThat(manifest.readOnly()).isTrue();
        assertThat(manifest.concurrencySafe()).isFalse();
        // manifest 哈希与 schema 规范化口径一致(注册时校验/快照 restore 同源)
        var schema = com.inneragent.agent.tool.AgentScopeToolSchema.prepare(
                new ObjectMapper(),
                "{\"type\":\"object\",\"properties\":{\"zone\":{\"type\":\"string\"}}}",
                "mcp__crm__list_users");
        assertThat(manifest.schemaSha256())
                .isEqualTo(AgentKernelToolManifest.schemaSha256(schema.canonicalJson()));
    }

    @Test
    void enabledMcpToolsResolvesCatalogPlainToolNameToFqn() {
        AgentKernelSpecFactory catalogFactory = factoryWithCatalog(catalogWith(hostRegistryTool()));

        AgentKernelSpec spec = catalogFactory.createRoot(
                request().setEnabledMcpTools(List.of("list_users")),
                model,
                "root prompt");

        assertThat(spec.toolWhitelist()).containsExactly("mcp__crm__list_users");
    }

    @Test
    void unavailableCatalogToolRequestFailsWithExplicitError() {
        AgentKernelSpecFactory catalogFactory = factoryWithCatalog(catalogWith(hostRegistryTool()));

        assertThatThrownBy(() -> catalogFactory.createRoot(
                request().setEnabledMcpTools(
                        List.of("mcp__demo-spring-host__create_host_record")),
                model,
                "root prompt"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Requested AgentScope MCP tools are unavailable")
                .hasMessageContaining("mcp__demo-spring-host__create_host_record");
    }

    @Test
    void disabledCatalogToolDoesNotEnterTheKernelWhitelist() {
        com.inneragent.platform.toolhub.ToolRegistryEntry disabled = hostRegistryTool();
        disabled.setEnabled(false);
        AgentKernelSpecFactory catalogFactory = factoryWithCatalog(catalogWith(disabled));

        // 未指定 enabledMcpTools(null)→ 默认可见性走注册目录;停用工具仍不可见
        AgentKernelSpec spec = catalogFactory.createRoot(
                request(), model, "root prompt", 42L);

        assertThat(spec.toolWhitelist()).isEmpty();
    }

    @Test
    void enabledMcpToolsThreeFormsNullEmptyAndExplicit() {
        // DEF-07 三分法:null / [] / [FQN] —— 仅非空数组是显式白名单
        AgentKernelSpecFactory catalogFactory = factoryWithCatalog(catalogWith(hostRegistryTool()));

        // null(字段未下发)→ 未指定 → 默认可见性(注册目录按策略)
        assertThat(catalogFactory.createRoot(request(), model, "root prompt", 42L)
                .toolWhitelist()).containsExactly("mcp__crm__list_users");
        // [](SDK 空引用下发)→ 同未指定 → 默认可见性(DEF-07 修复点)
        assertThat(catalogFactory.createRoot(
                        request().setEnabledMcpTools(List.of()), model, "root prompt", 42L)
                .toolWhitelist()).containsExactly("mcp__crm__list_users");
        // 非空数组 → 显式白名单
        assertThat(catalogFactory.createRoot(
                        request().setEnabledMcpTools(List.of("mcp__crm__list_users")),
                        model, "root prompt", 42L)
                .toolWhitelist()).containsExactly("mcp__crm__list_users");
    }

    // ------------------------------------------------------------------
    // [adapt] P4 数据驱动内核:DB 定义驱动的工具面收敛与子引用解析
    // ------------------------------------------------------------------

    @Test
    void dbDefinitionWhitelistConvergesTheRootToolFace() {
        ToolExecutor whitelisted = executor("read_script", true);
        ToolExecutor outsideFace = executor("delete_everything", false);
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentDefinition dbDriven = AiAgentDefinition.builder()
                .type("db-driven")
                .name("数据驱动定义")
                .systemPrompt("DB 人设")
                .instructionTemplate("DB 指令 <project_id>{projectId}</project_id>")
                .enableTools(1)
                .toolNames(List.of("read_script"))
                .subAgentTools(List.of())
                .build();
        AiAgentService agents = new AiAgentService(registry, (appId, agentKey) ->
                "db-driven".equals(agentKey) ? dbDriven : null);
        AgentKernelSpecFactory dbFactory = new AgentKernelSpecFactory(
                agents,
                new AiToolConfigService(List.of(whitelisted, outsideFace), agents),
                modelsMock(),
                new AgentScopeV2Properties(),
                new ObjectMapper(),
                mcp);

        AgentKernelSpec spec = dbFactory.createRoot(
                request().setAgentType("db-driven"), model, "ignored:定义人设优先组装");

        // 白名单收敛:声明面内的工具进内核,声明面外的执行器不进
        // (根人设/指令由 AgentScopePipelineRunService 按同源定义组装,IT 覆盖)
        assertThat(spec.toolWhitelist()).containsExactly("read_script");
    }

    @Test
    void dbSubAgentReferenceResolvesEvenWithoutCodeRegistryEntry() {
        ToolExecutor tool = executor("read_script", true);
        AiAgentRegistry registry = new AiAgentRegistry();
        AiAgentDefinition dbParent = AiAgentDefinition.builder()
                .type("db-parent")
                .name("数据驱动父定义")
                .systemPrompt("父人设")
                .enableTools(1)
                .toolNames(List.of("read_script"))
                .subAgentTools(List.of(AiAgentDefinition.SubAgentToolDef.builder()
                        .toolName("db_sub_tool")
                        .description("调起 DB 子定义")
                        .parametersSchema("{\"type\":\"object\"}")
                        .refAgentType("db-child")
                        .build()))
                .build();
        AiAgentDefinition dbChild = AiAgentDefinition.builder()
                .type("db-child")
                .name("数据驱动子定义")
                .systemPrompt("子人设(DB 独有,代码注册表无此类型)")
                .instructionTemplate("子指令")
                .enableTools(1)
                .toolNames(List.of("read_script"))
                .subAgentTools(List.of())
                .build();
        AiAgentService agents = new AiAgentService(registry, (appId, agentKey) ->
                "db-parent".equals(agentKey) ? dbParent
                        : "db-child".equals(agentKey) ? dbChild
                        : null);
        AgentKernelSpecFactory dbFactory = new AgentKernelSpecFactory(
                agents,
                new AiToolConfigService(List.of(tool), agents),
                modelsMock(),
                new AgentScopeV2Properties(),
                new ObjectMapper(),
                mcp);

        AgentKernelSpec parent = dbFactory.createRoot(
                request().setAgentType("db-parent"), model, "ignored");
        // 子工具面:sub 声明以工具形态进入父内核白名单(白名单为 Set,不保序)
        assertThat(parent.toolWhitelist()).containsExactlyInAnyOrder("read_script", "db_sub_tool");

        // 子引用解析:refAgentType 在代码注册表不存在,DB 定义命中即可组装
        AgentKernelSpec child = dbFactory.createChild(
                parent,
                dbParent.getSubAgentTools().getFirst(),
                new ProjectContext(7L),
                Map.of("message", "开始"));
        assertThat(child.systemPrompt()).contains("子人设(DB 独有");
        assertThat(child.toolWhitelist()).containsExactly("read_script");
    }

    private ToolExecutor executor(String toolName, boolean readOnly) {
        ToolExecutor tool = mock(ToolExecutor.class);
        when(tool.getToolName()).thenReturn(toolName);
        when(tool.getParametersSchema()).thenReturn("{\"type\":\"object\"}");
        when(tool.isEnabled()).thenReturn(true);
        when(tool.isReadOnly()).thenReturn(readOnly);
        when(tool.isConcurrencySafe()).thenReturn(true);
        return tool;
    }

    private AgentScopeModelFactory modelsMock() {
        AgentScopeModelFactory models = mock(AgentScopeModelFactory.class);
        when(models.modelConfigFingerprint(any(AiModel.class))).thenReturn("a".repeat(64));
        return models;
    }

    private AgentKernelSpecFactory factoryWithCatalog(
            com.inneragent.agent.mcp.McpToolCatalog catalog) {
        AgentScopeModelFactory models = mock(AgentScopeModelFactory.class);
        when(models.modelConfigFingerprint(model)).thenReturn("a".repeat(64));
        when(mcp.manifestsForAgent(anyString())).thenReturn(List.of());
        when(mcp.manifestsForAgent(anyString(), any())).thenReturn(List.of());
        return new AgentKernelSpecFactory(
                new AiAgentService(registry),
                new AiToolConfigService(List.of(), new AiAgentService(registry)),
                models,
                new AgentScopeV2Properties(),
                new ObjectMapper(),
                mcp,
                catalog);
    }

    private com.inneragent.agent.mcp.McpToolCatalog catalogWith(
            com.inneragent.platform.toolhub.ToolRegistryEntry entry) {
        com.inneragent.platform.toolhub.mapper.ToolRegistryMapper mapper = mock(
                com.inneragent.platform.toolhub.mapper.ToolRegistryMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of(entry));
        return new com.inneragent.agent.mcp.McpToolCatalog(
                mapper,
                mock(com.inneragent.platform.toolhub.ToolGrantService.class),
                new ObjectMapper());
    }

    private com.inneragent.platform.toolhub.ToolRegistryEntry hostRegistryTool() {
        com.inneragent.platform.toolhub.ToolRegistryEntry entry =
                new com.inneragent.platform.toolhub.ToolRegistryEntry();
        entry.setId(1L);
        // P2-srv U1:目录 load 显式按 app_id 过滤,fixture 须归属缺省应用 1
        entry.setAppId(1L);
        entry.setServerKey("crm");
        entry.setToolName("list_users");
        entry.setFqn("mcp__crm__list_users");
        entry.setDescription("查询客户");
        entry.setParametersSchema(
                "{\"type\":\"object\",\"properties\":{\"zone\":{\"type\":\"string\"}}}");
        entry.setAnnotationsJson("{\"readOnlyHint\":true}");
        entry.setRiskLevel("low");
        entry.setSource(com.inneragent.platform.toolhub.ToolRegistryService.SOURCE_HOST_APP);
        entry.setConcurrencySafe(false);
        entry.setEnabled(true);
        return entry;
    }
}
