package com.inneragent.server.controller.vo;

import com.inneragent.agent.entity.AgentFeedback;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 用户反馈响应体(W15;用户面回显与管理面分页共用形)。
 */
@Schema(description = "用户反馈")
public record FeedbackRespVO(
        Long id,
        Long appId,
        Long userId,
        String conversationId,
        String runId,
        String messageId,
        @Schema(description = "UP-👍 / DOWN-👎") String rating,
        String comment,
        @Schema(description = "首次反馈时间") LocalDateTime createTime,
        @Schema(description = "最近覆盖时间(重复反馈=覆盖)") LocalDateTime updateTime) {

    public static FeedbackRespVO of(AgentFeedback row) {
        return new FeedbackRespVO(row.getId(), row.getAppId(), row.getUserId(),
                row.getConversationId(), row.getRunId(), row.getMessageId(),
                row.getRating(), row.getComment(), row.getCreateTime(),
                row.getUpdateTime());
    }
}
