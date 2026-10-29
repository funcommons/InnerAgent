package com.inneragent.server.agui;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.controller.vo.AiChatReqVO;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.List;
import java.util.Map;

/**
 * AG-UI RunAgentInput 输入 DTO(批次 E2,AG-UI 1.0 wire 子集)。
 *
 * <p>[adapt] 拍板:AiChatReqVO 没有 runId/续跑字段 —— runId 只留在本 DTO 上,
 * 由 controller 据此路由到 {@code POST /runs/{runId}/continue} 语义(续跑不进
 * 请求体);翻译面收敛为 message=末条 user 消息、conversationId=threadId、
 * context 直透,其余字段保持 null。tools/state 等 v1 未消费的 wire 字段由
 * Jackson 宽容忽略(Spring Boot 默认不因未知属性失败)。
 */
@Data
@Accessors(chain = true)
public class AgUiRunInput {

    /** AG-UI thread:映射平台 conversationId(同 thread 多轮同会话)。 */
    private String threadId;

    /** 客户端关联 ID;非空时按续跑语义路由,绝不进 AiChatReqVO 请求体。 */
    private String runId;

    /** 消息序列;末条 user 消息为本次运行的用户输入。 */
    private List<Message> messages;

    /** 透传上下文(平台 context 直透)。 */
    private Map<String, Object> context;

    /** AG-UI forwardedProps:v1 不消费,仅容忍不报错。 */
    private Map<String, Object> forwardedProps;

    /** 翻译为平台对话请求;无 user 消息按 400 业务异常拒绝。 */
    public AiChatReqVO toAiChatReq() {
        String userMessage = lastUserMessage();
        if (userMessage == null) {
            throw new BusinessException(400, "AG-UI 输入缺少 user 消息");
        }
        AiChatReqVO request = new AiChatReqVO();
        request.setMessage(userMessage);
        request.setConversationId(threadId);
        request.setContext(context);
        return request;
    }

    /** 倒序扫描末条 user 消息(空 content 视同缺席)。 */
    private String lastUserMessage() {
        if (messages == null) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            Message message = messages.get(i);
            if (message != null && "user".equals(message.getRole())
                    && message.getContent() != null && !message.getContent().isBlank()) {
                return message.getContent();
            }
        }
        return null;
    }

    /** AG-UI Message wire 子集(name 等扩展键被 Jackson 忽略)。 */
    @Data
    @Accessors(chain = true)
    public static class Message {
        private String id;
        private String role;
        private String content;
    }
}
