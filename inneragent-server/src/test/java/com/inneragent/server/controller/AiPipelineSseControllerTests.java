package com.inneragent.server.controller;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import com.inneragent.server.controller.vo.PipelineRunStatusRespVO;
import com.inneragent.server.controller.vo.RunningPipelineRunRespVO;
import com.inneragent.server.controller.vo.ToolConfirmationReqVO;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.run.AgentRunQueryService;
import com.inneragent.agent.run.AgentRunReplayService;
import com.inneragent.agent.run.CancellationCoordinator;
import com.inneragent.agent.run.AgentConfirmationExpiryCoordinator;
import com.inneragent.agent.run.AgentConfirmationService;
import com.inneragent.agent.run.PipelineCursorParser;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * [adapt] P1-T3b:断言 /ia/api/v1/runs* 契约(SDK runs.ts 已按该契约发请求)。
 * P1 遗留台账①②:使用生产侧 GlobalExceptionHandler——events 收到跨 run/冲突的
 * Last-Event-ID 时 PipelineCursorParser 抛 BusinessException(400) → HTTP 400。
 */
class AiPipelineSseControllerTests {

    private static final long CURRENT_USER_ID = 42L;

    private AgentScopePipelineRunService pipelineRuns;
    private AgentRunQueryService queries;
    private AgentRunReplayService replay;
    private CancellationCoordinator cancellations;
    private AgentConfirmationService confirmations;
    private AgentConfirmationExpiryCoordinator confirmationExpiry;
    /** IA-4 重连计数断言手柄(P4 差距收口)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics businessMetrics =
            new com.inneragent.platform.metrics.IaBusinessMetrics(
                    new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
    private AiPipelineController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        pipelineRuns = mock(AgentScopePipelineRunService.class);
        queries = mock(AgentRunQueryService.class);
        replay = mock(AgentRunReplayService.class);
        cancellations = mock(CancellationCoordinator.class);
        confirmations = mock(AgentConfirmationService.class);
        confirmationExpiry = mock(AgentConfirmationExpiryCoordinator.class);
        controller = new AiPipelineController(
                pipelineRuns,
                queries,
                replay,
                new PipelineCursorParser(),
                cancellations,
                confirmations,
                confirmationExpiry,
                businessMetrics);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        SecurityUserDetails user = new SecurityUserDetails(
                CURRENT_USER_ID, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        user, null, user.getAuthorities()));
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void expireTakesRunIdFromContractPath() throws Exception {
        when(confirmationExpiry.expireAuthorized(
                "run-1", "reply-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(true));

        MvcResult pending = mockMvc.perform(post("/ia/api/v1/runs/run-1/confirm/expire")
                        .contentType("application/json")
                        // SDK expireRunConfirmation 请求体仅携带 replyId
                        .content("{\"replyId\":\"reply-1\"}"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));

        verify(confirmationExpiry).expireAuthorized(
                "run-1", "reply-1", CURRENT_USER_ID);
    }

    @Test
    void eventsReplayFromLastEventIdHeaderOnly() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        CommittedAgentEvent committed = event("run-1", 8, "CONTENT", "hello");
        AiChatStreamRespVO projection = projection(
                "run-1", 8, "CONTENT", "hello", false);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 7)).thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection));

        // SDK reconnectRunStream 只发 Last-Event-ID 头,不带 afterSequence 查询参数
        MvcResult result = dispatch(mockMvc.perform(get(
                        "/ia/api/v1/runs/run-1/events")
                .header("Last-Event-ID", "run-1:7")));

        String wire = result.getResponse().getContentAsString();
        assertThat(wire)
                .contains("id:run-1:8")
                .contains("event:pipeline-event")
                .contains("data:")
                .contains("\"runId\":\"run-1\"")
                .contains("\"sequence\":8")
                .contains("\"content\":\"hello\"")
                .doesNotContain("\"parentToolCallId\":null");
        verify(replay).replayThenLive("run-1", 7);
    }

    @Test
    void eventsWithoutHeaderReplayFromSequenceZero() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        CommittedAgentEvent committed = event("run-1", 1, "CONTENT", "hi");
        AiChatStreamRespVO projection = projection(
                "run-1", 1, "CONTENT", "hi", false);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 0)).thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection));

        MvcResult result = dispatch(mockMvc.perform(get(
                "/ia/api/v1/runs/run-1/events")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-1:1")
                .contains("\"content\":\"hi\"");
        verify(replay).replayThenLive("run-1", 0);
    }

    @Test
    void reconnectCompletionCountsResumedSessionMetric() {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        CommittedAgentEvent committed = event("run-1", 8, "CONTENT", "hello");
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 7)).thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection(
                "run-1", 8, "CONTENT", "hello", false)));

        // 重连(带 Last-Event-ID)且流正常完结 = resumed(终态事件送达追平)
        StepVerifier.create(controller.events("run-1", null, "run-1:7"))
                .expectNextCount(1)
                .verifyComplete();

        assertThat(businessMetrics.counterValue("ia.reconnect",
                "app", "1", "result", "resumed")).isEqualTo(1.0);
        assertThat(businessMetrics.counterValue("ia.reconnect",
                "app", "1", "result", "failed")).isEqualTo(0.0);
    }

    @Test
    void reconnectFailureCountsFailedSessionMetric() {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 7))
                .thenReturn(Flux.error(new IllegalStateException("stream broken")));

        StepVerifier.create(controller.events("run-1", null, "run-1:7"))
                .verifyError();

        assertThat(businessMetrics.counterValue("ia.reconnect",
                "app", "1", "result", "failed")).isEqualTo(1.0);
    }

    @Test
    void freshConnectWithoutCursorIsNotCountedAsReconnect() {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 0)).thenReturn(Flux.empty());

        StepVerifier.create(controller.events("run-1", null, null))
                .verifyComplete();

        assertThat(businessMetrics.counterValue("ia.reconnect",
                "app", "1", "result", "resumed")).isEqualTo(0.0);
        assertThat(businessMetrics.counterValue("ia.reconnect",
                "app", "1", "result", "failed")).isEqualTo(0.0);
    }

    @Test
    void eventsRejectConflictingHeaderAndQueryCursor() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));

        MvcResult pending = mockMvc.perform(get("/ia/api/v1/runs/run-1/events")
                        .param("afterSequence", "7")
                        .header("Last-Event-ID", "run-1:8"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
        verify(replay, never()).replayThenLive("run-1", 7);
    }

    @Test
    void eventsRejectHeaderForAnotherRun() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.requireAuthorizedRun("run-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));

        MvcResult pending = mockMvc.perform(get("/ia/api/v1/runs/run-1/events")
                        .header("Last-Event-ID", "run-2:0"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
        verify(replay, never()).replayThenLive("run-1", 0);
    }

    @Test
    void crossUserRunIsHiddenAsHttp404() throws Exception {
        when(queries.requireAuthorizedRun("foreign-run", CURRENT_USER_ID))
                .thenReturn(Mono.error(new BusinessException(
                        404, "Agent run does not exist")));

        MvcResult pending = mockMvc.perform(get("/ia/api/v1/runs/foreign-run/events"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void terminalRunStillReplaysItsTerminalFrame() throws Exception {
        AgentRun run = run("run-terminal", "conversation-terminal",
                AgentRunStatus.COMPLETED);
        CommittedAgentEvent committed = event(
                "run-terminal", 3, "DONE", null);
        AiChatStreamRespVO projection = projection(
                "run-terminal", 3, "DONE", null, true);
        when(queries.requireAuthorizedRun("run-terminal", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-terminal", 0))
                .thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection));

        MvcResult result = dispatch(mockMvc.perform(get(
                "/ia/api/v1/runs/run-terminal/events")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-terminal:3")
                .contains("\"outputType\":\"DONE\"")
                .contains("\"finished\":true");
    }

    @Test
    void startAuthorizesConversationBeforeOpeningObserverAndAddsIds() throws Exception {
        AiChatStreamRespVO projection = projection(
                "run-start", 1, "CONTENT", "started", false);
        when(queries.authorizeConversationForStart(
                "conversation-start", CURRENT_USER_ID)).thenReturn(Mono.empty());
        when(pipelineRuns.stream(
                org.mockito.ArgumentMatchers.any(AiChatReqVO.class),
                org.mockito.ArgumentMatchers.eq(CURRENT_USER_ID)))
                .thenReturn(Flux.just(projection));

        MvcResult result = dispatch(mockMvc.perform(post("/ia/api/v1/runs")
                .contentType("application/json")
                // 契约字段:context{page,object} 由调用方注入,落运行上下文
                .content("{\"conversationId\":\"conversation-start\",\"message\":\"hi\","
                        + "\"context\":{\"page\":{\"id\":\"p-1\"},\"object\":{\"type\":\"doc\"}}}")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-start:1")
                .contains("data:");
        verify(queries).authorizeConversationForStart(
                "conversation-start", CURRENT_USER_ID);
    }

    @Test
    void continueTakesRunIdFromContractPath() throws Exception {
        AiChatStreamRespVO projection = projection(
                "run-continued", 1, "CONTENT", "continued", false);
        when(pipelineRuns.streamContinuation(
                "run-failed", CURRENT_USER_ID))
                .thenReturn(Flux.just(projection));

        MvcResult result = dispatch(mockMvc.perform(post(
                        "/ia/api/v1/runs/run-failed/continue")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-continued:1")
                .contains("event:pipeline-event")
                .contains("\"content\":\"continued\"");
        verify(pipelineRuns).streamContinuation(
                "run-failed", CURRENT_USER_ID);
    }

    @Test
    void cancelByRunIdUsesTheCurrentUserAuthorizedRun() {
        AgentRun run = run("run-ops", "conversation-ops", AgentRunStatus.RUNNING);
        when(queries.resolveAuthorizedTarget(
                "run-ops", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));
        when(cancellations.cancel("run-ops", CURRENT_USER_ID))
                .thenReturn(Mono.just(AgentRunStatus.CANCEL_REQUESTED));

        StepVerifier.create(controller.cancel("run-ops"))
                .assertNext(response -> assertThat(response.getData()).isTrue())
                .verifyComplete();

        verify(cancellations).cancel("run-ops", CURRENT_USER_ID);
    }

    @Test
    void cancelFallsBackToConversationLookupForOptimisticSessions() {
        AgentRun run = run("run-opt", "conversation-optimistic",
                AgentRunStatus.RUNNING);
        when(queries.resolveAuthorizedTarget(
                null, "conversation-optimistic", CURRENT_USER_ID))
                .thenReturn(Mono.just(run));
        when(cancellations.cancel("run-opt", CURRENT_USER_ID))
                .thenReturn(Mono.just(AgentRunStatus.CANCEL_REQUESTED));

        StepVerifier.create(controller.cancelByConversation("conversation-optimistic"))
                .assertNext(response -> assertThat(response.getData()).isTrue())
                .verifyComplete();

        verify(cancellations).cancel("run-opt", CURRENT_USER_ID);
    }

    @Test
    void statusByRunIdUsesTheCurrentUser() {
        PipelineRunStatusRespVO status = new PipelineRunStatusRespVO(
                "run-ops", "CANCEL_REQUESTED", 4, null, null);
        when(queries.status("run-ops", null, CURRENT_USER_ID))
                .thenReturn(Mono.just(status));

        StepVerifier.create(controller.getStatus("run-ops"))
                .assertNext(response -> assertThat(response.getData())
                        .isEqualTo(status))
                .verifyComplete();

        verify(queries).status("run-ops", null, CURRENT_USER_ID);
    }

    @Test
    void runningListSupportsOptionalConversationFilter() {
        List<RunningPipelineRunRespVO> running = List.of(
                new RunningPipelineRunRespVO(
                        "run-1", "conversation-1", null, "标题", "assistant",
                        "RUNNING", 3, null, Instant.parse("2026-07-21T12:00:00Z")));
        when(queries.listRunning("conversation-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(running));

        StepVerifier.create(controller.listRunning("conversation-1"))
                .assertNext(response -> assertThat(response.getData())
                        .singleElement()
                        .satisfies(item -> {
                            // SDK RunningRun 解析形状:runId/conversationId/status/lastSequence
                            assertThat(item.runId()).isEqualTo("run-1");
                            assertThat(item.conversationId()).isEqualTo("conversation-1");
                            assertThat(item.status()).isEqualTo("RUNNING");
                            assertThat(item.lastSequence()).isEqualTo(3);
                        }))
                .verifyComplete();

        verify(queries).listRunning("conversation-1", CURRENT_USER_ID);
    }

    @Test
    void confirmationUsesCurrentUserAndTakesRunIdFromPath() {
        ToolConfirmationReqVO request = new ToolConfirmationReqVO();
        // SDK confirmRunTools 请求体仅携带 replyId + decisions
        request.setReplyId("reply-confirm");
        ToolConfirmationReqVO.DecisionVO decision = new ToolConfirmationReqVO.DecisionVO();
        decision.setToolCallId("call-1");
        decision.setApproved(true);
        request.setDecisions(List.of(decision));
        when(confirmations.respond(request, CURRENT_USER_ID)).thenReturn(Mono.empty());

        StepVerifier.create(controller.confirm("run-confirm", request))
                .assertNext(response -> assertThat(response.getData()).isTrue())
                .verifyComplete();

        assertThat(request.getRunId()).isEqualTo("run-confirm");
        verify(confirmations).respond(request, CURRENT_USER_ID);
    }

    private MvcResult dispatch(
            org.springframework.test.web.servlet.ResultActions request)
            throws Exception {
        MvcResult pending = request
                .andExpect(request().asyncStarted())
                .andReturn();
        return mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(
                        "text/event-stream"))
                .andReturn();
    }

    private AgentRun run(
            String runId, String conversationId, AgentRunStatus status) {
        return AgentRun.builder()
                .runId(runId)
                .conversationId(conversationId)
                .userId(CURRENT_USER_ID)
                .status(status.name())
                .nextSequence(9L)
                .deadlineAt(LocalDateTime.now().plusMinutes(5))
                .startedAt(LocalDateTime.now())
                .build();
    }

    private CommittedAgentEvent event(
            String runId,
            long sequence,
            String outputType,
            String content) {
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", outputType)
                .put("finished", "DONE".equals(outputType));
        if (content != null) {
            payload.put("content", content);
        }
        AgentEventEnvelope envelope = new AgentEventEnvelope(
                "raw-" + sequence,
                "DONE".equals(outputType) ? "AGENT_END" : "TEXT_BLOCK_DELTA",
                "main",
                null,
                null,
                null,
                null,
                null,
                outputType,
                payload,
                Instant.parse("2026-07-21T12:00:00Z"));
        return new CommittedAgentEvent(
                sequence, runId, sequence, envelope,
                Instant.parse("2026-07-21T12:00:01Z"));
    }

    private AiChatStreamRespVO projection(
            String runId,
            long sequence,
            String outputType,
            String content,
            boolean finished) {
        return new AiChatStreamRespVO()
                .setSchemaVersion(1)
                .setRunId(runId)
                .setSequence(sequence)
                .setOutputType(outputType)
                .setContent(content)
                .setFinished(finished);
    }
}
