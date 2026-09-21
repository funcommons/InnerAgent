package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 确认过期协调器测试。P2-srv U1 遗留补强:
 * <ul>
 *   <li>过期裁决写审计 —— 语义裁定:过期 = denied,decision_source 独立值
 *       {@code expired}(高危「100% 确认」审计可证明未发生用户实弹批准);</li>
 *   <li>双路径测试:{@link AgentConfirmationExpiryCoordinator#expireIfNeeded}
 *       (调度/恢复观察路径)与 {@code expireAuthorized}(用户确认端点探视路径)
 *       均逐工具追加审计;</li>
 *   <li>审计失败 fail-closed:审计不落则终止决策不生效(与确认流 U1/D3 同口径)。</li>
 * </ul>
 */
class AgentConfirmationExpiryCoordinatorTests {

    private AgentRunMapper runMapper;
    private AgentEventMapper eventMapper;
    private RunTerminalCoordinator terminals;
    private AgentMessageProjectionService projections;
    private ToolAuditService audits;
    /** IA-3 过期计数断言手柄(P4 差距收口)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics metrics =
            new com.inneragent.platform.metrics.IaBusinessMetrics(
                    new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
    private AgentConfirmationExpiryCoordinator coordinator;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        runMapper = mock(AgentRunMapper.class);
        eventMapper = mock(AgentEventMapper.class);
        terminals = mock(RunTerminalCoordinator.class);
        projections = mock(AgentMessageProjectionService.class);
        audits = mock(ToolAuditService.class);
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        AgentRuntimeSchedulers schedulers = mock(AgentRuntimeSchedulers.class);
        when(schedulers.journal()).thenReturn(Schedulers.immediate());
        ObjectProvider<com.inneragent.agent.mcp.McpToolCatalog> toolCatalogs =
                mock(ObjectProvider.class);
        coordinator = new AgentConfirmationExpiryCoordinator(
                runMapper,
                eventMapper,
                objectMapper,
                terminals,
                projections,
                new AgentEventEnvelopeSanitizer(objectMapper),
                schedulers,
                audits,
                toolCatalogs,
                metrics);
    }

    @Test
    void expiredApprovalTerminatesAsCancelledAndProjectsTheNotice() {
        AgentRun run = waitingRun(Instant.now().minusSeconds(1));
        when(eventMapper.selectConfirmationCandidate("run-1", "reply-1"))
                .thenReturn(candidate());
        when(terminals.terminateSystem(
                any(RunTerminalRequest.class),
                eq(SystemTerminalActor.CONFIRMATION_EXPIRER)))
                .thenAnswer(invocation -> {
                    RunTerminalRequest request = invocation.getArgument(0);
                    return Mono.just(Optional.of(new CommittedAgentEvent(
                            9,
                            run.getRunId(),
                            9,
                            request.terminalEnvelope(),
                            Instant.now())));
                });
        when(projections.projectThrough("run-1", 9)).thenReturn(Mono.empty());

        StepVerifier.create(coordinator.expireIfNeeded(run))
                .expectNext(true)
                .verifyComplete();

        ArgumentCaptor<RunTerminalRequest> request =
                ArgumentCaptor.forClass(RunTerminalRequest.class);
        verify(terminals).terminateSystem(
                request.capture(), eq(SystemTerminalActor.CONFIRMATION_EXPIRER));
        assertThat(request.getValue().terminalStatus())
                .isEqualTo(AgentRunStatus.CANCELLED);
        assertThat(request.getValue().terminalEnvelope().payload().path("content").asText())
                .isEqualTo(AgentConfirmationExpiryCoordinator.MESSAGE);
        assertThat(request.getValue().terminalEnvelope().payload()
                .path("pendingToolCalls").get(0).path("toolCallId").asText())
                .isEqualTo("tool-1");

        // 审计先于终止决策(fail-closed 次序),decision=denied + source=expired
        InOrder decisionOrder = inOrder(audits, terminals);
        decisionOrder.verify(audits).append(any());
        decisionOrder.verify(terminals).terminateSystem(
                any(RunTerminalRequest.class), eq(SystemTerminalActor.CONFIRMATION_EXPIRER));
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(audits).append(audit.capture());
        ToolAuditService.ToolAuditEntry row = audit.getValue();
        assertThat(row.decision()).isEqualTo("denied");
        assertThat(row.decisionSource()).isEqualTo(ToolDecisionSource.EXPIRED.code());
        assertThat(row.runId()).isEqualTo("run-1");
        assertThat(row.userId()).isEqualTo(42L);
        assertThat(row.toolFqn()).isEqualTo("save_storyboard_scene_shots");
        assertThat(row.paramsMaskedJson()).contains("shotId");
        assertThat(row.appId()).isEqualTo(1L);

        // IA-3 过期终态业务计数与审计同点位:decision=expired/source=expired
        assertThat(metrics.counterValue("ia.confirmation",
                "app", "1", "decision", "expired", "source", "expired"))
                .isEqualTo(1.0);

        verify(projections).projectThrough("run-1", 9);
    }

    @Test
    @DisplayName("双路径:expireAuthorized(确认端点探视)同样落 denied/expired 审计")
    void expireAuthorizedPathAlsoAuditsExpiredDecision() {
        AgentRun run = waitingRun(Instant.now().minusSeconds(1));
        when(runMapper.selectAuthorizedByRunId("run-1", 42L)).thenReturn(run);
        when(eventMapper.selectConfirmationCandidate("run-1", "reply-1"))
                .thenReturn(candidate());
        when(terminals.terminateSystem(
                any(RunTerminalRequest.class),
                eq(SystemTerminalActor.CONFIRMATION_EXPIRER)))
                .thenAnswer(invocation -> Mono.just(Optional.empty()));

        StepVerifier.create(coordinator.expireAuthorized("run-1", "reply-1", 42L))
                .expectNext(false)
                .verifyComplete();

        ArgumentCaptor<ToolAuditService.ToolAuditEntry> audit =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(audits).append(audit.capture());
        assertThat(audit.getValue().decision()).isEqualTo("denied");
        assertThat(audit.getValue().decisionSource())
                .isEqualTo(ToolDecisionSource.EXPIRED.code());
    }

    @Test
    @DisplayName("fail-closed:审计写入失败 → 过期裁决不生效,运行保持等待")
    void auditFailureAbortsExpiryDecision() {
        AgentRun run = waitingRun(Instant.now().minusSeconds(1));
        when(eventMapper.selectConfirmationCandidate("run-1", "reply-1"))
                .thenReturn(candidate());
        doThrow(new RuntimeException("audit down"))
                .when(audits).append(any(ToolAuditService.ToolAuditEntry.class));

        StepVerifier.create(coordinator.expireIfNeeded(run))
                .expectError(RuntimeException.class)
                .verify();

        verify(terminals, never()).terminateSystem(any(), any());
        verify(projections, never()).projectThrough(any(), Mockito.anyLong());
    }

    @Test
    void activeApprovalRemainsPending() {
        AgentRun run = waitingRun(Instant.now().plusSeconds(60));

        StepVerifier.create(coordinator.expireIfNeeded(run))
                .expectNext(false)
                .verifyComplete();

        verify(terminals, never()).terminateSystem(any(), any());
        verifyNoInteractions(audits);
    }

    /** 待审批工具载荷(与 DurableAgentWaitingStateService 写入形状一致)。 */
    private AgentEvent candidate() {
        String pendingToolCalls = """
                [{"toolCallId":"tool-1","toolName":"save_storyboard_scene_shots",\
                "argumentsPreview":"{\\"shotId\\":7}"}]
                """;
        return AgentEvent.builder()
                .runId("run-1")
                .rawEventType("REQUIRE_USER_CONFIRM")
                .payloadJson(JsonNodeFactory.instance.objectNode()
                        .put("pendingToolCallsJson", pendingToolCalls)
                        .toString())
                .build();
    }

    private AgentRun waitingRun(Instant expiresAt) {
        return AgentRun.builder()
                .runId("run-1")
                .conversationId("conversation-1")
                .userId(42L)
                .status(AgentRunStatus.WAITING_CONFIRMATION.name())
                .waitingReplyId("reply-1")
                .waitExpiresAt(LocalDateTime.ofInstant(expiresAt, ZoneOffset.UTC))
                .deadlineAt(LocalDateTime.ofInstant(expiresAt, ZoneOffset.UTC))
                .agentStateSessionId("session-1")
                .nextSequence(9L)
                .build();
    }
}
