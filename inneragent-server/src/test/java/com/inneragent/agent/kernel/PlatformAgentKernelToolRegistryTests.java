package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.model.entity.AiModel;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import com.inneragent.agent.definition.AiAgentService;
import com.inneragent.agent.mcp.McpToolCatalog;
import com.inneragent.agent.mcp.McpToolInvoker;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.tool.AiToolConfigService;
import com.inneragent.agent.tool.ToolExecutorRegistry;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.core.tool.ToolkitConfig;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.scheduler.Schedulers;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * [adapt] U1/D1:内核工具注册链路测试——白名单中的 MCP 目录条目(FQN)由
 * AgentScopeMcpToolAdapter 装配进 toolkit,与 spec manifest 契约校验一致,
 * toolkit 工具集与内核白名单完全相等(HarnessFactory 不变量)。
 */
class PlatformAgentKernelToolRegistryTests {

    @Test
    void registersCatalogEntriesAsAgentScopeToolsViaInvokerPort() {
        ToolRegistryEntry registryEntry = registryEntry();
        ToolRegistryMapper mapper = mock(ToolRegistryMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of(registryEntry));
        McpToolCatalog catalog = new McpToolCatalog(
                mapper, mock(com.inneragent.platform.toolhub.ToolGrantService.class),
                new ObjectMapper());

        AgentKernelToolManifest manifest = new AgentKernelToolManifest(
                "mcp__demo-spring-host__create_host_record",
                manifestSha(),
                false,
                false);
        AgentKernelSpec spec = spec(Set.of("mcp__demo-spring-host__create_host_record"),
                List.of(manifest));

        McpToolInvoker invoker = (appId, toolName, args, actContext) ->
                com.inneragent.agent.mcp.McpToolInvocationResult.ok("{}");
        PlatformAgentKernelToolRegistry registry = new PlatformAgentKernelToolRegistry(
                mock(ToolExecutorRegistry.class),
                new AiToolConfigService(List.of(), new AiAgentRegistry()),
                new AiAgentService(new AiAgentRegistry()),
                mock(AgentKernelSpecFactory.class),
                mock(org.springframework.beans.factory.ObjectProvider.class),
                schedulers(),
                mock(RunLeaseGuard.class),
                new ObjectMapper(),
                mock(com.inneragent.agent.mcp.AgentScopeMcpRegistry.class),
                mock(org.springframework.beans.factory.ObjectProvider.class),
                providerOf(invoker),
                catalog,
                mock(org.springframework.beans.factory.ObjectProvider.class),
                mock(org.springframework.beans.factory.ObjectProvider.class));

        Toolkit toolkit = new Toolkit(ToolkitConfig.builder().parallel(true).build());
        registry.register(spec, toolkit);

        assertThat(toolkit.getToolNames())
                .containsExactly("mcp__demo-spring-host__create_host_record");
        assertThat(toolkit.getTool("mcp__demo-spring-host__create_host_record"))
                .isInstanceOf(AgentScopeMcpToolAdapter.class);
        // 模型可见 schema:目录工具必须以 FQN 出现在 toolkit 的工具 schema 列表
        assertThat(toolkit.getToolSchemas())
                .anySatisfy(schema -> assertThat(schema.getName())
                        .isEqualTo("mcp__demo-spring-host__create_host_record"));
        // 与 AgentToolPermissionPolicy 衔接:治理位 readOnly=false → DEFAULT 模式写确认
        assertThat(toolkit.getTool("mcp__demo-spring-host__create_host_record").isReadOnly())
                .isFalse();
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    private static String manifestSha() {
        try {
            com.fasterxml.jackson.databind.ObjectMapper objectMapper =
                    new ObjectMapper();
            var schema = com.inneragent.agent.tool.AgentScopeToolSchema.prepare(
                    objectMapper,
                    "{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"}},\"required\":[\"title\"]}",
                    "mcp__demo-spring-host__create_host_record");
            return AgentKernelToolManifest.schemaSha256(schema.canonicalJson());
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static ToolRegistryEntry registryEntry() {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(1L);
        // P2-srv U1:目录 load 显式按 app_id 过滤,fixture 须归属缺省应用 1
        entry.setAppId(1L);
        entry.setServerKey("demo-spring-host");
        entry.setToolName("create_host_record");
        entry.setFqn("mcp__demo-spring-host__create_host_record");
        entry.setDescription("在宿主内存中创建一条记录(演示写工具)");
        entry.setParametersSchema(
                "{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"}},\"required\":[\"title\"]}");
        entry.setRiskLevel("medium");
        entry.setSource(ToolRegistryService.SOURCE_HOST_APP);
        entry.setEnabled(true);
        return entry;
    }

    private static AgentKernelSpec spec(Set<String> whitelist, List<AgentKernelToolManifest> manifest) {
        AgentKernelKey key = AgentKernelKey.create(
                "ai_assistant_agent",
                "b".repeat(64),
                AgentKernelKey.promptVersion("prompt", Map.of()),
                manifest,
                AgentKernelSpecFactory.TOOL_WHITELIST_VERSION);
        return new AgentKernelSpec(
                key,
                AiModel.builder().id(9L).code("test-model").build(),
                "ai_assistant_agent",
                "ai_assistant_agent",
                "spec",
                "prompt",
                Map.of(),
                5,
                manifest,
                whitelist,
                AgentKernelSpecFactory.TOOL_WHITELIST_VERSION);
    }

    private static AgentRuntimeSchedulers schedulers() {
        AgentRuntimeSchedulers schedulers = mock(AgentRuntimeSchedulers.class);
        when(schedulers.toolBlocking()).thenReturn(Schedulers.immediate());
        return schedulers;
    }

    @SuppressWarnings("unchecked")
    private static <T> org.springframework.beans.factory.ObjectProvider<T> providerOf(T value) {
        org.springframework.beans.factory.ObjectProvider<T> provider =
                mock(org.springframework.beans.factory.ObjectProvider.class);
        Mockito.when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }
}
