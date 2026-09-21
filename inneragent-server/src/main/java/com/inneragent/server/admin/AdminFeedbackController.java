package com.inneragent.server.admin;

import com.inneragent.agent.feedback.AgentFeedbackService;
import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.controller.vo.FeedbackRespVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 用户反馈 admin API(W15;PRD M8 管理后台,03-开发计划 §7.1 W15)。
 *
 * <p>守卫:{@link AdminTokenFilter} 双轨(X-IA-Admin-Key 引导 key 或管理
 * 会话 token Bearer);分页形对齐 {@code AdminAuditController}
 * (PageResult=list+total+pageNo+pageSize)。管理面为跨用户视图:行级
 * app_id 由拦截器按缺省应用注入,appId 参数为冗余显式过滤。读操作不落
 * ia_audit_log。
 */
@Tag(name = "用户反馈(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/feedbacks")
@RequiredArgsConstructor
@Validated
public class AdminFeedbackController {

    private final AgentFeedbackService feedbackService;

    @GetMapping
    @Operation(summary = "反馈分页(appId/userId/conversationId/runId/rating/时间区间过滤;"
            + "rating=UP|DOWN,其他值 400)")
    public CommonResult<PageResult<FeedbackRespVO>> page(
            @RequestParam(required = false) Long appId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String conversationId,
            @RequestParam(required = false) String runId,
            @RequestParam(required = false) String rating,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime to,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        PageResult<AgentFeedback> page = feedbackService.page(
                new AgentFeedbackService.AdminFilter(
                        appId, userId, conversationId, runId, rating,
                        from, to, pageNo, pageSize));
        // 不走 PageResult.map(两参构造会丢 pageNo/pageSize,web 契约需回填)
        PageResult<FeedbackRespVO> result = new PageResult<>(
                page.getList().stream().map(FeedbackRespVO::of).toList(),
                page.getTotal(), page.getPageNo(), page.getPageSize());
        return success(result);
    }
}
