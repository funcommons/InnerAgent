package com.inneragent.server.agui;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AiChatReqVO;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * [new] E2 AG-UI RunAgentInput → AiChatReqVO 翻译红测试(实现落地前
 * {@code AgUiRunInput} 含嵌套 {@code Message} 均不存在,本类处于编译红态)。
 *
 * <p>拍板:AiChatReqVO 实际没有 runId/续跑字段 —— runId 只留在输入 DTO 上,
 * 由 controller 据此路由到 {@code /runs/{runId}/continue} 语义(续跑不进请求体);
 * 翻译面收敛为 message=末条 user 消息、conversationId=threadId、context 直透,
 * 其余 AiChatReqVO 字段保持 null。
 */
class AgUiRunInputTests {

    @Test
    void mapsLastUserMessageThreadIdAndContextIntoTheChatRequest() {
        Map<String, Object> context = Map.of("page", "page-1");
        AgUiRunInput input = new AgUiRunInput()
                .setThreadId("conversation-1")
                .setContext(context)
                .setMessages(List.of(
                        message("system", "你是助手"), message("user", "第一问"),
                        message("assistant", "第一答"), message("user", "第二问"),
                        message("assistant", "补充")));

        AiChatReqVO request = input.toAiChatReq();

        assertThat(request.getMessage()).isEqualTo("第二问");
        assertThat(request.getConversationId()).isEqualTo("conversation-1");
        assertThat(request.getContext()).isEqualTo(context);
        assertThat(request.getModelId()).isNull();
        assertThat(request.getAgentType()).isNull();
        assertThat(request.getEnabledTools()).isNull();
    }

    @Test
    void inputWithoutAnyUserMessageIsRejectedWithBadRequestSemantics() {
        AgUiRunInput input = new AgUiRunInput()
                .setThreadId("conversation-1")
                .setMessages(List.of(message("system", "你是助手"), message("assistant", "hi")));

        assertThatThrownBy(input::toAiChatReq)
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getCode()).isEqualTo(400));

    }

    @Test
    void runIdStaysOnTheInputForContinuationRoutingAndNeverEntersTheChatRequest() {
        AgUiRunInput input = new AgUiRunInput()
                .setThreadId("conversation-1")
                .setRunId("run-9")
                .setMessages(List.of(message("user", "继续")));

        AiChatReqVO request = input.toAiChatReq();

        assertThat(input.getRunId()).isEqualTo("run-9");
        assertThat(request.getMessage()).isEqualTo("继续");
        // 续跑不改变会话语义:conversationId 仍来自 threadId,而不是 runId
        assertThat(request.getConversationId()).isEqualTo("conversation-1");
        assertThat(request.getContext()).isNull();
    }

    @Test
    void optionalContextAndForwardedPropsAreToleratedWhenAbsent() {
        AgUiRunInput input = new AgUiRunInput()
                .setThreadId("conversation-1")
                .setMessages(List.of(message("user", "第一问")));

        AiChatReqVO request = input.toAiChatReq();

        assertThat(request.getMessage()).isEqualTo("第一问");
        assertThat(request.getConversationId()).isEqualTo("conversation-1");
        assertThat(request.getContext()).isNull();
        assertThat(input.getForwardedProps()).isNull();
    }

    private static AgUiRunInput.Message message(String role, String content) {
        return new AgUiRunInput.Message().setRole(role).setContent(content);
    }
}
