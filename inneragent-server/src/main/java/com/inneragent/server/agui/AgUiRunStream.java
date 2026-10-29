package com.inneragent.server.agui;

import com.inneragent.server.controller.vo.AiChatStreamRespVO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * AG-UI 事件适配器 · 边界状态合成(批次 E2):每次订阅 new 一个,把平台帧流
 * 补齐为完整 AG-UI 事件流 —— 首帧前一次性合成 RUN_STARTED(threadId=
 * conversationId、runId=runId);REASONING/TEXT_MESSAGE 的 START/END 边界按
 * 交替开合补齐(同 id 续增量不重开,异 id 先闭合再开);终态帧前先闭合未收口
 * 边界。直映类帧复用 {@link AgUiEventTranslator} 纯函数与事件骨架。
 */
public class AgUiRunStream {

    private final AgUiEventTranslator translator = new AgUiEventTranslator();
    private boolean runStarted;
    /** 当前开放的推理/正文边界 messageId(null = 未开放)。 */
    private String reasoningId;
    private String messageId;

    /** 端点受理即发的 RUN_STARTED(调用后 onFrame 不再重复合成)。 */
    public Map<String, Object> runStarted(String threadId, String runId) {
        runStarted = true;
        return AgUiEventTranslator.event("RUN_STARTED",
                "threadId", threadId, "runId", runId);
    }

    /** 一帧 → 零或多个 AG-UI 事件(含按需合成的 RUN_STARTED 与边界开合)。 */
    public List<Map<String, Object>> onFrame(AiChatStreamRespVO frame) {
        if (frame == null || frame.getOutputType() == null) {
            return List.of();
        }
        List<Map<String, Object>> events = new ArrayList<>();
        if (!runStarted) {
            events.add(runStarted(frame.getConversationId(), frame.getRunId()));
        }
        switch (frame.getOutputType()) {
            case "REASONING" -> {
                if (frame.getReasoningContent() != null) {
                    open(events, frame.getMessageId(), true);
                }
            }
            case "CONTENT" -> {
                if (frame.getContent() != null) {
                    open(events, frame.getMessageId(), false);
                }
            }
            // 终态帧:先闭合未收口边界,再发自身事件;其余直映帧无边界语义
            case "DONE", "ERROR", "CANCELLED" -> {
                close(events, false);
                close(events, true);
            }
        }
        events.addAll(translator.translate(frame));
        return events;
    }

    /**
     * 开边界:同族同 id 已开 → 沿用边界只发 CONTENT,不开合;否则先收另一族
     * (族切换)再收本族旧边界(异 id 重开),最后开新边界。任意时刻至多一个
     * 边界开放。
     */
    private void open(List<Map<String, Object>> events, String id, boolean reasoning) {
        String openId = reasoning ? reasoningId : messageId;
        if (id != null && id.equals(openId)) {
            return;
        }
        close(events, !reasoning);
        close(events, reasoning);
        if (reasoning) {
            reasoningId = id;
        } else {
            messageId = id;
        }
        events.add(AgUiEventTranslator.event(
                reasoning ? "REASONING_START" : "TEXT_MESSAGE_START",
                "messageId", id,
                "role", reasoning ? null : "assistant"));
    }

    private void close(List<Map<String, Object>> events, boolean reasoning) {
        String openId = reasoning ? reasoningId : messageId;
        if (openId == null) {
            return;
        }
        if (reasoning) {
            reasoningId = null;
        } else {
            messageId = null;
        }
        events.add(AgUiEventTranslator.event(
                reasoning ? "REASONING_END" : "TEXT_MESSAGE_END",
                "messageId", openId));
    }
}
