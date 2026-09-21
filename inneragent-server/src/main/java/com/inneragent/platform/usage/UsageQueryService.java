package com.inneragent.platform.usage;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.agent.mapper.AgentFeedbackMapper;
import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.platform.common.PageResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 用量统计查询服务(W15;PRD M8「用量统计」P1:按 应用/Agent/用户/模型
 * 维度的 token 与调用次数统计——本服务先落 应用/用户/周期/模型 四维聚合,
 * Agent 维度随台账挂 agent 列后扩展)。
 *
 * <p>形态对齐 {@code ToolAuditQueryService}(管理面分页检索):pageSize 钳制
 * 100;聚合走 SQL group by 实时计算,不加物化表(03-开发计划 §7.1 W15)。
 * 管理面为跨用户视图:行级 app_id 由拦截器按缺省应用注入,appId 参数为
 * 冗余显式过滤(对齐 AdminAuditController 先例)。
 */
@Service
@RequiredArgsConstructor
public class UsageQueryService {

    /** 每页上限(对齐 PageParam 惯例) */
    static final int MAX_PAGE_SIZE = 100;

    static final String GRANULARITY_DAY = "DAY";
    static final String GRANULARITY_MONTH = "MONTH";

    private final AgentModelCallUsageMapper usageMapper;

    private final AgentFeedbackMapper feedbackMapper;

    /** 统计周期粒度 DAY(按天)/ MONTH(按月);其他值 400。 */
    public static String normalizeGranularity(String granularity) {
        if (granularity == null || granularity.isBlank()
                || GRANULARITY_DAY.equalsIgnoreCase(granularity.trim())) {
            return GRANULARITY_DAY;
        }
        if (GRANULARITY_MONTH.equalsIgnoreCase(granularity.trim())) {
            return GRANULARITY_MONTH;
        }
        throw new IllegalArgumentException(
                "granularity 仅支持 DAY / MONTH: " + granularity);
    }

    /**
     * 用量聚合分页:应用/用户/时间区间过滤,按
     * 应用 × 用户 × 统计周期 × (provider, model) group by。
     */
    public PageResult<UsageSummaryRow> page(UsageSummaryFilter filter) {
        int pageNo = Math.max(filter.pageNo(), 1);
        int pageSize = Math.min(Math.max(filter.pageSize(), 1), MAX_PAGE_SIZE);
        UsageSummaryQuery query = new UsageSummaryQuery(
                filter.appId(),
                filter.userId(),
                filter.from(),
                filter.to(),
                GRANULARITY_MONTH.equals(normalizeGranularity(filter.granularity()))
                        ? "YYYY-MM"
                        : "YYYY-MM-DD");
        IPage<UsageSummaryRow> page = usageMapper.selectUsageSummary(
                new Page<>(pageNo, pageSize), query);
        PageResult<UsageSummaryRow> result =
                new PageResult<>(page.getRecords(), page.getTotal());
        result.setPageNo(pageNo);
        result.setPageSize(pageSize);
        return result;
    }

    /**
     * 聚合分页过滤条件(granularity 见 {@link #normalizeGranularity};其余
     * 域含义同 {@link UsageSummaryQuery})。
     */
    public record UsageSummaryFilter(
            Long appId,
            Long userId,
            java.time.LocalDateTime from,
            java.time.LocalDateTime to,
            String granularity,
            int pageNo,
            int pageSize) {
    }

    // ------------------------------------------------------------------
    // 北极星出数(W15;03-开发计划 §7.3 验收 6「用户反馈事件入库,北极星
    // 看板出数(任务完成率代理指标)」,口径对齐 docs/灰度与指标大盘.md B4 行)
    // ------------------------------------------------------------------

    /**
     * 北极星摘要。两条口径(计算式同步登记大盘 B4 行):
     * <ul>
     *   <li><strong>反馈好评率</strong> = thumbsUp ÷ (thumbsUp + thumbsDown);
     *       窗口内全部反馈(消息级 + run 级),为 0 时 null(不出数)。</li>
     *   <li><strong>带反馈完成率代理</strong> = COMPLETED ÷ (COMPLETED + FAILED)
     *       (CANCELLED 单列观察)——仅统计带反馈的根运行:run 级反馈按
     *       run_id 直连,消息级反馈经 conversation 连根运行
     *       (parent_run_id IS NULL,子 Agent 内部运行不计)。</li>
     * </ul>
     */
    public NorthStarSummary northStar(NorthStarFilter filter) {
        Map<String, Object> ratings = feedbackMapper.selectRatingCounts(
                filter.from(), filter.to(), filter.appId());
        long thumbsUp = ((Number) ratings.getOrDefault("up", 0)).longValue();
        long thumbsDown = ((Number) ratings.getOrDefault("down", 0)).longValue();

        long completed = 0;
        long failed = 0;
        long cancelled = 0;
        for (Map<String, Object> row : feedbackMapper.selectRunLinkedRunStatuses(
                filter.from(), filter.to(), filter.appId())) {
            long[] counts = accumulate(completed, failed, cancelled, row);
            completed = counts[0];
            failed = counts[1];
            cancelled = counts[2];
        }
        for (Map<String, Object> row : feedbackMapper.selectConversationLinkedRunStatuses(
                filter.from(), filter.to(), filter.appId())) {
            long[] counts = accumulate(completed, failed, cancelled, row);
            completed = counts[0];
            failed = counts[1];
            cancelled = counts[2];
        }

        return new NorthStarSummary(
                filter.from(),
                filter.to(),
                thumbsUp,
                thumbsDown,
                rate(thumbsUp, thumbsUp + thumbsDown),
                completed,
                failed,
                cancelled,
                rate(completed, completed + failed));
    }

    private long[] accumulate(long completed, long failed, long cancelled,
                              Map<String, Object> row) {
        long runs = ((Number) row.getOrDefault("runs", 0)).longValue();
        return switch (String.valueOf(row.get("status"))) {
            case "COMPLETED" -> new long[]{completed + runs, failed, cancelled};
            case "FAILED" -> new long[]{completed, failed + runs, cancelled};
            case "CANCELLED" -> new long[]{completed, failed, cancelled + runs};
            default -> new long[]{completed, failed, cancelled};
        };
    }

    /** 比率:分母为 0 时 null(大盘不出数,不虚报 100%)。 */
    private static Double rate(long numerator, long denominator) {
        return denominator == 0 ? null : (double) numerator / denominator;
    }

    /** 北极星过滤(时间按反馈 create_time;appId 冗余显式过滤)。 */
    public record NorthStarFilter(
            Long appId,
            LocalDateTime from,
            LocalDateTime to) {
    }

    /**
     * 北极星出数行(比率为 [0,1] 双精度,web 侧换算百分比;null=窗口内无样本)。
     */
    public record NorthStarSummary(
            LocalDateTime from,
            LocalDateTime to,
            long thumbsUp,
            long thumbsDown,
            Double positiveRate,
            long feedbackLinkedCompletedRuns,
            long feedbackLinkedFailedRuns,
            long feedbackLinkedCancelledRuns,
            Double feedbackLinkedCompletionRate) {
    }
}
