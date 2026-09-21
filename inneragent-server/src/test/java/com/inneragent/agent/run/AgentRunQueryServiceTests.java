package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentConversationMapper;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.platform.repository.ai.AgentEventRepository;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.scheduler.Schedulers;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentRunQueryServiceTests {

    private AgentRunMapper runMapper;
    private AgentEventMapper eventMapper;
    private AgentRunQueryService service;

    @BeforeEach
    void setUp() {
        runMapper = mock(AgentRunMapper.class);
        eventMapper = mock(AgentEventMapper.class);
        AgentRuntimeSchedulers schedulers = mock(AgentRuntimeSchedulers.class);
        when(schedulers.journal()).thenReturn(Schedulers.immediate());
        ObjectMapper objectMapper = new ObjectMapper()
                .findAndRegisterModules()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        service = new AgentRunQueryService(
                runMapper,
                mock(AgentConversationMapper.class),
                eventMapper,
                mock(AgentEventRepository.class),
                objectMapper,
                schedulers,
                mock(AgentConfirmationExpiryCoordinator.class));
    }

    @Test
    void restoresLegacyContentAndOverwritesIdentityFromCommittedEnvelope() {
        AgentRun run = run();
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("runId", "forged-run")
                .put("sequence", 999)
                .put("delta", "hello");
        CommittedAgentEvent event = committed(
                7, "CONTENT", "TEXT_BLOCK_DELTA", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getSchemaVersion()).isEqualTo(1);
                    assertThat(projected.getRunId()).isEqualTo("run-1");
                    assertThat(projected.getSequence()).isEqualTo(7L);
                    assertThat(projected.getConversationId())
                            .isEqualTo("conversation-1");
                    assertThat(projected.getOutputType()).isEqualTo("CONTENT");
                    assertThat(projected.getContent()).isEqualTo("hello");
                    assertThat(projected.getRawEventType())
                            .isEqualTo("TEXT_BLOCK_DELTA");
                    assertThat(projected.getFinished()).isFalse();
                })
                .verifyComplete();
    }

    @Test
    void reconstructsToolArgumentsFromRawJournalDeltas() {
        AgentRun run = run();
        AgentEvent delta = AgentEvent.builder()
                .id(41L)
                .runId("run-1")
                .sequenceNo(5L)
                .rawEventType("TOOL_CALL_DELTA")
                .payloadJson("{\"delta\":\"{\\\"assetId\\\":7}\"}")
                .build();
        when(eventMapper.selectToolDeltas("run-1", "tool-1", 6))
                .thenReturn(List.of(delta));
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("toolCallName", "asset_lookup");
        CommittedAgentEvent event = committed(
                6, "TOOL_CALL", "TOOL_CALL_END", "tool-1", payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getToolCallId()).isEqualTo("tool-1");
                    assertThat(projected.getToolName()).isEqualTo("asset_lookup");
                    assertThat(projected.getToolCalls())
                            .singleElement()
                            .satisfies(tool -> {
                                assertThat(tool.getId()).isEqualTo("tool-1");
                                assertThat(tool.getName()).isEqualTo("asset_lookup");
                                assertThat(tool.getArguments())
                                        .isEqualTo("{\"assetId\":7}");
                            });
                })
                .verifyComplete();
    }

    @Test
    void projectsToolCallStartWithoutReadingIncompleteArguments() {
        AgentRun run = run();
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("toolCallName", "update_script_info");
        CommittedAgentEvent event = committed(
                5, "TOOL_CALL_STARTED", "TOOL_CALL_START", "tool-1", payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType()).isEqualTo("TOOL_CALL_STARTED");
                    assertThat(projected.getToolCallId()).isEqualTo("tool-1");
                    assertThat(projected.getToolName()).isEqualTo("update_script_info");
                    assertThat(projected.getToolCalls())
                            .singleElement()
                            .satisfies(tool -> {
                                assertThat(tool.getId()).isEqualTo("tool-1");
                                assertThat(tool.getName()).isEqualTo("update_script_info");
                                assertThat(tool.getArguments()).isEmpty();
                            });
                })
                .verifyComplete();
    }

    @Test
    void projectsOfficialAgentScopeErrorBlockAsErrorDespiteSuccessEndState() {
        AgentRun run = run();
        AgentEvent delta = AgentEvent.builder()
                .id(42L)
                .runId("run-1")
                .sequenceNo(6L)
                .rawEventType("TOOL_RESULT_TEXT_DELTA")
                .payloadJson("{\"delta\":\"Error: Tool execution failed: invalid input\"}")
                .build();
        when(eventMapper.selectToolDeltas("run-1", "tool-1", 7))
                .thenReturn(List.of(delta));
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("toolCallName", "update_script_info")
                .put("state", "SUCCESS");
        CommittedAgentEvent event = committed(
                7, "TOOL_FINISHED", "TOOL_RESULT_END", "tool-1", payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getToolResult())
                            .isEqualTo("Error: Tool execution failed: invalid input");
                    assertThat(projected.getToolStatus()).isEqualTo("error");
                })
                .verifyComplete();
    }

    @Test
    void projectsExactToolConfirmationDecisions() {
        AgentRun run = run();
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", "USER_CONFIRM_RESULT");
        payload.putArray("pendingToolCalls")
                .addObject()
                .put("toolCallId", "tool-1")
                .put("toolName", "update_script_info")
                .put("argumentsPreview", "{\"scriptId\":1}");
        payload.putArray("decisions")
                .addObject()
                .put("toolCallId", "tool-1")
                .put("approved", false);
        CommittedAgentEvent event = committed(
                7, "USER_CONFIRM_RESULT", "USER_CONFIRM_RESULT", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType())
                            .isEqualTo("USER_CONFIRM_RESULT");
                    assertThat(projected.getPendingToolCalls())
                            .singleElement()
                            .satisfies(tool -> assertThat(tool.getToolCallId())
                                    .isEqualTo("tool-1"));
                    assertThat(projected.getDecisions())
                            .singleElement()
                            .satisfies(decision -> {
                                assertThat(decision.getToolCallId())
                                        .isEqualTo("tool-1");
                                assertThat(decision.getApproved()).isFalse();
                            });
                })
                .verifyComplete();
    }

    @Test
    void hidesMissingOrCrossUserRunAsNotFound() {
        when(runMapper.selectAuthorizedByRunId("foreign-run", 42L))
                .thenReturn(null);

        StepVerifier.create(service.requireAuthorizedRun("foreign-run", 42L))
                .expectErrorSatisfies(failure -> {
                    assertThat(failure).isInstanceOf(BusinessException.class);
                    assertThat(((BusinessException) failure).getCode()).isEqualTo(404);
                })
                .verify();
    }

    /**
     * [adapt] P4-W14 子运行事件携带父层级(03-开发计划 §7.3 验收 4「前端父子
     * 层级渲染」的服务端数据支撑):子运行自身事件流投影出 parentRunId;
     * 镜像进父运行事件流的子事件透出 childRunId——两者均为新增可选字段,
     * 不破既有消费者。
     */
    @Test
    void projectsChildRunHierarchyFields() {
        AgentRun child = run();
        child.setParentRunId("parent-run-1");
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("delta", "child content");
        CommittedAgentEvent event = committed(
                9, "CONTENT", "TEXT_BLOCK_DELTA", null, payload);

        StepVerifier.create(service.project(child, event))
                .assertNext(projected -> {
                    assertThat(projected.getParentRunId()).isEqualTo("parent-run-1");
                    assertThat(projected.getChildRunId()).isNull();
                })
                .verifyComplete();

        AgentRun parent = run();
        ObjectNode mirrored = JsonNodeFactory.instance.objectNode()
                .put("delta", "child content")
                .put("_platformMirroredChildEvent", true)
                .put("childRunId", "child-run-9")
                .put("childSequence", 9L);
        CommittedAgentEvent mirrorEvent = committed(
                12, "CONTENT", "TEXT_BLOCK_DELTA", null, mirrored);

        StepVerifier.create(service.project(parent, mirrorEvent))
                .assertNext(projected -> {
                    assertThat(projected.getParentRunId()).isNull();
                    assertThat(projected.getChildRunId()).isEqualTo("child-run-9");
                })
                .verifyComplete();
    }

    @Test
    void doneEventCarriesKbCitationsFromRunLedger() {
        // P4-W14 引用溯源:终态 DONE 事件投影回填运行行 kb_citations_json
        // (chunk id/来源标题等最小字段集),供前端来源展示。
        AgentRun run = runWithCitations("""
                [{"chunkId":42,"documentId":7,"documentTitle":"员工手册.md",
                  "anchor":"请假流程","seq":3}]""");
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", "DONE")
                .put("finished", true);
        CommittedAgentEvent event = committed(9, "DONE", "AGENT_END", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType()).isEqualTo("DONE");
                    assertThat(projected.getKbCitations()).hasSize(1);
                    assertThat(projected.getKbCitations().getFirst().getChunkId())
                            .isEqualTo(42L);
                    assertThat(projected.getKbCitations().getFirst().getDocumentId())
                            .isEqualTo(7L);
                    assertThat(projected.getKbCitations().getFirst().getDocumentTitle())
                            .isEqualTo("员工手册.md");
                    assertThat(projected.getKbCitations().getFirst().getAnchor())
                            .isEqualTo("请假流程");
                    assertThat(projected.getKbCitations().getFirst().getSeq()).isEqualTo(3);
                })
                .verifyComplete();
    }

    @Test
    void nonDoneEventsDoNotCarryKbCitations() {
        // 引用只随终态 DONE 回填:CONTENT 等中间事件不携带(可选字段,null)
        AgentRun run = runWithCitations("""
                [{"chunkId":42,"documentId":7,"documentTitle":"员工手册.md",
                  "anchor":null,"seq":3}]""");
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("delta", "hello");
        CommittedAgentEvent event = committed(7, "CONTENT", "TEXT_BLOCK_DELTA", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType()).isEqualTo("CONTENT");
                    assertThat(projected.getKbCitations()).isNull();
                })
                .verifyComplete();
    }

    @Test
    void doneEventWithoutKbLedgerStaysNullForBackwardCompatibility() {
        // 旧运行/无命中运行:kb_citations_json 为 NULL → kbCitations 不出现
        // (N-1 兼容,不破既有消费者)
        AgentRun run = run();
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", "DONE")
                .put("finished", true);
        CommittedAgentEvent event = committed(9, "DONE", "AGENT_END", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType()).isEqualTo("DONE");
                    assertThat(projected.getKbCitations()).isNull();
                })
                .verifyComplete();
    }

    @Test
    void corruptedKbLedgerDegradesToNullInsteadOfProjectionFailure() {
        AgentRun run = runWithCitations("{\"chunkId\": not-json");
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", "DONE")
                .put("finished", true);
        CommittedAgentEvent event = committed(9, "DONE", "AGENT_END", null, payload);

        StepVerifier.create(service.project(run, event))
                .assertNext(projected -> {
                    assertThat(projected.getOutputType()).isEqualTo("DONE");
                    assertThat(projected.getKbCitations()).isNull();
                })
                .verifyComplete();
    }

    private AgentRun run() {
        return AgentRun.builder()
                .runId("run-1")
                .conversationId("conversation-1")
                .userId(42L)
                .status("RUNNING")
                .nextSequence(8L)
                .deadlineAt(LocalDateTime.now().plusMinutes(5))
                .startedAt(LocalDateTime.now())
                .build();
    }

    private AgentRun runWithCitations(String citationsJson) {
        AgentRun run = run();
        run.setKbCitationsJson(citationsJson);
        return run;
    }

    private CommittedAgentEvent committed(
            long sequence,
            String outputType,
            String rawEventType,
            String toolCallId,
            ObjectNode payload) {
        AgentEventEnvelope envelope = new AgentEventEnvelope(
                "raw-" + sequence,
                rawEventType,
                "main",
                "reply-1",
                "block-1",
                toolCallId,
                null,
                null,
                outputType,
                payload,
                Instant.parse("2026-07-21T12:00:00Z"));
        return new CommittedAgentEvent(
                sequence, "run-1", sequence, envelope,
                Instant.parse("2026-07-21T12:00:01Z"));
    }
}
