package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.tool.ToolExecutionContext;
import com.inneragent.agent.tool.ToolExecutor;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.run.RunLeaseGuard;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolResultState;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.tool.ToolCallParam;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentScopeToolAdapterTests {

    @Test
    void callAsyncShouldPreserveToolCallIdAndName() {
        ToolExecutor toolExecutor = mock(ToolExecutor.class);
        when(toolExecutor.getToolName()).thenReturn("asset_query");
        when(toolExecutor.getToolDescription()).thenReturn("query asset");
        when(toolExecutor.execute(eq("{\"keyword\":\"cat\"}"), any(ToolExecutionContext.class)))
                .thenReturn("ok");
        RunLeaseGuard leaseGuard = mock(RunLeaseGuard.class);
        when(leaseGuard.assertLease("run-1", "owner-1", 1L)).thenReturn(Mono.empty());

        AgentScopeToolAdapter adapter = new AgentScopeToolAdapter(
                toolExecutor,
                AgentScopeToolSchema.prepare(
                        new ObjectMapper(),
                        "{\"type\":\"object\",\"properties\":{\"keyword\":{\"type\":\"string\"}}}",
                        "asset_query"),
                Schedulers.immediate(),
                leaseGuard,
                new ObjectMapper());

        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-123")
                .name("asset_query")
                .input(Map.of("keyword", "cat"))
                .build();

        RuntimeContext runtime = RuntimeContext.builder()
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "owner-1", 1L, Instant.now().plusSeconds(30)))
                .put(CancellationContext.class, CancellationContext.noop())
                .put(com.inneragent.agent.context.ToolExecutionContext.class,
                        new com.inneragent.agent.context.ToolExecutionContext(
                                42L, 1, 42L, 7L))
                .build();
        ToolCallParam param = ToolCallParam.builder()
                .toolUseBlock(toolUseBlock)
                .input(Map.of("keyword", "cat"))
                .runtimeContext(runtime)
                .build();

        ToolResultBlock result = adapter.callAsync(param).block();

        assertEquals("call-123", result.getId());
        assertEquals("asset_query", result.getName());
                TextBlock output = assertInstanceOf(TextBlock.class, result.getOutput().getFirst());
                assertEquals("ok", output.getText());
    }

    @Test
    void callAsyncShouldExposePlatformErrorJsonAsAgentScopeError() {
        ToolExecutor toolExecutor = mock(ToolExecutor.class);
        when(toolExecutor.getToolName()).thenReturn("asset_query");
        when(toolExecutor.getToolDescription()).thenReturn("query asset");
        when(toolExecutor.execute(eq("{}"), any(ToolExecutionContext.class)))
                .thenReturn("{\"status\":\"error\",\"message\":\"asset missing\"}");
        RunLeaseGuard leaseGuard = mock(RunLeaseGuard.class);
        when(leaseGuard.assertLease("run-1", "owner-1", 1L)).thenReturn(Mono.empty());
        AgentScopeToolAdapter adapter = new AgentScopeToolAdapter(
                toolExecutor,
                AgentScopeToolSchema.prepare(
                        new ObjectMapper(),
                        "{\"type\":\"object\",\"properties\":{}}",
                        "asset_query"),
                Schedulers.immediate(),
                leaseGuard,
                new ObjectMapper());
        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-error")
                .name("asset_query")
                .input(Map.of())
                .build();
        RuntimeContext runtime = RuntimeContext.builder()
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "owner-1", 1L, Instant.now().plusSeconds(30)))
                .put(CancellationContext.class, CancellationContext.noop())
                .put(com.inneragent.agent.context.ToolExecutionContext.class,
                        new com.inneragent.agent.context.ToolExecutionContext(
                                42L, 1, 42L, 7L))
                .build();

        ToolResultBlock result = adapter.callAsync(ToolCallParam.builder()
                        .toolUseBlock(toolUseBlock)
                        .input(Map.of())
                        .runtimeContext(runtime)
                        .build())
                .block();

        assertEquals(ToolResultState.ERROR, result.getState());
        TextBlock output = assertInstanceOf(TextBlock.class, result.getOutput().getFirst());
        assertEquals(
                "Error: {\"status\":\"error\",\"message\":\"asset missing\"}",
                output.getText());
    }

    // ------------------------------------------------------------------
    // IA-2 业务计数(ia_tool_calls_total{app,tool,result};P4 差距收口)
    // ------------------------------------------------------------------

    @Test
    void callAsyncCountsOkTerminalState() {
        io.micrometer.core.instrument.simple.SimpleMeterRegistry registry =
                new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        com.inneragent.platform.metrics.IaBusinessMetrics metrics =
                new com.inneragent.platform.metrics.IaBusinessMetrics(registry);
        AgentScopeToolAdapter adapter = adapter(metrics, "ok");

        adapter.callAsync(param()).block();

        assertThat(metrics.counterValue(
                        com.inneragent.platform.metrics.IaBusinessMetrics.TOOL_CALLS,
                        "app", "1", "tool", "asset_query", "result", "ok"))
                .isEqualTo(1.0);
        assertThat(metrics.counterValue(
                        com.inneragent.platform.metrics.IaBusinessMetrics.TOOL_CALLS,
                        "app", "1", "tool", "asset_query", "result", "error"))
                .isEqualTo(0.0);
    }

    @Test
    void callAsyncCountsPlatformErrorPayloadAsError() {
        io.micrometer.core.instrument.simple.SimpleMeterRegistry registry =
                new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        com.inneragent.platform.metrics.IaBusinessMetrics metrics =
                new com.inneragent.platform.metrics.IaBusinessMetrics(registry);
        AgentScopeToolAdapter adapter = adapter(metrics,
                "{\"status\":\"error\",\"message\":\"asset missing\"}");

        adapter.callAsync(param()).block();

        assertThat(metrics.counterValue(
                        com.inneragent.platform.metrics.IaBusinessMetrics.TOOL_CALLS,
                        "app", "1", "tool", "asset_query", "result", "error"))
                .isEqualTo(1.0);
    }

    @Test
    void callAsyncCountsThrownExecutorFailureAsErrorExactlyOnce() {
        io.micrometer.core.instrument.simple.SimpleMeterRegistry registry =
                new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        com.inneragent.platform.metrics.IaBusinessMetrics metrics =
                new com.inneragent.platform.metrics.IaBusinessMetrics(registry);
        AgentScopeToolAdapter adapter = adapter(metrics, null);

        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class,
                () -> adapter.callAsync(param()).block());

        assertThat(metrics.counterValue(
                        com.inneragent.platform.metrics.IaBusinessMetrics.TOOL_CALLS,
                        "app", "1", "tool", "asset_query", "result", "error"))
                .isEqualTo(1.0);
    }

    // ------------------------------------------------------------------

    private AgentScopeToolAdapter adapter(
            com.inneragent.platform.metrics.IaBusinessMetrics metrics,
            String executorOutput) {
        ToolExecutor toolExecutor = mock(ToolExecutor.class);
        when(toolExecutor.getToolName()).thenReturn("asset_query");
        when(toolExecutor.getToolDescription()).thenReturn("query asset");
        if (executorOutput == null) {
            when(toolExecutor.execute(any(String.class), any(ToolExecutionContext.class)))
                    .thenThrow(new IllegalStateException("boom"));
        } else {
            when(toolExecutor.execute(any(String.class), any(ToolExecutionContext.class)))
                    .thenReturn(executorOutput);
        }
        RunLeaseGuard leaseGuard = mock(RunLeaseGuard.class);
        when(leaseGuard.assertLease(any(), any(), org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(Mono.empty());
        return new AgentScopeToolAdapter(
                toolExecutor,
                AgentScopeToolSchema.prepare(
                        new ObjectMapper(),
                        "{\"type\":\"object\",\"properties\":{\"keyword\":{\"type\":\"string\"}}}",
                        "asset_query"),
                Schedulers.immediate(),
                leaseGuard,
                new ObjectMapper(),
                null,
                null,
                null,
                metrics);
    }

    private ToolCallParam param() {
        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-metrics")
                .name("asset_query")
                .input(Map.of("keyword", "cat"))
                .build();
        RuntimeContext runtime = RuntimeContext.builder()
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "owner-1", 1L, Instant.now().plusSeconds(30)))
                .put(CancellationContext.class, CancellationContext.noop())
                .put(com.inneragent.agent.context.ToolExecutionContext.class,
                        new com.inneragent.agent.context.ToolExecutionContext(
                                42L, 1, 42L, 7L))
                .build();
        return ToolCallParam.builder()
                .toolUseBlock(toolUseBlock)
                .input(Map.of("keyword", "cat"))
                .runtimeContext(runtime)
                .build();
    }
}
