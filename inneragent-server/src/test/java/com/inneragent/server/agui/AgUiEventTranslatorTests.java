package com.inneragent.server.agui;

import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * [new] E2 AG-UI 适配器红测试(测试先行:实现落地前 {@code AgUiEventTranslator} /
 * {@code AgUiRunStream} 均不存在,本类处于编译红态)。
 *
 * <p>锁定的契约:输出形态为 {@code List<Map<String,Object>>},一个 Map = 一个 AG-UI
 * 事件,wire 键名与 AG-UI 1.0 一致,以 {@code type} 区分;{@link AgUiEventTranslator}
 * 纯函数逐帧映射,消息/推理边界与 RUN_STARTED 由有状态的 {@link AgUiRunStream} 合成
 * (每次订阅 new 一个,只收 {@code onFrame});确认/外部执行四类控制帧各合成 CUSTOM,
 * name 统一 {@code inneragent.<语义>} 前缀,value 为 Map(固定候选键 {runId,
 * controlType, toolCallId, toolName, toolResult, pendingToolCalls, decisions,
 * expiresAt, error},仅收非空项,VO 载荷原样保留);拍板:ERROR 与 CANCELLED 都映射
 * RUN_ERROR,以 code=error / cancelled 区分。
 */
class AgUiEventTranslatorTests {

    private static final Instant EXPIRES_AT = Instant.parse("2026-10-29T08:30:00Z");

    private final AgUiEventTranslator translator = new AgUiEventTranslator();

    // ---- 直映/拆帧:纯函数逐帧映射 ----

    @Test
    void toolCallStartedFrameSplitsIntoOneToolCallStartPerToolCall() {
        AiChatStreamRespVO frame = frame("TOOL_CALL_STARTED")
                .setToolCalls(List.of(
                        toolCall("call-1", "search_kb", ""),
                        toolCall("call-2", "resolve_scope", "")));

        List<Map<String, Object>> events = translator.translate(frame);

        assertThat(types(events)).containsExactly("TOOL_CALL_START", "TOOL_CALL_START");
        assertThat(events.get(0))
                .containsEntry("toolCallId", "call-1")
                .containsEntry("toolCallName", "search_kb");
        assertThat(events.get(1))
                .containsEntry("toolCallId", "call-2")
                .containsEntry("toolCallName", "resolve_scope");
    }

    @Test
    void toolCallFrameEmitsFullArgumentsDeltaThenEndPerToolCall() {
        AiChatStreamRespVO frame = frame("TOOL_CALL")
                .setToolCalls(List.of(
                        toolCall("call-1", "search_kb", "{\"query\":\"kb\"}"),
                        toolCall("call-2", "delete_object", "{\"id\":7}")));

        List<Map<String, Object>> events = translator.translate(frame);

        assertThat(types(events)).containsExactly(
                "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_ARGS", "TOOL_CALL_END");
        assertThat(events.get(0))
                .containsEntry("toolCallId", "call-1")
                .containsEntry("delta", "{\"query\":\"kb\"}");
        assertThat(events.get(1)).containsEntry("toolCallId", "call-1");
        assertThat(events.get(2))
                .containsEntry("toolCallId", "call-2")
                .containsEntry("delta", "{\"id\":7}");
        assertThat(events.get(3)).containsEntry("toolCallId", "call-2");
    }

    @Test
    void toolFinishedFrameEmitsToolCallResultCarryingStatusMetadata() {
        AiChatStreamRespVO frame = frame("TOOL_FINISHED")
                .setToolCallId("call-1")
                .setToolName("search_kb")
                .setToolResult("{\"hits\":3}")
                .setToolStatus("success");

        List<Map<String, Object>> events = translator.translate(frame);

        assertThat(types(events)).containsExactly("TOOL_CALL_RESULT");
        Map<String, Object> result = events.get(0);
        assertThat(result)
                .containsEntry("messageId", "message-1")
                .containsEntry("toolCallId", "call-1")
                .containsEntry("content", "{\"hits\":3}");
        assertThat(result.get("metadata")).isEqualTo(Map.of("toolStatus", "success"));
    }

    @Test
    void subAgentFramesMapChildRunIdAndAgentNameDirectly() {
        List<Map<String, Object>> started = translator.translate(frame("SUB_AGENT_STARTED")
                .setChildRunId("run-child-1")
                .setAgentName("检索子代理")
                .setParentToolCallId("call-1"));
        List<Map<String, Object>> finished = translator.translate(frame("SUB_AGENT_FINISHED")
                .setChildRunId("run-child-1")
                .setAgentName("检索子代理"));

        assertThat(types(started)).containsExactly("SUBAGENT_STARTED");
        assertThat(started.get(0))
                .containsEntry("subagentRunId", "run-child-1")
                .containsEntry("name", "检索子代理")
                .containsEntry("parentToolCallId", "call-1");
        assertThat(types(finished)).containsExactly("SUBAGENT_FINISHED");
        assertThat(finished.get(0))
                .containsEntry("subagentRunId", "run-child-1")
                .containsEntry("name", "检索子代理");
    }

