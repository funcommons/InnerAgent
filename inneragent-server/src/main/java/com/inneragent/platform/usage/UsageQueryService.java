package com.inneragent.platform.usage;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.platform.common.PageResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

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
}
