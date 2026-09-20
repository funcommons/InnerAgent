package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.mcp.McpToolCatalogEntry;
import com.inneragent.agent.mcp.McpToolInvocationResult;
import com.inneragent.agent.mcp.McpToolInvoker;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ToolAnnotations;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolResultState;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.tool.ToolCallParam;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * [adapt] U1/D1:MCP 目录条目工具适配器测试——执行委托 McpToolInvoker
 * (注册表工具名 + 显式 appId/租户/运行身份),宿主错误映射 AgentScope error 结果。
 */
class AgentScopeMcpToolAdapterTests {

    @AfterEach
    void tearDown() {
        AppContext.clear();
    }

    @Test
    void callAsyncDelegatesToInvokerWithRegistryToolNameAndExplicitContext() {
        AtomicReference<Long> capturedAppId = new AtomicReference<>();
        AtomicReference<String> capturedToolName = new AtomicReference<>();
        AtomicReference<Map<String, Object>> capturedArgs = new AtomicReference<>();
        AtomicReference<ToolExecutionContext> capturedContext = new AtomicReference<>();
        AtomicReference<Long> capturedTenant = new AtomicReference<>();
        McpToolInvoker invoker = (appId, toolName, args, actContext) -> {
            capturedAppId.set(appId);
            capturedToolName.set(toolName);
            capturedArgs.set(args);
            capturedContext.set(actContext);
            capturedTenant.set(com.inneragent.platform.tenant.TenantContext.getTenantId());
            return McpToolInvocationResult.ok("{\"status\":\"ok\",\"recordId\":3}");
        };

        AgentScopeMcpToolAdapter adapter = adapter(invoker);
        ToolResultBlock result = adapter.callAsync(param(Map.of("title", "U1验收"))).block();

        assertThat(capturedAppId.get()).isEqualTo(7L);
        // 调用端口携带注册表工具名(FQN 由目录还原),显式 runId 供 act.sub 使用
        assertThat(capturedToolName.get()).isEqualTo("create_host_record");
        assertThat(capturedArgs.get()).containsEntry("title", "U1验收");
        assertThat(capturedContext.get().runId()).isEqualTo("run-1");
        assertThat(capturedTenant.get()).isEqualTo(7L);
        assertThat(result.getId()).isEqualTo("call-1");
        assertThat(result.getName()).isEqualTo("mcp__demo-spring-host__create_host_record");
        TextBlock output = (TextBlock) result.getOutput().getFirst();
        assertThat(output.getText()).contains("recordId");
    }

    @Test
    void callAsyncMapsHostToolErrorsToAgentScopeErrorResults() {
        McpToolInvoker invoker = (appId, toolName, args, actContext) ->
                McpToolInvocationResult.error("{\"text\":\"boom\"}");

        AgentScopeMcpToolAdapter adapter = adapter(invoker);
        ToolResultBlock result = adapter.callAsync(param(Map.of())).block();

        assertThat(result.getState()).isEqualTo(ToolResultState.ERROR);
    }

    @Test
    void callAsyncRequiresRuntimeContexts() {
        AgentScopeMcpToolAdapter adapter = adapter((appId, toolName, args, actContext) ->
                McpToolInvocationResult.ok("{}"));
        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-1")
                .name("mcp__demo-spring-host__create_host_record")
                .input(Map.of())
                .build();

        assertThatThrownBy(() -> adapter.callAsync(ToolCallParam.builder()
                        .toolUseBlock(toolUseBlock)
                        .input(Map.of())
                        .build())
                .block())
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    private AgentScopeMcpToolAdapter adapter(McpToolInvoker invoker) {
        McpToolCatalogEntry entry = McpToolCatalogEntry.of(
                registryEntry(), ToolAnnotations.parse(new ObjectMapper(), "{\"readOnlyHint\":true}"),
                false);
        AgentScopeToolSchema.PreparedSchema schema = AgentScopeToolSchema.prepare(
                new ObjectMapper(),
                "{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"}}}",
                entry.fqn());
        RunLeaseGuard leaseGuard = mock(RunLeaseGuard.class);
        when(leaseGuard.assertLease("run-1", "owner-1", 1L)).thenReturn(Mono.empty());
        return new AgentScopeMcpToolAdapter(
                entry, 7L, schema, Schedulers.immediate(), leaseGuard,
                new ObjectMapper(), invoker);
    }

    private static com.inneragent.platform.toolhub.ToolRegistryEntry registryEntry() {
        com.inneragent.platform.toolhub.ToolRegistryEntry entry =
                new com.inneragent.platform.toolhub.ToolRegistryEntry();
        entry.setId(1L);
        entry.setServerKey("demo-spring-host");
        entry.setToolName("create_host_record");
        entry.setFqn("mcp__demo-spring-host__create_host_record");
        entry.setDescription("在宿主内存中创建一条记录(演示写工具)");
        entry.setParametersSchema("{\"type\":\"object\"}");
        entry.setRiskLevel("medium");
        entry.setSource("host_app");
        entry.setEnabled(true);
        return entry;
    }

    private ToolCallParam param(Map<String, Object> input) {
        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-1")
                .name("mcp__demo-spring-host__create_host_record")
                .input(input)
                .build();
        RuntimeContext runtime = RuntimeContext.builder()
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "owner-1", 1L, Instant.now().plusSeconds(30)))
                .put(CancellationContext.class, CancellationContext.noop())
                .put(ToolExecutionContext.class, new ToolExecutionContext(
                        42L, 1, 42L, 7L, "run-1"))
                .build();
        return ToolCallParam.builder()
                .toolUseBlock(toolUseBlock)
                .input(input)
                .runtimeContext(runtime)
                .build();
    }
}
