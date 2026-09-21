package com.inneragent.platform.usage;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用量聚合行(W15;PRD M8「用量统计」:按 应用/用户/日 × 模型 维度的
 * token 与调用次数统计)。
 *
 * <p>来源 {@code ia_agent_model_call_usage} ⋈ {@code ia_agent_run}(取
 * user_id;台账无用户列,运行行是用户归属的事实源)。SQL group by 实时聚合,
 * 不加物化表(P1 体量;P2 结算如需预聚合另行立项)。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UsageSummaryRow {

    /** 应用 ID(ia_app.id) */
    private Long appId;

    /** 用户 ID(发起运行的用户) */
    private Long userId;

    /**
     * 统计周期键(granularity=DAY → {@code yyyy-MM-dd};MONTH →
     * {@code yyyy-MM};按模型调用 started_at 归桶)
     */
    private String statDate;

    /** 模型服务商标识(请求协议归一) */
    private String provider;

    /** 模型代码标识 */
    private String modelCode;

    /** 模型调用次数(终态行:COMPLETED/FAILED/CANCELLED;FAILED 行 token 列为空) */
    private Long calls;

    /** 输入 token 合计 */
    private Long inputTokens;

    /** 输出 token 合计 */
    private Long outputTokens;

    /** 推理(思考)token 合计 */
    private Long reasoningTokens;

    /** 缓存命中 token 合计 */
    private Long cacheTokens;
}
