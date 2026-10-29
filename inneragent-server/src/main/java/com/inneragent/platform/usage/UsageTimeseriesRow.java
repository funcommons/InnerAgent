package com.inneragent.platform.usage;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用量时序行(admin {@code /ia/api/v1/admin/usage/timeseries}:按统计周期
 * 分桶的调用次数与 token 合计,一行一桶,无维度下钻)。
 *
 * <p>来源 {@code ia_agent_model_call_usage} 单表;计数与 token SUM 均只覆盖
 * 终态行(COMPLETED/FAILED/CANCELLED,STARTED 不计),口径对齐
 * {@link UsageSummaryRow}。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UsageTimeseriesRow {

    /**
     * 统计周期键(granularity=DAY → {@code yyyy-MM-dd};按模型调用
     * started_at 归桶,to_char 截断、不做时区换算)
     */
    private String statDate;

    /** 调用次数(终态行:COMPLETED/FAILED/CANCELLED) */
    private Long calls;

    /** 其中 COMPLETED 次数 */
    private Long completedCalls;

    /** 其中 FAILED 次数 */
    private Long failedCalls;

    /** 其中 CANCELLED 次数 */
    private Long cancelledCalls;

    /** 输入 token 合计 */
    private Long inputTokens;

    /** 输出 token 合计 */
    private Long outputTokens;

    /** 推理(思考)token 合计 */
    private Long reasoningTokens;

    /** 缓存命中 token 合计 */
    private Long cacheTokens;
}
