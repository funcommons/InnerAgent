package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.platform.config.AgentScopeV2Properties;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.server.controller.vo.ToolConfirmationReqVO;
import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.permission.ToolExecutionMode;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import com.inneragent.agent.run.model.PendingConfirmation;
import com.inneragent.agent.run.model.ResumeAgentExecutionCommand;
import com.inneragent.agent.run.model.ResumeConfirmationCommand;
import com.inneragent.agent.run.model.ResumedAgentRun;
import io.agentscope.core.event.ConfirmResult;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.ToolCallState;
import io.agentscope.core.message.ToolUseBlock;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

class AgentConfirmationServiceTests {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
    private final ToolAuditService audits = mock(ToolAuditService.class);
    /** IA-3 计数断言手柄(SimpleMeterRegistry 支撑,值同 lifecycle 累积)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics metrics =
            new com.inneragent.platform.metrics.IaBusinessMetrics(
                    new io.micrometer.core.instrument.simple.SimpleMeterRegistry());

    @SuppressWarnings("unchecked")
    private AgentConfirmationService service() {
        AgentWaitingStatePort waiting = mock(AgentWaitingStatePort.class);
        AgentExecutionRuntimeContextRequests runtimeContexts =
                mock(AgentExecutionRuntimeContextRequests.class);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        properties.getExecution().setInstanceId("confirm-node");
        AgentRuntimeInstanceIdentity identity = new AgentRuntimeInstanceIdentity(properties);
        CanonicalAgentKernelSnapshotBuilder snapshots =
                new CanonicalAgentKernelSnapshotBuilder(objectMapper);
        AgentConfirmationService service = new AgentConfirmationService(
                waiting,
                runtimeContexts,
                supervisor,
                snapshots,
                identity,
                properties,
                objectMapper,
                audits,
                (ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog>) mock(ObjectProvider.class),
                metrics);
        return service;
    }

    private AgentWaitingStatePort waitingWith(
            PendingConfirmation pending, ResumedAgentRun resumed) {
        AgentWaitingStatePort waiting = mock(AgentWaitingStatePort.class);
        when(waiting.getPendingConfirmationAuthorized("7", 42, "reply-1"))
                .thenReturn(Mono.just(pending));
        when(waiting.resumeConfirmation(any()))
                .thenReturn(Mono.just(resumed));
        return waiting;
    }

    private AgentExecutionRuntimeContextRequests runtimesWith(
            ResumedAgentRun resumed, AgentScopeRuntimeContextRequest runtime) {
        AgentExecutionRuntimeContextRequests runtimeContexts =
                mock(AgentExecutionRuntimeContextRequests.class);
        when(runtimeContexts.forResume(
                resumed, "assistant", ToolExecutionMode.DEFAULT))
                .thenReturn(Mono.just(runtime));
        return runtimeContexts;
    }

    @Test
    void deniedDecisionIsReplayedAsAgentScopeConfirmResult() throws Exception {
        AgentWaitingStatePort waiting = mock(AgentWaitingStatePort.class);
        AgentExecutionRuntimeContextRequests runtimeContexts =
                mock(AgentExecutionRuntimeContextRequests.class);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        properties.getExecution().setInstanceId("confirm-node");
        AgentRuntimeInstanceIdentity identity = new AgentRuntimeInstanceIdentity(properties);
        CanonicalAgentKernelSnapshotBuilder snapshots =
                new CanonicalAgentKernelSnapshotBuilder(objectMapper);
        AgentConfirmationService service = new AgentConfirmationService(
                waiting,
                runtimeContexts,
                supervisor,
                snapshots,
                identity,
                properties,
                objectMapper,
                audits,
                mock(ObjectProvider.class),
                metrics);

        ToolUseBlock toolCall = new ToolUseBlock(
                "call-1",
                "update_script",
                Map.of("scriptId", 7),
                null,
                Map.of(),
                ToolCallState.ASKING);
        PendingConfirmation pending = new PendingConfirmation(
                "reply-1",
                Set.of("call-1"),
                "[{\"toolCallId\":\"call-1\",\"toolName\":\"update_script\",\"argumentsPreview\":\"{}\"}]",
                objectMapper.writeValueAsString(List.of(Map.of(
                        "id", toolCall.getId(),
                        "name", toolCall.getName(),
                        "input", toolCall.getInput(),
                        "metadata", toolCall.getMetadata(),
                        "state", toolCall.getState().name()))),
                Instant.now().plusSeconds(300));
        AgentKernelSnapshot snapshot = snapshots.build(new AgentKernelSnapshotPayload(
                AgentKernelSnapshotPayload.CURRENT_SCHEMA_VERSION,
                "assistant",
                "assistant",
                "test assistant",
                "system",
                Map.of(
                        AgentKernelSpecFactory.TOOL_EXECUTION_MODE_VARIABLE,
                        ToolExecutionMode.DEFAULT.name()),
                5,
                "1",
                1,
                "openai",
                "test-model",
                JsonNodeFactory.instance.objectNode(),
                List.of(),
                "test"));
        ResumedAgentRun resumed = new ResumedAgentRun(
                "run-1",
                "conversation-1",
                "session-1",
                snapshot.fingerprint(),
                snapshot.snapshotJson(),
                3,
                "confirm-node",
                2,
                Instant.now().plusSeconds(30),
                Instant.now().plusSeconds(300));
        AgentScopeRuntimeContextRequest runtime = mock(AgentScopeRuntimeContextRequest.class);
        when(waiting.getPendingConfirmationAuthorized("7", 42, "reply-1"))
                .thenReturn(Mono.just(pending));
        when(waiting.resumeConfirmation(any()))
                .thenReturn(Mono.just(resumed));
        when(runtimeContexts.forResume(
                resumed, "assistant", ToolExecutionMode.DEFAULT))
                .thenReturn(Mono.just(runtime));
        when(supervisor.resume(any()))
                .thenReturn(Mono.empty());

        ToolConfirmationReqVO request = request(false);
        StepVerifier.create(service.respond(request, 42)).verifyComplete();

        ArgumentCaptor<ResumeConfirmationCommand> transition =
                ArgumentCaptor.forClass(ResumeConfirmationCommand.class);
        verify(waiting).resumeConfirmation(transition.capture());
        assertThat(transition.getValue().decisionResults())
                .containsEntry("call-1", false);

        ArgumentCaptor<ResumeAgentExecutionCommand> execution =
                ArgumentCaptor.forClass(ResumeAgentExecutionCommand.class);
        verify(supervisor).resume(execution.capture());
        Msg resumeMessage = execution.getValue().messages().getFirst();
        Object metadata = resumeMessage.getMetadata().get(Msg.METADATA_CONFIRM_RESULTS);
        assertThat(metadata).isInstanceOf(List.class);
        ConfirmResult result = (ConfirmResult) ((List<?>) metadata).getFirst();
        assertThat(result.isConfirmed()).isFalse();
        assertThat(result.getToolCall().getId()).isEqualTo("call-1");
    }

    @Test
    void approvedDecisionAppendsLiveConfirmAllowedAuditRow() throws Exception {
        ResumedAgentRun resumed = resumedRun();
        PendingConfirmation pending = pendingConfirmation();
        AgentWaitingStatePort waiting = waitingWith(pending, resumed);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        when(supervisor.resume(any())).thenReturn(Mono.empty());
        AgentConfirmationService service = serviceWith(waiting, resumed, supervisor);

        StepVerifier.create(service.respond(request(true), 42)).verifyComplete();

        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(audits).append(audit.capture());
        ToolAuditService.ToolAuditEntry row = audit.getValue();
        assertThat(row.decision()).isEqualTo("allowed");
        assertThat(row.decisionSource()).isEqualTo(ToolDecisionSource.LIVE_CONFIRM.code());
        assertThat(row.runId()).isEqualTo("7");
        assertThat(row.userId()).isEqualTo(42L);
        assertThat(row.toolFqn()).isEqualTo("update_script");
        assertThat(row.paramsMaskedJson()).contains("scriptId");
    }

    @Test
    void deniedDecisionAppendsLiveConfirmDeniedAuditRow() throws Exception {
        ResumedAgentRun resumed = resumedRun();
        PendingConfirmation pending = pendingConfirmation();
        AgentWaitingStatePort waiting = waitingWith(pending, resumed);
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        when(supervisor.resume(any())).thenReturn(Mono.empty());
        AgentConfirmationService service = serviceWith(waiting, resumed, supervisor);

        StepVerifier.create(service.respond(request(false), 42)).verifyComplete();

        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(audits).append(audit.capture());
        ToolAuditService.ToolAuditEntry row = audit.getValue();
        assertThat(row.decision()).isEqualTo("denied");
        assertThat(row.decisionSource()).isEqualTo(ToolDecisionSource.LIVE_CONFIRM.code());
        assertThat(row.runId()).isEqualTo("7");
        assertThat(row.toolFqn()).isEqualTo("update_script");
    }

    @Test
    void confirmationDecisionIncrementsBusinessCounterPerTool() throws Exception {
        ResumedAgentRun resumed = resumedRun();
        PendingConfirmation pending = pendingConfirmation();
        RunExecutionSupervisor supervisor = mock(RunExecutionSupervisor.class);
        when(supervisor.resume(any())).thenReturn(Mono.empty());

        StepVerifier.create(serviceWith(
                        waitingWith(pending, resumed), resumed, supervisor)
                .respond(request(true), 42))
                .verifyComplete();
        StepVerifier.create(serviceWith(
                        waitingWith(pending, resumed), resumed, supervisor)
                .respond(request(false), 42))
                .verifyComplete();

        // IA-3 与审计同点位逐工具一比一:approved/rejected 各 1,source=live-confirm
        assertThat(metrics.counterValue("ia.confirmation",
                "app", "1", "decision", "approved", "source", "live-confirm"))
                .isEqualTo(1.0);
        assertThat(metrics.counterValue("ia.confirmation",
                "app", "1", "decision", "rejected", "source", "live-confirm"))
                .isEqualTo(1.0);
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    private PendingConfirmation pendingConfirmation() throws Exception {
        ToolUseBlock toolCall = new ToolUseBlock(
                "call-1",
                "update_script",
                Map.of("scriptId", 7),
                null,
                Map.of(),
                ToolCallState.ASKING);
        return new PendingConfirmation(
                "reply-1",
                Set.of("call-1"),
                "[{\"toolCallId\":\"call-1\",\"toolName\":\"update_script\",\"argumentsPreview\":\"{}\"}]",
                objectMapper.writeValueAsString(List.of(Map.of(
                        "id", toolCall.getId(),
                        "name", toolCall.getName(),
                        "input", toolCall.getInput(),
                        "metadata", toolCall.getMetadata(),
                        "state", toolCall.getState().name()))),
                Instant.now().plusSeconds(300));
    }

    private ResumedAgentRun resumedRun() {
        CanonicalAgentKernelSnapshotBuilder snapshots =
                new CanonicalAgentKernelSnapshotBuilder(objectMapper);
        AgentKernelSnapshot snapshot = snapshots.build(new AgentKernelSnapshotPayload(
                AgentKernelSnapshotPayload.CURRENT_SCHEMA_VERSION,
                "assistant",
                "assistant",
                "test assistant",
                "system",
                Map.of(
                        AgentKernelSpecFactory.TOOL_EXECUTION_MODE_VARIABLE,
                        ToolExecutionMode.DEFAULT.name()),
                5,
                "1",
                1,
                "openai",
                "test-model",
                JsonNodeFactory.instance.objectNode(),
                List.of(),
                "test"));
        return new ResumedAgentRun(
                "run-1",
                "conversation-1",
                "session-1",
                snapshot.fingerprint(),
                snapshot.snapshotJson(),
                3,
                "confirm-node",
                2,
                Instant.now().plusSeconds(30),
                Instant.now().plusSeconds(300));
    }

    private AgentConfirmationService serviceWith(
            AgentWaitingStatePort waiting,
            ResumedAgentRun resumed,
            RunExecutionSupervisor supervisor) {
        AgentExecutionRuntimeContextRequests runtimeContexts = mock(
                AgentExecutionRuntimeContextRequests.class);
        when(runtimeContexts.forResume(
                resumed, "assistant", ToolExecutionMode.DEFAULT))
                .thenReturn(Mono.just(mock(AgentScopeRuntimeContextRequest.class)));
        AgentScopeV2Properties properties = new AgentScopeV2Properties();
        properties.getExecution().setInstanceId("confirm-node");
        return new AgentConfirmationService(
                waiting,
                runtimeContexts,
                supervisor,
                new CanonicalAgentKernelSnapshotBuilder(objectMapper),
                new AgentRuntimeInstanceIdentity(properties),
                properties,
                objectMapper,
                audits,
                mock(ObjectProvider.class),
                metrics);
    }

    private ToolConfirmationReqVO request(boolean approved) {
        ToolConfirmationReqVO.DecisionVO decision = new ToolConfirmationReqVO.DecisionVO();
        decision.setToolCallId("call-1");
        decision.setApproved(approved);
        ToolConfirmationReqVO request = new ToolConfirmationReqVO();
        request.setRunId("7");
        request.setReplyId("reply-1");
        request.setDecisions(List.of(decision));
        return request;
    }
}
