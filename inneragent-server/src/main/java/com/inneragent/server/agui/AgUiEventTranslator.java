package com.inneragent.server.agui;

import com.inneragent.server.controller.vo.AiChatStreamRespVO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AG-UI 事件适配器 · 纯帧翻译(批次 E2):平台 14 帧逐帧直映 AG-UI 1.0 事件,
 * 一个 Map = 一个事件、以 {@code type} 判别;RUN_STARTED 与消息/推理起止边界
 * 由有状态的 {@link AgUiRunStream} 合成。CUSTOM 统一 {@code inneragent.<语义>}
 * 前缀,value 只收固定候选键非空项;ERROR/CANCELLED 同映 RUN_ERROR 以 code
 * 区分;未知 outputType/空帧 → 空列表。
 */
public class AgUiEventTranslator {

    private static final String CUSTOM_PREFIX = "inneragent.";

    /** 控制帧 → CUSTOM 语义名(四类确认/外部执行帧)。 */
    private static final Map<String, String> CONTROL_CUSTOM_NAMES = Map.of(
            "USER_CONFIRMATION_REQUIRED", "confirmation_required",
            "EXTERNAL_EXECUTION_REQUIRED", "external_execution_required",
            "USER_CONFIRM_RESULT", "confirm_result",
            "EXTERNAL_EXECUTION_RESULT", "external_execution_result");

    /** 纯函数直映:一帧 → 零或多个 AG-UI 事件。 */
    public List<Map<String, Object>> translate(AiChatStreamRespVO frame) {
        if (frame == null || frame.getOutputType() == null) {
            return List.of();
        }
        return switch (frame.getOutputType()) {
            case "REASONING" -> deltaEvent(
                    "REASONING_MESSAGE_CONTENT", frame.getMessageId(),
                    frame.getReasoningContent());
            case "CONTENT" -> deltaEvent(
                    "TEXT_MESSAGE_CONTENT", frame.getMessageId(), frame.getContent());
            case "TOOL_CALL_STARTED" -> toolCallStarts(frame);
            case "TOOL_CALL" -> toolCallArgsAndEnds(frame);
            case "TOOL_FINISHED" -> List.of(toolCallResult(frame));
            case "SUB_AGENT_STARTED" -> List.of(subagentEvent("SUBAGENT_STARTED", frame));
            case "SUB_AGENT_FINISHED" -> List.of(subagentEvent("SUBAGENT_FINISHED", frame));
            case "USER_CONFIRMATION_REQUIRED", "EXTERNAL_EXECUTION_REQUIRED",
                    "USER_CONFIRM_RESULT", "EXTERNAL_EXECUTION_RESULT" ->
                    List.of(customEvent(CONTROL_CUSTOM_NAMES.get(frame.getOutputType()), frame));
            case "DONE" -> doneEvents(frame);
            case "ERROR" -> List.of(event("RUN_ERROR",
                    "message", frame.getError(), "code", "error"));
            case "CANCELLED" -> List.of(event("RUN_ERROR",
                    "message", frame.getCancellationReason(), "code", "cancelled"));
            default -> List.of();
        };
    }

    private List<Map<String, Object>> toolCallStarts(AiChatStreamRespVO frame) {
        List<Map<String, Object>> events = new ArrayList<>();
        for (AiChatStreamRespVO.ToolCallVO call : calls(frame)) {
            events.add(event("TOOL_CALL_START",
                    "toolCallId", call.getId(), "toolCallName", call.getName()));
        }
        return events;
    }

    /** 平台参数整串一次给出(非增量)→ 整串单 delta + END,逐工具调用成对。 */
    private List<Map<String, Object>> toolCallArgsAndEnds(AiChatStreamRespVO frame) {
        List<Map<String, Object>> events = new ArrayList<>();
        for (AiChatStreamRespVO.ToolCallVO call : calls(frame)) {
            events.add(event("TOOL_CALL_ARGS",
                    "toolCallId", call.getId(), "delta", call.getArguments()));
            events.add(event("TOOL_CALL_END", "toolCallId", call.getId()));
        }
        return events;
    }

    private Map<String, Object> toolCallResult(AiChatStreamRespVO frame) {
        Map<String, Object> event = event("TOOL_CALL_RESULT",
                "messageId", frame.getMessageId(),
                "toolCallId", frame.getToolCallId(),
                "content", frame.getToolResult(),
                "role", "tool");
        if (frame.getToolStatus() != null) {
            event.put("metadata", Map.of("toolStatus", frame.getToolStatus()));
        }
        return event;
    }

    private Map<String, Object> subagentEvent(String type, AiChatStreamRespVO frame) {
        return event(type,
                "subagentRunId", frame.getChildRunId(),
                "name", frame.getAgentName(),
                "parentToolCallId", frame.getParentToolCallId());
    }

    /** CUSTOM 控制帧:value 只收固定候选键的非空项(载荷原样保留)。 */
    private Map<String, Object> customEvent(String semanticName, AiChatStreamRespVO frame) {
        Map<String, Object> value = new LinkedHashMap<>();
        put(value, "runId", frame.getRunId());
        put(value, "controlType", frame.getControlType());
        put(value, "toolCallId", frame.getToolCallId());
        put(value, "toolName", frame.getToolName());
        put(value, "toolResult", frame.getToolResult());
        put(value, "pendingToolCalls", frame.getPendingToolCalls());
        put(value, "decisions", frame.getDecisions());
        put(value, "expiresAt", frame.getExpiresAt());
        put(value, "error", frame.getError());
        return event("CUSTOM", "name", CUSTOM_PREFIX + semanticName, "value", value);
    }

    /** DONE:引用清单存在时先发 CUSTOM 透出,再以 RUN_FINISHED 收尾。 */
    private List<Map<String, Object>> doneEvents(AiChatStreamRespVO frame) {
        List<Map<String, Object>> events = new ArrayList<>();
        if (frame.getKbCitations() != null && !frame.getKbCitations().isEmpty()) {
            events.add(event("CUSTOM",
                    "name", CUSTOM_PREFIX + "kb_citations",
                    "value", frame.getKbCitations()));
        }
        events.add(event("RUN_FINISHED", "outcome", "success"));
        return events;
    }

    private List<Map<String, Object>> deltaEvent(String type, String id, String delta) {
        return delta == null ? List.of()
                : List.of(event(type, "messageId", id, "delta", delta));
    }

    private static List<AiChatStreamRespVO.ToolCallVO> calls(AiChatStreamRespVO frame) {
        return frame.getToolCalls() == null ? List.of() : frame.getToolCalls();
    }

    private static void put(Map<String, Object> target, String key, Object value) {
        if (value != null) {
            target.put(key, value);
        }
    }

    /** 事件骨架:type 必填 + 键值对(varargs,仅收非空值,wire 不出现 null)。 */
    static Map<String, Object> event(String type, Object... keyValues) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", type);
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            put(event, (String) keyValues[i], keyValues[i + 1]);
        }
        return event;
    }
}
