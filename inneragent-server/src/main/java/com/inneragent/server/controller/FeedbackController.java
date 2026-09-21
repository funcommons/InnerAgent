package com.inneragent.server.controller;

import com.inneragent.agent.feedback.AgentFeedbackService;
import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.context.AppContext;
import com.inneragent.server.controller.vo.FeedbackRespVO;
import com.inneragent.server.controller.vo.FeedbackSubmitReqVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.inneragent.platform.common.CommonResult.success;
import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * 用户反馈 API(W15;PRD M2 用户反馈 👍/👎,03-开发计划 §7.1)。
 *
 * <p>路由 {@code /ia/api/v1/feedback};embed token 认证链
 * ({@code requireCurrentUserId()},同 /ia/api/v1/mcp-servers 先例)。
 * 行级 userId 隔离:提交即本人,查询仅返回本人反馈(他人不可见)。
 * 重复反馈 = 覆盖(upsert,幂等键 conversation+message 优先、run 兜底,
 * 见 {@link AgentFeedbackService} 类注释)。不落 ia_audit_log(用户面
 * 高频低敏)。
 */
@Tag(name = "用户反馈(用户面)")
@RestController
@RequestMapping("/ia/api/v1/feedback")
@RequiredArgsConstructor
public class FeedbackController {

    private final AgentFeedbackService feedbackService;

    @PostMapping
    @Operation(summary = "提交反馈(👍/👎;同键重复提交=覆盖;锚定 runId 或 conversationId+messageId)")
    public CommonResult<FeedbackRespVO> submit(
            @Valid @RequestBody FeedbackSubmitReqVO request) {
        return success(FeedbackRespVO.of(feedbackService.submit(
                scope(), userId(), new AgentFeedbackService.Submit(
                        request.conversationId(), request.runId(), request.messageId(),
                        request.rating(), request.comment()))));
    }

    @GetMapping
    @Operation(summary = "本人反馈查询(同会话反馈回显;conversationId/runId 可选过滤,时间倒序)")
    public CommonResult<List<FeedbackRespVO>> list(
            @RequestParam(required = false) String conversationId,
            @RequestParam(required = false) String runId) {
        return success(feedbackService
                .listMine(scope(), userId(), conversationId, runId).stream()
                .map(FeedbackRespVO::of)
                .toList());
    }

    // ------------------------------------------------------------------

    private static long scope() {
        return AppContext.currentOrDefault();
    }

    private static long userId() {
        return requireCurrentUserId();
    }
}
