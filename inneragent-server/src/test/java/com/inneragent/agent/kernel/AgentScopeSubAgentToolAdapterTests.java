package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.agent.context.AgentRunContext;
import com.inneragent.agent.context.CancellationContext;
import com.inneragent.agent.context.ProjectContext;
import com.inneragent.agent.context.ToolPermissionContext;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.tool.PlatformSubAgentCommand;
import com.inneragent.agent.tool.PlatformSubAgentRun;
import com.inneragent.agent.tool.PlatformSubAgentRunPort;
import com.inneragent.agent.run.RunLeaseGuard;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.message.ToolResultState;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.tool.ToolCallParam;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentScopeSubAgentToolAdapterTests {

    @Test
    void durableChildRunToolAllowsParallelInvocations() {
        AgentScopeSubAgentToolAdapter adapter = adapter(
                () -> mock(PlatformSubAgentRunPort.class));

        assertThat(adapter.isConcurrencySafe()).isTrue();
        assertThat(adapter.isReadOnly()).isFalse();
    }

    /**
     * [adapt] P4-W14 深度/扇出护栏与父不可准入(409)的「报错回灌模型」:
     * 准入拒绝映射为 status:error 的工具结果(ToolResultState.ERROR),
     * 模型可据此调整而非整次运行失败。
     */
    @Test
    void mapsAdmissionRejectionsToErrorToolResultsForModelFeedback() {
        PlatformSubAgentRunPort port = mock(PlatformSubAgentRunPort.class);
        when(port.start(any(PlatformSubAgentCommand.class))).thenReturn(
                Mono.error(new BusinessException(429, "子 Agent 并发数超过上限 5")));

        AgentScopeSubAgentToolAdapter adapter = adapter(() -> port);
        ToolResultBlock result = adapter.callAsync(param(Map.of(
                        "message", "研究这个课题")))
                .block(java.time.Duration.ofSeconds(5));

        assertThat(result).isNotNull();
        assertThat(result.getState()).isEqualTo(ToolResultState.ERROR);
        String text = ((TextBlock) result.getOutput().getFirst()).getText();
        JsonNode payload = readTree(text);
        assertThat(payload.path("status").asText()).isEqualTo("error");
        assertThat(payload.path("error").asText()).contains("并发数超过上限");
        assertThat(payload.path("childRunId").isMissingNode()).isTrue();
    }

    @Test
    void completesWithProjectedChildResultJson() {
        PlatformSubAgentRunPort port = mock(PlatformSubAgentRunPort.class);
        PlatformSubAgentRun completed = new PlatformSubAgentRun(
                "child-run-1", "run-1", "call-1", "episode_scene_writer",
                AgentRunStatus.COMPLETED, "all scenes saved", null);
        when(port.start(any(PlatformSubAgentCommand.class)))
                .thenReturn(Mono.just(new PlatformSubAgentRun(
                        "child-run-1", "run-1", "call-1",
                        "episode_scene_writer", AgentRunStatus.RUNNING)));
        when(port.awaitCompletion(any(PlatformSubAgentRun.class)))
                .thenReturn(Mono.just(completed));

        AgentScopeSubAgentToolAdapter adapter = adapter(() -> port);
        ToolResultBlock result = adapter.callAsync(param(Map.of(
                        "message", "研究这个课题")))
                .block(java.time.Duration.ofSeconds(5));

        assertThat(result).isNotNull();
        assertThat(result.getState()).isNotEqualTo(ToolResultState.ERROR);
        JsonNode payload = readTree(
                ((TextBlock) result.getOutput().getFirst()).getText());
        assertThat(payload.path("childRunId").asText()).isEqualTo("child-run-1");
        assertThat(payload.path("parentRunId").asText()).isEqualTo("run-1");
        assertThat(payload.path("status").asText()).isEqualTo("COMPLETED");
        assertThat(payload.path("result").asText()).isEqualTo("all scenes saved");
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    private AgentScopeSubAgentToolAdapter adapter(
            java.util.function.Supplier<PlatformSubAgentRunPort> childRuns) {
        AiAgentDefinition.SubAgentToolDef definition =
                AiAgentDefinition.SubAgentToolDef.builder()
                        .toolName("episode_scene_writer")
                        .description("Parse one episode")
                        .parametersSchema("{\"type\":\"object\"}")
                        .refAgentType("episode_scene_writer")
                        .build();
        ObjectMapper objectMapper = new ObjectMapper();
        AgentKernelSpecFactory specFactory = mock(AgentKernelSpecFactory.class);
        when(specFactory.createChild(
                any(AgentKernelSpec.class),
                any(AiAgentDefinition.SubAgentToolDef.class),
                any(ProjectContext.class),
                any(Map.class)))
                .thenReturn(mock(AgentKernelSpec.class));
        RunLeaseGuard leaseGuard = mock(RunLeaseGuard.class);
        when(leaseGuard.assertLease("run-1", "owner-1", 1L)).thenReturn(Mono.empty());
        return new AgentScopeSubAgentToolAdapter(
                definition,
                mock(AgentKernelSpec.class),
                AgentScopeToolSchema.prepareSubAgent(
                        objectMapper,
                        definition.getParametersSchema(),
                        definition.getToolName()),
                specFactory,
                childRuns,
                leaseGuard,
                objectMapper);
    }

    private ToolCallParam param(Map<String, Object> input) {
        ToolUseBlock toolUseBlock = ToolUseBlock.builder()
                .id("call-1")
                .name("episode_scene_writer")
                .input(input)
                .build();
        RuntimeContext runtime = RuntimeContext.builder()
                .put(AgentRunContext.class, new AgentRunContext(
                        "run-1", "owner-1", 1L, Instant.now().plusSeconds(30)))
                .put(CancellationContext.class, CancellationContext.noop())
                .put(ToolPermissionContext.class, new ToolPermissionContext(
                        ToolExecutionMode.DEFAULT))
                .put(ProjectContext.class, new ProjectContext(77L))
                .build();
        return ToolCallParam.builder()
                .toolUseBlock(toolUseBlock)
                .input(input)
                .runtimeContext(runtime)
                .build();
    }

    private JsonNode readTree(String json) {
        // errorResult 约定:文本以 "Error: " 前缀 + JSON 载荷(与 MCP 工具同形)
        String payload = json.startsWith("Error: ") ? json.substring("Error: ".length()) : json;
        try {
            return new ObjectMapper().readTree(payload);
        } catch (Exception invalid) {
            throw new IllegalStateException("Tool result is not JSON: " + json, invalid);
        }
    }
}
