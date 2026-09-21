package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.agent.tool.AiToolConfigService;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.tool.ToolExecutorRegistry;
import com.inneragent.agent.kernel.AgentScopeSubAgentToolAdapter;
import com.inneragent.agent.kernel.AgentScopeToolAdapter;
import com.inneragent.agent.mcp.AgentScopeMcpRegistry;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.tool.PlatformSubAgentRunPort;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.context.AppContext;
import io.agentscope.core.tool.AgentTool;
import io.agentscope.core.tool.ToolBase;
import io.agentscope.core.tool.Toolkit;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Registers only the immutable tool whitelist captured by an AgentScope Harness kernel.
 *
 * <p>[adapt] U1/D1:白名单中来自 MCP 工具目录的条目(目录 FQN)由
 * {@link AgentScopeMcpToolAdapter} 装配为 AgentScope 工具,执行经
 * {@code McpToolInvoker} 宿主桥;契约(schema 哈希/只读/并发安全)与
 * spec manifest 校验一致,快照 restore 锁定不漂移。
 */
@Component
public final class PlatformAgentKernelToolRegistry implements AgentKernelToolRegistry {

    private final ToolExecutorRegistry executors;
    private final AiToolConfigService toolConfigService;
    private final AiAgentService agentService;
    private final AgentKernelSpecFactory specFactory;
    private final ObjectProvider<PlatformSubAgentRunPort> childRuns;
    private final AgentRuntimeSchedulers schedulers;
    private final RunLeaseGuard leaseGuard;
    private final ObjectMapper objectMapper;
    private final AgentScopeMcpRegistry mcpRegistry;
    private final ObjectProvider<ActTokenSupplier> actTokenSuppliers;
    // [adapt] P1-T2a:MCP 工具调用端口(T2b 接管点)。缺省 UnavailableMcpToolInvoker
    // (调用即抛,T2b 声明真实 Bean 后 @ConditionalOnMissingBean 让位),
    // 经注册链路下发到各工具适配器;未接管时内核行为与现状完全一致。
    private final ObjectProvider<com.inneragent.agent.mcp.McpToolInvoker> mcpToolInvokers;
    // [adapt] U1/D1:MCP 工具目录(白名单中目录 FQN 条目的装配与契约校验来源)。
    private final McpToolCatalog mcpToolCatalog;
    // [adapt] 任务 #18b(W5):GenAI span 工厂(execute_tool/MCP 挂点;缺省 noop)。
    private final ObjectProvider<com.inneragent.agent.observability.GenAiSpanFactory> spanFactories;
    // [adapt] IA-2 业务计数(工具终态 ia_tool_calls_total;缺省 noop,P4 差距收口)。
    private final ObjectProvider<com.inneragent.platform.metrics.IaBusinessMetrics> businessMetrics;

