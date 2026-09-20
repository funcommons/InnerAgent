package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.model.entity.AiModel;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.agent.tool.AiToolConfigService;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.kernel.AgentScopeModelFactory;
import com.inneragent.agent.context.ProjectContext;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.ToolManifestSnapshot;
import com.inneragent.platform.context.AppContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Creates immutable root and platform-child Harness kernel specifications.
 *
 * <p>[adapt] U1/D1:内核工具面的 MCP 来源在 yml 静态注册表
 * ({@link AgentScopeMcpRegistry})之外并入 MCP 工具目录
 * ({@link McpToolCatalog},ia_tool_registry 聚合视图):目录条目以 FQN
 * (mcp__{serverKey}__{toolName})进入白名单与 manifest,schema 经
 * {@link AgentScopeToolSchema} 规范化后取哈希——与注册时校验、内核快照
 * restore 锁定同一口径。enabledMcpTools 门控与可用性校验统一覆盖目录视图。
 */
@Component
public final class AgentKernelSpecFactory {

    public static final String DEFAULT_AGENT_KEY = "ai_assistant_agent";
    public static final String TOOL_WHITELIST_VERSION = "afv-tools-v2";
    public static final String OWNER_USER_ID_VARIABLE = "agentWorkspaceUserId";
    public static final String MCP_CONFIG_FINGERPRINT_VARIABLE = "agentMcpConfigFingerprint";
    public static final String TOOL_EXECUTION_MODE_VARIABLE = "agentToolExecutionMode";
    private final AiAgentService agentService;
    private final AiToolConfigService toolConfigService;
    private final AgentScopeModelFactory modelFactory;
    private final AgentScopeV2Properties properties;
    private final ObjectMapper objectMapper;
    private final AgentScopeMcpRegistry mcpRegistry;
    /** [adapt] U1/D1:目录视图(测试直构可空;可空时不并入目录工具)。 */
    private final McpToolCatalog mcpToolCatalog;

