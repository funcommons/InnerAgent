package com.inneragent.agent.feedback;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.agent.mapper.AgentFeedbackMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 用户反馈服务(W15;PRD M2 用户反馈 👍/👎,03-开发计划 §7.3 验收 6:
 * 反馈事件入库、北极星看板出数)。
 *
 * <p><strong>幂等语义(产品口径)</strong>:反馈对象两级——
 * <ul>
 *   <li>消息级(主语义):conversationId+messageId,对应助手消息上的
 *       👍/👎 按钮;幂等键 (app_id, user_id, conversation_id, message_id);</li>
 *   <li>run 级(兜底):无消息上下文(如 iframe 整体评价)只带 runId;
 *       幂等键 (app_id, user_id, run_id) 且不带消息键(部分唯一索引 V21)。</li>
 * </ul>
 * 同键重复提交 = <strong>覆盖</strong>(upsert:改 rating/comment,不产生
 * 重复行;update_time 即最近覆盖时间)。并发双写以唯一索引兜底
 * (DuplicateKeyException → 重读覆盖),应用层预查只做快路径。
 *
 * <p>行级 userId 隔离(他人不可见/不可覆盖,对齐 McpUserServerService 先例);
 * 反馈不落 ia_audit_log(用户面高频低敏,对齐用户 MCP 先例——ia_audit_log
 * 为工具裁决语义)。维度行不做归属强校验(会话/运行行可跨查询域,弱关联
 * 照 MCP 用户目录口径;越权面由行级 userId 隔离收敛)。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentFeedbackService {

    /** 评语长度上限(自由文本,防滥用) */
    static final int MAX_COMMENT_LENGTH = 2000;

    /** 同会话反馈查询单次返回上限 */
    static final int MAX_LIST_SIZE = 200;

    /** 每页上限(对齐 PageParam 惯例) */
    static final int MAX_PAGE_SIZE = 100;

    private final AgentFeedbackMapper feedbackMapper;

    /** 提交/覆盖反馈(幂等键与覆盖语义见类注释)。 */
    @Transactional
    public AgentFeedback submit(long appId, long userId, Submit submit) {
        String rating = normalizeRating(submit.rating());
        String comment = normalizeComment(submit.comment());
        boolean messageLevel = submit.messageId() != null && !submit.messageId().isBlank();
        String conversationId = trimToNull(submit.conversationId());
        String runId = trimToNull(submit.runId());

        if (messageLevel) {
            if (conversationId == null) {
                throw new BusinessException(400, "消息级反馈必须同时携带 conversationId");
            }
        } else if (runId == null) {
            throw new BusinessException(400, "反馈必须锚定 runId 或 conversationId+messageId");
        }

        AgentFeedback existing = findByNaturalKey(
                appId, userId, conversationId, messageId(messageLevel, submit), runId);
        if (existing != null) {
            existing.setRating(rating);
            existing.setComment(comment);
            feedbackMapper.updateById(existing);
            return existing;
        }
        AgentFeedback feedback = AgentFeedback.builder()
                .appId(appId)
                .userId(userId)
                .conversationId(conversationId)
                .runId(runId)
                .messageId(messageLevel ? submit.messageId().trim() : null)
                .rating(rating)
                .build();
        feedback.setComment(comment);
        try {
            feedbackMapper.insert(feedback);
            return feedback;
        } catch (DuplicateKeyException raced) {
            // 并发双写:唯一索引兜底,落覆盖语义
            AgentFeedback winner = findByNaturalKey(
                    appId, userId, conversationId, messageId(messageLevel, submit), runId);
            if (winner == null) {
                throw raced;
            }
            winner.setRating(rating);
            winner.setComment(comment);
            feedbackMapper.updateById(winner);
            return winner;
        }
    }

    /**
     * 本人的反馈(同会话反馈查询):conversationId/runId 均可选过滤,
     * 时间倒序,单次上限 {@link #MAX_LIST_SIZE}。行级 userId 隔离——
     * 他人反馈不可见。
     */
    public List<AgentFeedback> listMine(
            long appId, long userId, String conversationId, String runId) {
        return feedbackMapper.selectList(new LambdaQueryWrapper<AgentFeedback>()
                .eq(AgentFeedback::getAppId, appId)
                .eq(AgentFeedback::getUserId, userId)
                .eq(trimToNull(conversationId) != null,
                        AgentFeedback::getConversationId, trimToNull(conversationId))
                .eq(trimToNull(runId) != null, AgentFeedback::getRunId, trimToNull(runId))
                .orderByDesc(AgentFeedback::getCreateTime)
                .orderByDesc(AgentFeedback::getId)
                .last("LIMIT " + MAX_LIST_SIZE));
    }

    /** 管理面分页检索:维度/rating/时间区间过滤,时间倒序。 */
    public PageResult<AgentFeedback> page(AdminFilter filter) {
        int pageNo = Math.max(filter.pageNo(), 1);
        int pageSize = Math.min(Math.max(filter.pageSize(), 1), MAX_PAGE_SIZE);
        String rating = filter.rating() == null || filter.rating().isBlank()
                ? null : normalizeRating(filter.rating());
        IPage<AgentFeedback> page = feedbackMapper.selectPage(
                new Page<>(pageNo, pageSize),
                new LambdaQueryWrapper<AgentFeedback>()
                        .eq(filter.appId() != null, AgentFeedback::getAppId, filter.appId())
                        .eq(filter.userId() != null, AgentFeedback::getUserId, filter.userId())
                        .eq(trimToNull(filter.conversationId()) != null,
                                AgentFeedback::getConversationId,
                                trimToNull(filter.conversationId()))
                        .eq(trimToNull(filter.runId()) != null,
                                AgentFeedback::getRunId, trimToNull(filter.runId()))
                        .eq(rating != null, AgentFeedback::getRating, rating)
                        .ge(filter.from() != null, AgentFeedback::getCreateTime, filter.from())
                        .le(filter.to() != null, AgentFeedback::getCreateTime, filter.to())
                        .orderByDesc(AgentFeedback::getCreateTime)
                        .orderByDesc(AgentFeedback::getId));
        PageResult<AgentFeedback> result = new PageResult<>(page.getRecords(), page.getTotal());
        result.setPageNo(pageNo);
        result.setPageSize(pageSize);
        return result;
    }

    // ------------------------------------------------------------------

    private AgentFeedback findByNaturalKey(
            long appId, long userId, String conversationId, String messageId, String runId) {
        LambdaQueryWrapper<AgentFeedback> wrapper = new LambdaQueryWrapper<AgentFeedback>()
                .eq(AgentFeedback::getAppId, appId)
                .eq(AgentFeedback::getUserId, userId);
        if (messageId != null) {
            wrapper.eq(AgentFeedback::getConversationId, conversationId)
                    .eq(AgentFeedback::getMessageId, messageId);
        } else {
            wrapper.eq(AgentFeedback::getRunId, runId)
                    .isNull(AgentFeedback::getConversationId)
                    .isNull(AgentFeedback::getMessageId);
        }
        return feedbackMapper.selectOne(wrapper.last("LIMIT 1"));
    }

    private static String messageId(boolean messageLevel, Submit submit) {
        return messageLevel ? submit.messageId().trim() : null;
    }

    private static String normalizeRating(String rating) {
        if (rating == null || rating.isBlank()) {
            throw new BusinessException(400, "rating 必填(UP/DOWN)");
        }
        String normalized = rating.trim().toUpperCase();
        if (!AgentFeedback.RATING_UP.equals(normalized)
                && !AgentFeedback.RATING_DOWN.equals(normalized)) {
            throw new BusinessException(400, "rating 仅支持 UP / DOWN");
        }
        return normalized;
    }

    private static String normalizeComment(String comment) {
        if (comment == null || comment.isBlank()) {
            return null;
        }
        String trimmed = comment.trim();
        if (trimmed.length() > MAX_COMMENT_LENGTH) {
            throw new BusinessException(400,
                    "评语最长 " + MAX_COMMENT_LENGTH + " 字");
        }
        return trimmed;
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** 提交请求(维度可空,锚点校验见 {@link #submit})。 */
    public record Submit(
            String conversationId,
            String runId,
            String messageId,
            String rating,
            String comment) {
    }

    /** 管理面过滤(时间按 create_time;rating UP/DOWN)。 */
    public record AdminFilter(
            Long appId,
            Long userId,
            String conversationId,
            String runId,
            String rating,
            LocalDateTime from,
            LocalDateTime to,
            int pageNo,
            int pageSize) {
    }
}