    @Test
    void confirmationRequiredFrameSynthesizesCustomWithFaithfulPayload() {
        AiChatStreamRespVO frame = frame("USER_CONFIRMATION_REQUIRED")
                .setControlType("USER_CONFIRM_REQUIRED")
                .setPendingToolCalls(List.of(new AiChatStreamRespVO.PendingToolCallVO()
                        .setToolCallId("call-1")
                        .setToolName("delete_object")
                        .setArgumentsPreview("{\"id\":7}")))
                .setDecisions(List.of(new AiChatStreamRespVO.ToolConfirmationDecisionVO()
                        .setToolCallId("call-1")
                        .setApproved(Boolean.TRUE)))
                .setExpiresAt(EXPIRES_AT);

        List<Map<String, Object>> events = translator.translate(frame);

        assertThat(types(events)).containsExactly("CUSTOM");
        assertThat(events.get(0)).containsEntry("name", "inneragent.confirmation_required");
        Map<?, ?> payload = (Map<?, ?>) events.get(0).get("value");
        assertThat(payload.get("runId")).isEqualTo("run-1");
        assertThat(payload.get("controlType")).isEqualTo("USER_CONFIRM_REQUIRED");
        assertThat(payload.get("pendingToolCalls")).isEqualTo(frame.getPendingToolCalls());
        assertThat(payload.get("decisions")).isEqualTo(frame.getDecisions());
        assertThat(payload.get("expiresAt")).isEqualTo(EXPIRES_AT);
    }

    @Test
    void remainingControlFramesEachSynthesizeTheirOwnCustomName() {
        Map<String, String> expectedNames = Map.of(
                "EXTERNAL_EXECUTION_REQUIRED", "inneragent.external_execution_required",
                "USER_CONFIRM_RESULT", "inneragent.confirm_result",
                "EXTERNAL_EXECUTION_RESULT", "inneragent.external_execution_result");

        expectedNames.forEach((outputType, expectedName) -> {
            List<Map<String, Object>> events = translator.translate(
                    frame(outputType).setToolCallId("call-9").setToolResult("done"));

            assertThat(types(events)).as(outputType).containsExactly("CUSTOM");
            assertThat(events.get(0)).as(outputType).containsEntry("name", expectedName);
            assertThat(events.get(0).get("value")).as(outputType).isInstanceOf(Map.class);
        });

        Map<?, ?> payload = (Map<?, ?>) translator.translate(
                frame("EXTERNAL_EXECUTION_RESULT")
                        .setToolCallId("call-9")
                        .setToolResult("done")).get(0).get("value");
        assertThat(payload.get("toolCallId")).isEqualTo("call-9");
        assertThat(payload.get("toolResult")).isEqualTo("done");
    }

    @Test
    void doneFrameEmitsKbCitationsCustomBeforeRunFinished() {
        List<AiChatStreamRespVO.KbCitationVO> citations = List.of(
                new AiChatStreamRespVO.KbCitationVO()
                        .setChunkId(11L)
                        .setDocumentId(3L)
                        .setDocumentTitle("接入指南")
                        .setAnchor("§2.1")
                        .setSeq(0));
        AiChatStreamRespVO frame = frame("DONE").setKbCitations(citations);

        List<Map<String, Object>> events = translator.translate(frame);

        assertThat(types(events)).containsExactly("CUSTOM", "RUN_FINISHED");
        assertThat(events.get(0)).containsEntry("name", "inneragent.kb_citations");
        assertThat(events.get(0).get("value")).isEqualTo(citations);
        assertThat(events.get(1)).containsEntry("outcome", "success");
    }

    @Test
    void doneFrameWithoutCitationsEmitsOnlyRunFinished() {
        List<Map<String, Object>> events = translator.translate(frame("DONE"));

        assertThat(types(events)).containsExactly("RUN_FINISHED");
        assertThat(events.get(0)).containsEntry("outcome", "success");
    }

    @Test
    void errorAndCancelledFramesBothMapToRunErrorDistinguishedByCode() {
        List<Map<String, Object>> error = translator.translate(
                frame("ERROR").setError("模型调用超时"));
        List<Map<String, Object>> cancelled = translator.translate(
                frame("CANCELLED").setCancellationReason("用户取消"));

        assertThat(types(error)).containsExactly("RUN_ERROR");
        assertThat(error.get(0))
                .containsEntry("message", "模型调用超时")
                .containsEntry("code", "error");
        assertThat(types(cancelled)).containsExactly("RUN_ERROR");
        assertThat(cancelled.get(0))
                .containsEntry("message", "用户取消")
                .containsEntry("code", "cancelled");
    }