    @Autowired
    public AgentKernelSpecFactory(
            AiAgentService agentService,
            AiToolConfigService toolConfigService,
            AgentScopeModelFactory modelFactory,
            AgentScopeV2Properties properties,
            ObjectMapper objectMapper,
            AgentScopeMcpRegistry mcpRegistry,
            McpToolCatalog mcpToolCatalog) {
        this.agentService = Objects.requireNonNull(agentService, "agentService must not be null");
        this.toolConfigService = Objects.requireNonNull(
                toolConfigService, "toolConfigService must not be null");
        this.modelFactory = Objects.requireNonNull(modelFactory, "modelFactory must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.mcpRegistry = Objects.requireNonNull(mcpRegistry, "mcpRegistry must not be null");
        this.mcpToolCatalog = mcpToolCatalog;
    }

    public AgentKernelSpecFactory(
            AiAgentService agentService,
            AiToolConfigService toolConfigService,
            AgentScopeModelFactory modelFactory,
            AgentScopeV2Properties properties,
            ObjectMapper objectMapper) {
        this(
                agentService,
                toolConfigService,
                modelFactory,
                properties,
                objectMapper,
                new AgentScopeMcpRegistry(properties, objectMapper),
                null);
    }

    /** 目录缺省形态(无目录视图;仅 yml 静态 MCP)。 */
    public AgentKernelSpecFactory(
            AiAgentService agentService,
            AiToolConfigService toolConfigService,
            AgentScopeModelFactory modelFactory,
            AgentScopeV2Properties properties,
            ObjectMapper objectMapper,
            AgentScopeMcpRegistry mcpRegistry) {
        this(
                agentService,
                toolConfigService,
                modelFactory,
                properties,
                objectMapper,
                mcpRegistry,
                null);
    }

    public AgentKernelSpec createRoot(AiChatReqVO request, AiModel model, String systemPrompt) {
        return createRoot(request, model, systemPrompt, null);
    }

    public AgentKernelSpec createRoot(
            AiChatReqVO request,
            AiModel model,
            String systemPrompt,
            Long ownerUserId) {
        Objects.requireNonNull(request, "request must not be null");
        String requestedType = normalize(request.getAgentType());
        String definitionKey = requestedType == null ? DEFAULT_AGENT_KEY : requestedType;
        AiAgentDefinition definition = requestedType == null
                ? null
                : agentService.getRequiredByType(requestedType);
        String agentName = definition == null
                ? DEFAULT_AGENT_KEY
                : requireText(definition.getName(), "agent.name");
        ToolSelection tools = selectTools(
                requestedType,
                request.getEnabledTools(),
                request.getEnabledMcpTools(),
                ownerUserId);
        Map<String, String> promptVariables = new LinkedHashMap<>(
                AgentPromptVariables.fromRequest(request));
        promptVariables.put(
                TOOL_EXECUTION_MODE_VARIABLE,
                ToolExecutionMode.parse(request.getToolExecutionMode()).name());
        if (ownerUserId != null) {
            promptVariables.put(OWNER_USER_ID_VARIABLE, String.valueOf(ownerUserId));
            String mcpFingerprint = mcpRegistry.userConfigurationFingerprint(ownerUserId);
            if (mcpFingerprint != null && !mcpFingerprint.isBlank()) {
                promptVariables.put(MCP_CONFIG_FINGERPRINT_VARIABLE, mcpFingerprint);
            }
        }
        return create(
                model,
                definitionKey,
                agentName,
                "AgentScope Harness kernel for " + agentName,
                systemPrompt,
                promptVariables,
                tools,
                modelFactory.modelConfigFingerprint(model));
    }

    public AgentKernelSpec createChild(
            AgentKernelSpec parent,
            AiAgentDefinition.SubAgentToolDef subAgent,
            ProjectContext project,
            Map<String, Object> input) {
        Objects.requireNonNull(parent, "parent must not be null");
        Objects.requireNonNull(subAgent, "subAgent must not be null");
        String childType = requireText(subAgent.getRefAgentType(), "subAgent.refAgentType");
        AiAgentDefinition definition = agentService.getRequiredByType(childType);
        String prompt = normalize(subAgent.getSystemPromptOverride());
        if (prompt == null) {
            prompt = requireText(definition.getSystemPrompt(), "subAgent.systemPrompt");
        }
        String instruction = normalize(subAgent.getInstructionOverride());
        if (instruction == null) {
            instruction = normalize(definition.getInstructionTemplate());
        }
        Map<String, String> variables = AgentPromptVariables.forChild(
                parent.promptVariables(), project, input);
        prompt = AgentPromptVariables.render(prompt, variables);
        if (instruction != null) {
            prompt = prompt + "\n\n" + AgentPromptVariables.render(instruction, variables);
        }
        ToolSelection tools = selectTools(childType, null, null, ownerUserId(parent));
        String agentName = normalize(subAgent.getToolName());
        if (agentName == null) {
            agentName = requireText(definition.getName(), "subAgent.name");
        }
        return create(
                parent.model(),
                childType,
                agentName,
                requireText(subAgent.getDescription(), "subAgent.description"),
                prompt,
                variables,
                tools,
                parent.key().modelConfigFingerprint());
    }

    /** Rebuilds the exact persisted whitelist after verifying every live tool contract. */
    public AgentKernelSpec restore(
            AgentKernelSnapshotPayload payload,
            AiModel model,
            String modelFingerprint) {
        Objects.requireNonNull(payload, "payload must not be null");
        Objects.requireNonNull(model, "model must not be null");
        String definitionKey = payload.agentDefinitionStableKey();
        String agentType = DEFAULT_AGENT_KEY.equals(definitionKey) ? null : definitionKey;
        Long ownerUserId = ownerUserId(payload.promptVariables());
        ToolSelection available = selectTools(agentType, null, null, ownerUserId);
        Map<String, AgentKernelToolManifest> availableByName = new LinkedHashMap<>();
        for (AgentKernelToolManifest tool : available.manifest()) {
            availableByName.put(tool.toolName(), tool);
        }
        List<AgentKernelToolManifest> restoredManifest = new ArrayList<>();
        Set<String> restoredWhitelist = new LinkedHashSet<>();
        for (ToolManifestSnapshot persisted : payload.tools()) {
            AgentKernelToolManifest live = availableByName.get(persisted.name());
            if (live == null
                    || !persisted.schemaSha256().equals(live.schemaSha256())
                    || persisted.readOnly() != live.readOnly()
                    || persisted.concurrencySafe() != live.concurrencySafe()
                    || !TOOL_WHITELIST_VERSION.equals(persisted.implementationVersion())) {
                throw new IllegalStateException(
                        "Persisted AgentScope tool is unavailable: " + persisted.name());
            }
            restoredManifest.add(live);
            restoredWhitelist.add(live.toolName());
        }
        AgentKernelKey key = AgentKernelKey.create(
                definitionKey,
                modelFingerprint,
                AgentKernelKey.promptVersion(
                        payload.systemPrompt(), payload.promptVariables()),
                restoredManifest,
                TOOL_WHITELIST_VERSION);
        return new AgentKernelSpec(
                key,
                model,
                definitionKey,
                payload.agentName(),
                payload.description(),
                payload.systemPrompt(),
                payload.promptVariables(),
                payload.maxIters(),
                restoredManifest,
                restoredWhitelist,
                TOOL_WHITELIST_VERSION);
    }

    private AgentKernelSpec create(
            AiModel model,
            String definitionKey,
            String agentName,
            String description,
            String systemPrompt,
            Map<String, String> promptVariables,
            ToolSelection tools,
            String modelFingerprint) {
        String safePrompt = requireText(systemPrompt, "systemPrompt");
        AgentKernelKey key = AgentKernelKey.create(
                definitionKey,
                modelFingerprint,
                AgentKernelKey.promptVersion(safePrompt, promptVariables),
                tools.manifest(),
                TOOL_WHITELIST_VERSION);
        return new AgentKernelSpec(
                key,
                model,
                definitionKey,
                agentName,
                description,
                safePrompt,
                promptVariables,
                properties.getExecution().getMaxIters(),
                tools.manifest(),
                tools.whitelist(),
                TOOL_WHITELIST_VERSION);
    }

    private ToolSelection selectTools(
            String agentType,
            List<String> requestedTools,
            List<String> requestedMcpTools,
            Long ownerUserId) {
        Set<String> requested = requestedTools == null || requestedTools.isEmpty()
                ? null
                : Set.copyOf(requestedTools);
        Set<String> requestedMcp = requestedMcpTools == null
                ? null
                : Set.copyOf(requestedMcpTools);
        AiAgentDefinition definition = agentType == null ? null : agentService.getRequiredByType(agentType);
        if (definition != null && !Integer.valueOf(1).equals(definition.getEnableTools())) {
            if (requested != null || requestedMcp != null) {
                throw new IllegalArgumentException("Agent does not enable the requested tools");
            }
            return ToolSelection.empty();
        }
        List<AgentKernelToolManifest> manifest = new ArrayList<>();
        Set<String> whitelist = new LinkedHashSet<>();
        List<ToolExecutor> directTools = agentType == null
                ? toolConfigService.getEnabledTools()
                : toolConfigService.getEnabledToolsByAgent(agentType);
        for (ToolExecutor tool : directTools) {
            if (requested != null && !requested.contains(tool.getToolName())) {
                continue;
            }
            AgentScopeToolSchema.PreparedSchema schema = AgentScopeToolSchema.prepare(
                    objectMapper, tool.getParametersSchema(), tool.getToolName());
            add(manifest, whitelist, new AgentKernelToolManifest(
                    tool.getToolName(),
                    AgentKernelToolManifest.schemaSha256(schema.canonicalJson()),
                    tool.isReadOnly(),
                    tool.isConcurrencySafe()));
        }
        List<AiAgentDefinition.SubAgentToolDef> subAgents = agentType == null
                ? List.of()
                : toolConfigService.getSubAgentTools(agentType);
        for (AiAgentDefinition.SubAgentToolDef subAgent : subAgents) {
            if (requested != null && !requested.contains(subAgent.getToolName())) {
                continue;
            }
            AgentScopeToolSchema.PreparedSchema schema = AgentScopeToolSchema.prepareSubAgent(
                    objectMapper, subAgent.getParametersSchema(), subAgent.getToolName());
            add(manifest, whitelist, new AgentKernelToolManifest(
                    subAgent.getToolName(),
                    AgentKernelToolManifest.schemaSha256(schema.canonicalJson()),
                    false,
                    true));
        }
        if (requested != null && !whitelist.equals(requested)) {
            Set<String> unavailable = new LinkedHashSet<>(requested);
            unavailable.removeAll(whitelist);
            throw new IllegalArgumentException(
                    "Requested AgentScope tools are unavailable: " + unavailable);
        }
        String definitionKey = agentType == null ? DEFAULT_AGENT_KEY : agentType;
        // [adapt] U1/D1:yml 静态 MCP(AgentScopeMcpRegistry)与目录 MCP
        // (McpToolCatalog)并集为内核可用 MCP 工具面;目录条目以 FQN 命名。
        List<AgentKernelToolManifest> availableMcpTools = new ArrayList<>(ownerUserId == null
                ? mcpRegistry.manifestsForAgent(definitionKey)
                : mcpRegistry.manifestsForAgent(definitionKey, ownerUserId));
        List<McpToolCatalogEntry> catalogEntries = catalogEntries(ownerUserId);
        for (McpToolCatalogEntry entry : catalogEntries) {
            AgentKernelToolManifest catalogManifest = catalogManifest(entry);
            if (availableMcpTools.stream().noneMatch(known ->
                    known.toolName().equals(catalogManifest.toolName()))) {
                availableMcpTools.add(catalogManifest);
            }
        }
        // enabledMcpTools 门控:FQN 与目录工具名都可指名(统一解析为白名单名)
        Set<String> requestedMcpResolved = requestedMcp == null
                ? null
                : resolveRequestedMcpTools(requestedMcp, availableMcpTools, catalogEntries);
        for (AgentKernelToolManifest mcpTool : availableMcpTools) {
            if (requestedMcpResolved == null || requestedMcpResolved.contains(mcpTool.toolName())) {
                add(manifest, whitelist, mcpTool);
            }
        }
        return new ToolSelection(manifest, whitelist);
    }

    /**
     * [adapt] U1/D1:目录视图(ia_tool_registry 聚合;userId 缺省全量,
     * 有用户时叠加 catalogForUser 的 granted 标注——确认策略消费链路见
     * AgentToolPermissionPolicy,与本工厂通过 FQN 命名衔接)。
     */
    private List<McpToolCatalogEntry> catalogEntries(Long ownerUserId) {
        if (mcpToolCatalog == null) {
            return List.of();
        }
        long appId = AppContext.currentOrDefault();
        return ownerUserId == null
                ? mcpToolCatalog.catalog(appId)
                : mcpToolCatalog.catalogForUser(appId, ownerUserId);
    }

    /** 目录条目 → 内核 manifest:schema 规范化哈希 + 目录治理位(只读/并发安全)。 */
    private AgentKernelToolManifest catalogManifest(McpToolCatalogEntry entry) {
        String schemaJson = entry.parametersSchemaJson() == null
                || entry.parametersSchemaJson().isBlank()
                ? "{\"type\":\"object\"}"
                : entry.parametersSchemaJson();
        AgentScopeToolSchema.PreparedSchema schema = AgentScopeToolSchema.prepare(
                objectMapper, schemaJson, entry.fqn());
        return new AgentKernelToolManifest(
                entry.fqn(),
                AgentKernelToolManifest.schemaSha256(schema.canonicalJson()),
                entry.readOnlyEffective(),
                entry.concurrencySafe());
    }

    /**
     * enabledMcpTools 解析:请求名允许是白名单名(FQN)或目录工具名;无法解析
     * 即「Requested AgentScope MCP tools are unavailable」(保持 4xx 明确错误语义)。
     */
    private Set<String> resolveRequestedMcpTools(
            Set<String> requestedMcp,
            List<AgentKernelToolManifest> availableMcpTools,
            List<McpToolCatalogEntry> catalogEntries) {
        Set<String> availableNames = new LinkedHashSet<>();
        availableMcpTools.forEach(tool -> availableNames.add(tool.toolName()));
        Map<String, String> toolNameAliases = new LinkedHashMap<>();
        for (McpToolCatalogEntry entry : catalogEntries) {
            toolNameAliases.put(entry.toolName().toLowerCase(Locale.ROOT), entry.fqn());
        }
        Set<String> resolved = new LinkedHashSet<>();
        Set<String> unavailable = new LinkedHashSet<>();
        for (String requested : requestedMcp) {
            if (availableNames.contains(requested)) {
                resolved.add(requested);
                continue;
            }
            String canonical = toolNameAliases.get(requested.toLowerCase(Locale.ROOT));
            if (canonical != null && availableNames.contains(canonical)) {
                resolved.add(canonical);
            } else {
                unavailable.add(requested);
            }
        }
        if (!unavailable.isEmpty()) {
            throw new IllegalArgumentException(
                    "Requested AgentScope MCP tools are unavailable: " + unavailable);
        }
        return resolved;
    }

    private void add(
            List<AgentKernelToolManifest> manifest,
            Set<String> whitelist,
            AgentKernelToolManifest entry) {
        if (!whitelist.add(entry.toolName())) {
            throw new IllegalArgumentException("Duplicate AgentScope tool name: " + entry.toolName());
        }
        manifest.add(entry);
    }

    private static String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    public static Long ownerUserId(AgentKernelSpec spec) {
        return ownerUserId(spec.promptVariables());
    }

    private static Long ownerUserId(Map<String, String> promptVariables) {
        String value = promptVariables.get(OWNER_USER_ID_VARIABLE);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(value);
        } catch (NumberFormatException failure) {
            throw new IllegalArgumentException("Invalid AgentScope kernel owner user id", failure);
        }
    }

    private static String requireText(String value, String field) {
        String normalized = normalize(value);
        if (normalized == null) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return normalized;
    }

    private record ToolSelection(
            List<AgentKernelToolManifest> manifest,
            Set<String> whitelist) {
        private ToolSelection {
            manifest = List.copyOf(manifest);
            whitelist = Set.copyOf(whitelist);
        }

        private static ToolSelection empty() {
            return new ToolSelection(List.of(), Set.of());
        }
    }
}
