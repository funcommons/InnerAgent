package com.inneragent.server.controller.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/**
 * 用户反馈提交体(W15)。维度可空;锚点规则(rating/锚点校验)在服务层
 * 收敛 {@code AgentFeedbackService.submit}——校验器只做形状(长度)约束。
 */
@Schema(description = "用户反馈提交")
public record FeedbackSubmitReqVO(
        @Schema(description = "所属会话 ID(消息级必填)") String conversationId,
        @Schema(description = "所属运行 ID(run 级必填)") String runId,
        @Schema(description = "反馈消息标识(消息级 👍/👎 按钮)") String messageId,
        @Schema(description = "UP-👍 / DOWN-👎(大小写不敏感)") String rating,
        @Schema(description = "可选评语,最长 2000 字") @Size(max = 2000, message = "评语最长 2000 字")
        String comment) {
}