    @Test
    void reasoningAndContentFramesEmitTheirDeltaEventWithFrameMessageId() {
        List<Map<String, Object>> reasoning = translator.translate(
                frame("REASONING").setReasoningContent("先想想"));
        List<Map<String, Object>> content = translator.translate(
                frame("CONTENT").setContent("你好"));

        assertThat(types(reasoning)).containsExactly("REASONING_MESSAGE_CONTENT");
        assertThat(reasoning.get(0))
                .containsEntry("messageId", "message-1")
                .containsEntry("delta", "先想想");
        assertThat(types(content)).containsExactly("TEXT_MESSAGE_CONTENT");
        assertThat(content.get(0))
                .containsEntry("messageId", "message-1")
                .containsEntry("delta", "你好");
    }

    @Test
    void unknownOutputTypeAndNullFramesYieldEmptyListWithoutThrowing() {
        assertThat(translator.translate(frame("TIME_TRAVEL"))).isEmpty();
        assertThat(translator.translate(new AiChatStreamRespVO())).isEmpty();
        assertThat(translator.translate(null)).isEmpty();
    }

    // ---- 有状态合成器:RUN_STARTED 一次性 + 消息/推理边界开合 ----

    @Test
    void runStartedIsSynthesizedExactlyOnceBeforeTheFirstFrame() {
        AgUiRunStream stream = new AgUiRunStream();

        List<Map<String, Object>> first = stream.onFrame(
                frame("CONTENT").setContent("你好"));
        List<Map<String, Object>> second = stream.onFrame(frame("DONE"));

        assertThat(types(first)).startsWith("RUN_STARTED");
        assertThat(first.get(0))
                .containsEntry("threadId", "conversation-1")
                .containsEntry("runId", "run-1");
        assertThat(types(second)).doesNotContain("RUN_STARTED");
    }

    @Test
    void alternatingReasoningAndContentFramesOpenAndCloseTheirOwnBoundaries() {
        AgUiRunStream stream = new AgUiRunStream();
        List<Map<String, Object>> events = new ArrayList<>();

        stream.onFrame(reasoningFrame("m1", "先")).forEach(events::add);
        stream.onFrame(reasoningFrame("m1", "想")).forEach(events::add);
        stream.onFrame(frame("CONTENT").setMessageId("m1").setContent("答案"))
                .forEach(events::add);
        stream.onFrame(reasoningFrame("m1", "补充")).forEach(events::add);
        stream.onFrame(frame("DONE")).forEach(events::add);

        assertThat(types(events)).containsExactly(
                "RUN_STARTED",
                "REASONING_START",
                "REASONING_MESSAGE_CONTENT",
                "REASONING_MESSAGE_CONTENT",
                "REASONING_END",
                "TEXT_MESSAGE_START",
                "TEXT_MESSAGE_CONTENT",
                "TEXT_MESSAGE_END",
                "REASONING_START",
                "REASONING_MESSAGE_CONTENT",
                "REASONING_END",
                "RUN_FINISHED");
        assertThat(events.get(1)).containsEntry("messageId", "m1");
        assertThat(events.get(2)).containsEntry("delta", "先");
        assertThat(events.get(3)).containsEntry("delta", "想");
        assertThat(events.get(4)).containsEntry("messageId", "m1");
        assertThat(events.get(5))
                .containsEntry("messageId", "m1")
                .containsEntry("role", "assistant");
        assertThat(events.get(6)).containsEntry("delta", "答案");
        assertThat(events.get(7)).containsEntry("messageId", "m1");
        assertThat(events.get(10)).containsEntry("messageId", "m1");
        assertThat(events.get(11)).containsEntry("outcome", "success");
    }

    @Test
    void terminalFramesCloseStillOpenBoundariesBeforeTheirOwnEvent() {
        AgUiRunStream stream = new AgUiRunStream();
        List<Map<String, Object>> events = new ArrayList<>();

        stream.onFrame(reasoningFrame("m1", "想想")).forEach(events::add);
        stream.onFrame(frame("ERROR").setError("boom")).forEach(events::add);

        assertThat(types(events)).containsExactly(
                "RUN_STARTED",
                "REASONING_START",
                "REASONING_MESSAGE_CONTENT",
                "REASONING_END",
                "RUN_ERROR");
        assertThat(events.get(4))
                .containsEntry("message", "boom")
                .containsEntry("code", "error");
    }

    // ---- 夹具 ----

    private static AiChatStreamRespVO frame(String outputType) {
        return new AiChatStreamRespVO()
                .setRunId("run-1")
                .setConversationId("conversation-1")
                .setMessageId("message-1")
                .setOutputType(outputType);
    }

    private static AiChatStreamRespVO reasoningFrame(String messageId, String delta) {
        return frame("REASONING")
                .setMessageId(messageId)
                .setReasoningContent(delta);
    }

    private static AiChatStreamRespVO.ToolCallVO toolCall(
            String id, String name, String arguments) {
        return new AiChatStreamRespVO.ToolCallVO()
                .setId(id).setName(name).setArguments(arguments);
    }

    private static List<String> types(List<Map<String, Object>> events) {
        return events.stream().map(event -> String.valueOf(event.get("type"))).toList();
    }
}
