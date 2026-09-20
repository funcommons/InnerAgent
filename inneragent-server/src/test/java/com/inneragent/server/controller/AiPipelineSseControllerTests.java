package com.inneragent.server.controller;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import com.inneragent.server.controller.vo.PipelineRunStatusRespVO;
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

class AiPipelineSseControllerTests {

    private static final long CURRENT_USER_ID = 42L;

    /**
     * 测试内联异常 advice:等价融光 GlobalExceptionHandler 对 BusinessException 的映射
     * (HTTP 状态取 code 可解析值,非 2xx/3xx 时回退 500)。main 侧 GlobalExceptionHandler
     * 未随 T2 移植(P1 工单登记),此处仅保留本测试所需的分支。
     */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class TestExceptionAdvice {

        @org.springframework.web.bind.annotation.ExceptionHandler(BusinessException.class)
        org.springframework.http.ResponseEntity<CommonResult<?>> handleBusinessException(
                BusinessException e) {
            org.springframework.http.HttpStatus status =
                    org.springframework.http.HttpStatus.resolve(e.getCode());
            if (status == null || status.is2xxSuccessful() || status.is3xxRedirection()) {
                status = org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR;
            }
            return org.springframework.http.ResponseEntity.status(status)
                    .body(CommonResult.error(e.getCode(), e.getMessage()));
        }
    }

    private AgentScopePipelineRunService pipelineRuns;
    private AgentRunQueryService queries;
    private AgentRunReplayService replay;
    private CancellationCoordinator cancellations;
    private AgentConfirmationService confirmations;
    private AgentConfirmationExpiryCoordinator confirmationExpiry;
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
                confirmationExpiry);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new TestExceptionAdvice())
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
    void expiresElapsedConfirmationForCurrentUser() throws Exception {
        when(confirmationExpiry.expireAuthorized(
                "run-1", "reply-1", CURRENT_USER_ID))
                .thenReturn(Mono.just(true));

        MvcResult pending = mockMvc.perform(post("/api/ai/pipeline/confirm/expire")
                        .contentType("application/json")
                        .content("{\"runId\":\"run-1\",\"replyId\":\"reply-1\"}"))
                .andExpect(request().asyncStarted())
                .andReturn();
        mockMvc.perform(asyncDispatch(pending))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));

        verify(confirmationExpiry).expireAuthorized(
                "run-1", "reply-1", CURRENT_USER_ID);
    }

    @Test
    void reconnectWritesStandardIdEventAndDataFrames() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        CommittedAgentEvent committed = event("run-1", 8, "CONTENT", "hello");
        AiChatStreamRespVO projection = projection(
                "run-1", 8, "CONTENT", "hello", false);
        when(queries.resolveAuthorizedTarget(
                "run-1", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-1", 7)).thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection));

        MvcResult result = dispatch(mockMvc.perform(get(
                        "/api/ai/pipeline/reconnect")
                .param("runId", "run-1")
                .param("afterSequence", "7")
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
    void reconnectRejectsConflictingHeaderAndQueryCursor() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.resolveAuthorizedTarget(
                "run-1", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));

        MvcResult pending = mockMvc.perform(get("/api/ai/pipeline/reconnect")
                        .param("runId", "run-1")
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
    void reconnectRejectsHeaderForAnotherRun() throws Exception {
        AgentRun run = run("run-1", "conversation-1", AgentRunStatus.RUNNING);
        when(queries.resolveAuthorizedTarget(
                "run-1", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));

        MvcResult pending = mockMvc.perform(get("/api/ai/pipeline/reconnect")
                        .param("runId", "run-1")
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
        when(queries.resolveAuthorizedTarget(
                "foreign-run", null, CURRENT_USER_ID))
                .thenReturn(Mono.error(new BusinessException(
                        404, "Agent run does not exist")));

        MvcResult pending = mockMvc.perform(get("/api/ai/pipeline/reconnect")
                        .param("runId", "foreign-run"))
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
        when(queries.resolveAuthorizedTarget(
                "run-terminal", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));
        when(replay.replayThenLive("run-terminal", 0))
                .thenReturn(Flux.just(committed));
        when(queries.project(run, committed)).thenReturn(Mono.just(projection));

        MvcResult result = dispatch(mockMvc.perform(get(
                        "/api/ai/pipeline/reconnect")
                .param("runId", "run-terminal")));

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

        MvcResult result = dispatch(mockMvc.perform(post("/api/ai/pipeline/run")
                .contentType("application/json")
                .content("{\"conversationId\":\"conversation-start\",\"message\":\"hi\"}")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-start:1")
                .contains("data:");
        verify(queries).authorizeConversationForStart(
                "conversation-start", CURRENT_USER_ID);
    }

    @Test
    void continueFailedStreamsFramesAndUsesCurrentUser() throws Exception {
        AiChatStreamRespVO projection = projection(
                "run-continued", 1, "CONTENT", "continued", false);
        when(pipelineRuns.streamContinuation(
                "conversation-failed", CURRENT_USER_ID))
                .thenReturn(Flux.just(projection));

        MvcResult result = dispatch(mockMvc.perform(post(
                        "/api/ai/pipeline/continue")
                .param("conversationId", "conversation-failed")));

        assertThat(result.getResponse().getContentAsString())
                .contains("id:run-continued:1")
                .contains("event:pipeline-event")
                .contains("\"content\":\"continued\"");
        verify(pipelineRuns).streamContinuation(
                "conversation-failed", CURRENT_USER_ID);
    }

    @Test
    void cancelAndStatusUseTheCurrentUserAuthorizedRun() {
        AgentRun run = run("run-ops", "conversation-ops", AgentRunStatus.RUNNING);
        when(queries.resolveAuthorizedTarget(
                "run-ops", null, CURRENT_USER_ID)).thenReturn(Mono.just(run));
        when(cancellations.cancel("run-ops", CURRENT_USER_ID))
                .thenReturn(Mono.just(AgentRunStatus.CANCEL_REQUESTED));
        PipelineRunStatusRespVO status = new PipelineRunStatusRespVO(
                "run-ops", "CANCEL_REQUESTED", 4, null, null);
        when(queries.status("run-ops", null, CURRENT_USER_ID))
                .thenReturn(Mono.just(status));

        StepVerifier.create(controller.cancel("run-ops", null))
                .assertNext(response -> assertThat(response.getData()).isTrue())
                .verifyComplete();
        StepVerifier.create(controller.getStatus("run-ops", null))
                .assertNext(response -> assertThat(response.getData())
                        .isEqualTo(status))
                .verifyComplete();

        verify(cancellations).cancel("run-ops", CURRENT_USER_ID);
        verify(queries).status("run-ops", null, CURRENT_USER_ID);
    }

    @Test
    void confirmationUsesCurrentUserAndResumesTheWaitingRun() {
        ToolConfirmationReqVO request = new ToolConfirmationReqVO();
        request.setRunId("run-confirm");
        request.setReplyId("reply-confirm");
        ToolConfirmationReqVO.DecisionVO decision = new ToolConfirmationReqVO.DecisionVO();
        decision.setToolCallId("call-1");
        decision.setApproved(true);
        request.setDecisions(List.of(decision));
        when(confirmations.respond(request, CURRENT_USER_ID)).thenReturn(Mono.empty());

        StepVerifier.create(controller.confirm(request))
                .assertNext(response -> assertThat(response.getData()).isTrue())
                .verifyComplete();

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
