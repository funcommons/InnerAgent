package com.inneragent.server.admin;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.usage.UsageQueryService;
import com.inneragent.platform.usage.UsageSummaryRow;
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
 * 用量统计 admin API(W15,PRD §6.8 M8「用量统计」P1,03-开发计划 §7.1 W15)。
 *
 * <p>守卫:{@link AdminTokenFilter} 双轨(X-IA-Admin-Key 引导 key 或管理会话
 * token Bearer)。管理面为跨用户视图:行级 app_id 由拦截器按缺省应用注入
 * (对齐 {@code AdminAuditController} 先例),appId 参数为冗余显式过滤。
 *
 * <p>读操作不落 {@code ia_audit_log}(审计为工具裁决语义,查询类不产生
 * 裁决事件)。
 */
@Tag(name = "用量统计(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/usage")
@RequiredArgsConstructor
@Validated
public class AdminUsageController {

    private final UsageQueryService usageQueryService;

    @GetMapping("/summary")
    @Operation(summary = "用量聚合分页(应用/用户 × 日|月 × 模型;tokens 与调用次数,"
            + "聚合口径=COMPLETED/FAILED/CANCELLED 终态调用,token 合计仅 COMPLETED)")
    public CommonResult<PageResult<UsageSummaryRow>> summary(
            @RequestParam(required = false) Long appId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime to,
            @RequestParam(defaultValue = "DAY") String granularity,
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize) {
        return success(usageQueryService.page(new UsageQueryService.UsageSummaryFilter(
                appId, userId, from, to, granularity, pageNo, pageSize)));
    }

    /**
     * 北极星出数(W15;03-开发计划 §7.3 验收 6,口径登记于
     * docs/灰度与指标大盘.md B4 行):
     * <ul>
     *   <li>好评率 = 👍 ÷ (👍+👎),窗口内全部反馈;</li>
     *   <li>带反馈完成率代理 = COMPLETED ÷ (COMPLETED+FAILED)(CANCELLED
     *       单列观察)——仅带反馈的根运行(run 级反馈按 run_id,消息级经
     *       conversation 连根运行),B4 任务完成率的反馈质量佐证。</li>
     * </ul>
     * 比率为 [0,1];窗口无样本时 null(不出数,不虚报)。
     */
    @GetMapping("/north-star")
    @Operation(summary = "北极星摘要(反馈好评率 + 带反馈完成率代理;时间按反馈 create_time)")
    public CommonResult<UsageQueryService.NorthStarSummary> northStar(
            @RequestParam(required = false) Long appId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime to) {
        return success(usageQueryService.northStar(
                new UsageQueryService.NorthStarFilter(appId, from, to)));
    }
}