    public PlatformAgentKernelToolRegistry(
            ToolExecutorRegistry executors,
            AiToolConfigService toolConfigService,
            AiAgentService agentService,
            AgentKernelSpecFactory specFactory,
            ObjectProvider<PlatformSubAgentRunPort> childRuns,
            AgentRuntimeSchedulers schedulers,
            RunLeaseGuard leaseGuard,
            ObjectMapper objectMapper,
            AgentScopeMcpRegistry mcpRegistry,
            ObjectProvider<ActTokenSupplier> actTokenSuppliers,
            ObjectProvider<com.inneragent.agent.mcp.McpToolInvoker> mcpToolInvokers,
            McpToolCatalog mcpToolCatalog,
            ObjectProvider<com.inneragent.agent.observability.GenAiSpanFactory> spanFactories,
            ObjectProvider<com.inneragent.platform.metrics.IaBusinessMetrics> businessMetrics) {
        this.executors = Objects.requireNonNull(executors, "executors must not be null");
        this.toolConfigService = Objects.requireNonNull(
                toolConfigService, "toolConfigService must not be null");
        this.agentService = Objects.requireNonNull(agentService, "agentService must not be null");
        this.specFactory = Objects.requireNonNull(specFactory, "specFactory must not be null");
        this.childRuns = Objects.requireNonNull(childRuns, "childRuns must not be null");
        this.schedulers = Objects.requireNonNull(schedulers, "schedulers must not be null");
        this.leaseGuard = Objects.requireNonNull(leaseGuard, "leaseGuard must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.mcpRegistry = Objects.requireNonNull(mcpRegistry, "mcpRegistry must not be null");
        this.actTokenSuppliers = Objects.requireNonNull(
                actTokenSuppliers, "actTokenSuppliers must not be null");
        this.mcpToolInvokers = Objects.requireNonNull(
                mcpToolInvokers, "mcpToolInvokers must not be null");
        this.mcpToolCatalog = mcpToolCatalog;
        this.spanFactories = Objects.requireNonNull(
                spanFactories, "spanFactories must not be null");
        this.businessMetrics = Objects.requireNonNull(
                businessMetrics, "businessMetrics must not be null");
    }

    @Override
    public AgentKernelToolkitResources register(AgentKernelSpec spec, Toolkit toolkit) {
        Objects.requireNonNull(spec, "spec must not be null");
        Objects.requireNonNull(toolkit, "toolkit must not be null");
        Map<String, ToolExecutor> direct = directTools(spec.agentDefinitionStableKey());
        Map<String, AiAgentDefinition.SubAgentToolDef> children =
                subAgentTools(spec.agentDefinitionStableKey());
        Map<String, AgentKernelToolManifest> manifest = manifest(spec);
        Long ownerUserId = AgentKernelSpecFactory.ownerUserId(spec);
        long appId = AppContext.currentOrDefault();
        McpToolCatalog catalog = mcpToolCatalog;
        AgentKernelToolkitResources mcpResources = AgentKernelToolkitResources.none();
        if (ownerUserId == null) {
            mcpRegistry.register(
                    spec.agentDefinitionStableKey(), spec.toolWhitelist(), toolkit);
        } else {
            mcpResources = mcpRegistry.register(
                    spec.agentDefinitionStableKey(), ownerUserId, spec.toolWhitelist(), toolkit);
        }

        try {
            for (String toolName : spec.toolWhitelist()) {
                ToolExecutor executor = direct.get(toolName);
                AiAgentDefinition.SubAgentToolDef child = children.get(toolName);
                boolean mcpTool = ownerUserId == null
                        ? mcpRegistry.isMcpTool(toolName, spec.agentDefinitionStableKey())
                        : mcpRegistry.isMcpTool(
                                toolName, spec.agentDefinitionStableKey(), ownerUserId);
                McpToolCatalogEntry catalogEntry = ownerUserId == null
                        ? catalogEntry(catalog, appId, toolName)
                        : catalogEntryForUser(catalog, appId, ownerUserId, toolName);
                int matches = (executor == null ? 0 : 1)
                        + (child == null ? 0 : 1)
                        + (mcpTool ? 1 : 0)
                        + (catalogEntry == null ? 0 : 1);
                if (matches > 1) {
                    throw new IllegalStateException(
                            "AgentScope tool name is ambiguous in kernel whitelist: " + toolName);
                }
                AgentKernelToolManifest expected = Objects.requireNonNull(
                        manifest.get(toolName), "Missing kernel tool manifest: " + toolName);
                if (executor != null) {
                    AgentScopeToolSchema.PreparedSchema schema = AgentScopeToolSchema.prepare(
                            objectMapper, executor.getParametersSchema(), toolName);
                    requireManifest(
                            expected, schema, executor.isReadOnly(), executor.isConcurrencySafe());
                    toolkit.registerAgentTool(new AgentScopeToolAdapter(
                            executor, schema, schedulers.toolBlocking(), leaseGuard, objectMapper,
                            actTokenSuppliers.getIfAvailable(),
                            // [adapt] P1-T2a:MCP 调用端口随适配器下发(T2b 接管点)
                            mcpToolInvokers.getIfAvailable(),
                            // [adapt] 任务 #18b(W5):execute_tool span 挂点
                            spanFactories.getIfAvailable(),
                            // [adapt] IA-2 工具终态业务计数(ia_tool_calls_total)
                            businessMetrics.getIfAvailable()));
                } else if (child != null) {
                    AgentScopeToolSchema.PreparedSchema schema =
                            AgentScopeToolSchema.prepareSubAgent(
                                    objectMapper, child.getParametersSchema(), toolName);
                    requireManifest(expected, schema, false, true);
                    toolkit.registerAgentTool(new AgentScopeSubAgentToolAdapter(
                            child,
                            spec,
                            schema,
                            specFactory,
                            childRuns::getIfAvailable,
                            leaseGuard,
                            objectMapper));
                } else if (catalogEntry != null) {
                    // [adapt] U1/D1:目录条目 → 宿主桥工具适配器(execution 经
                    // McpToolInvoker;治理位 readOnlyEffective/concurrencySafe 定契约)
                    AgentScopeToolSchema.PreparedSchema schema =
                            prepareCatalogSchema(catalogEntry);
                    requireManifest(
                            expected,
                            schema,
                            catalogEntry.readOnlyEffective(),
                            catalogEntry.concurrencySafe());
                    toolkit.registerAgentTool(new AgentScopeMcpToolAdapter(
                            catalogEntry,
                            appId,
                            schema,
                            schedulers.toolBlocking(),
                            leaseGuard,
                            objectMapper,
                            mcpToolInvokers.getIfAvailable(),
                            // [adapt] IA-2 工具终态业务计数(ia_tool_calls_total)
                            businessMetrics.getIfAvailable()));
                } else if (mcpTool) {
                    AgentTool registered = Objects.requireNonNull(
                            toolkit.getTool(toolName),
                            "MCP registry did not register tool: " + toolName);
                    AgentScopeToolSchema.PreparedSchema schema = prepareMcpSchema(
                            registered, toolName);
                    boolean concurrencySafe = registered instanceof ToolBase toolBase
                            && toolBase.isConcurrencySafe();
                    requireManifest(
                            expected,
                            schema,
                            registered.isReadOnly(),
                            concurrencySafe);
                } else {
                    throw new IllegalStateException(
                            "AgentScope kernel references an unavailable platform tool: " + toolName);
                }
            }
            return mcpResources;
        } catch (Throwable failure) {
            try {
                mcpResources.close();
            } catch (Throwable closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            if (failure instanceof RuntimeException runtimeFailure) {
                throw runtimeFailure;
            }
            if (failure instanceof Error error) {
                throw error;
            }
            throw new IllegalStateException("AgentScope tool registration failed", failure);
        }
    }

    /** 目录条目按白名单名(FQN)反查;目录未装配时恒空。 */
    private McpToolCatalogEntry catalogEntry(
            McpToolCatalog catalog, long appId, String toolName) {
        if (catalog == null) {
            return null;
        }
        return catalog.find(appId, toolName).orElse(null);
    }

    /**
     * [P4-W13] 用户视角目录反查(用户级三方条目仅存在于 catalogForUser 聚合;
     * 行级 userId 隔离——仅本人目录可命中)。
     */
    private McpToolCatalogEntry catalogEntryForUser(
            McpToolCatalog catalog, long appId, long ownerUserId, String toolName) {
        if (catalog == null) {
            return null;
        }
        return catalog.findForUser(appId, ownerUserId, toolName).orElse(null);
    }

    /** 目录 schema 规范化(与 spec 侧 catalogManifest 同一 prepare 口径)。 */
    private AgentScopeToolSchema.PreparedSchema prepareCatalogSchema(
            McpToolCatalogEntry entry) {
        String schemaJson = entry.parametersSchemaJson() == null
                || entry.parametersSchemaJson().isBlank()
                ? "{\"type\":\"object\"}"
                : entry.parametersSchemaJson();
        return AgentScopeToolSchema.prepare(objectMapper, schemaJson, entry.fqn());
    }

    private AgentScopeToolSchema.PreparedSchema prepareMcpSchema(
            AgentTool tool,
            String toolName) {
        try {
            return AgentScopeToolSchema.prepare(
                    objectMapper,
                    objectMapper.writeValueAsString(tool.getParameters()),
                    toolName);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException(
                    "Failed to canonicalize registered MCP tool schema: " + toolName,
                    failure);
        }
    }

    private Map<String, ToolExecutor> directTools(String definitionKey) {
        List<ToolExecutor> allowed = AgentKernelSpecFactory.DEFAULT_AGENT_KEY.equals(definitionKey)
                ? toolConfigService.getEnabledTools()
                : toolConfigService.getEnabledToolsByAgent(definitionKey);
        Map<String, ToolExecutor> result = new LinkedHashMap<>();
        for (ToolExecutor tool : allowed) {
            ToolExecutor registered = executors.findExecutor(tool.getToolName());
            if (registered == null || registered != tool) {
                throw new IllegalStateException(
                        "Platform tool registry identity changed: " + tool.getToolName());
            }
            if (result.put(tool.getToolName(), tool) != null) {
                throw new IllegalStateException("Duplicate platform tool: " + tool.getToolName());
            }
        }
        return result;
    }

    private Map<String, AiAgentDefinition.SubAgentToolDef> subAgentTools(String definitionKey) {
        if (AgentKernelSpecFactory.DEFAULT_AGENT_KEY.equals(definitionKey)) {
            return Map.of();
        }
        agentService.getRequiredByType(definitionKey);
        Map<String, AiAgentDefinition.SubAgentToolDef> result = new LinkedHashMap<>();
        for (AiAgentDefinition.SubAgentToolDef child
                : toolConfigService.getSubAgentTools(definitionKey)) {
            if (result.put(child.getToolName(), child) != null) {
                throw new IllegalStateException(
                        "Duplicate platform sub-agent tool: " + child.getToolName());
            }
        }
        return result;
    }

    private Map<String, AgentKernelToolManifest> manifest(AgentKernelSpec spec) {
        Map<String, AgentKernelToolManifest> result = new LinkedHashMap<>();
        for (AgentKernelToolManifest entry : spec.toolManifest()) {
            result.put(entry.toolName(), entry);
        }
        return result;
    }

    private void requireManifest(
            AgentKernelToolManifest expected,
            AgentScopeToolSchema.PreparedSchema schema,
            boolean readOnly,
            boolean concurrencySafe) {
        String actualHash = AgentKernelToolManifest.schemaSha256(schema.canonicalJson());
        if (!expected.schemaSha256().equals(actualHash)
                || expected.readOnly() != readOnly
                || expected.concurrencySafe() != concurrencySafe) {
            throw new IllegalStateException(
                    "Platform AgentScope tool contract changed: " + expected.toolName());
        }
    }
}
