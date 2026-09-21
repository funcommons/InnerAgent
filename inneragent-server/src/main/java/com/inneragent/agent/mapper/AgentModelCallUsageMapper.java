package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.agent.entity.AgentModelCallUsage;
import com.inneragent.platform.usage.UsageSummaryQuery;
import com.inneragent.platform.usage.UsageSummaryRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface AgentModelCallUsageMapper extends BaseMapper<AgentModelCallUsage> {

    @Select("""
            SELECT *
            FROM ia_agent_model_call_usage
            WHERE run_id = #{runId}
              AND model_call_id = #{modelCallId}
            LIMIT 1
            """)
    AgentModelCallUsage selectByRunAndCall(
            @Param("runId") String runId,
            @Param("modelCallId") String modelCallId);

    /**
     * 用量聚合(W15):按 应用/用户/统计周期 × 模型 group by 实时聚合,token
     * 合计只来自 COMPLETED 行(FAILED 行 token 为空,计次不计 token)。
     * 用户维度自 {@code ia_agent_run} 联查(台账无用户列,运行行是归属事实源)。
     * 统计周期格式由服务层收敛为两种常量(DAY/MONTH),杜绝注入面;
     * GROUP BY 走输出列序号(绑定参数表达式无法参与 GROUP BY 匹配)。
     */
    @Select("""
            <script>
            SELECT u.app_id AS appId,
                   r.user_id AS userId,
                   to_char(u.started_at, #{query.granularityFormat}) AS statDate,
                   u.provider AS provider,
                   u.model_code AS modelCode,
                   COUNT(*) AS calls,
                   COALESCE(SUM(u.input_tokens), 0) AS inputTokens,
                   COALESCE(SUM(u.output_tokens), 0) AS outputTokens,
                   COALESCE(SUM(u.reasoning_tokens), 0) AS reasoningTokens,
                   COALESCE(SUM(u.cache_tokens), 0) AS cacheTokens
            FROM ia_agent_model_call_usage u
            JOIN ia_agent_run r ON r.run_id = u.run_id
            WHERE u.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
            <if test="query.from != null"> AND u.started_at &gt;= #{query.from}</if>
            <if test="query.to != null"> AND u.started_at &lt; #{query.to}</if>
            <if test="query.appId != null"> AND u.app_id = #{query.appId}</if>
            <if test="query.userId != null"> AND r.user_id = #{query.userId}</if>
            GROUP BY 1, 2, 3, u.provider, u.model_code
            ORDER BY statDate DESC, u.app_id, u.model_code, r.user_id
            </script>
            """)
    IPage<UsageSummaryRow> selectUsageSummary(
            Page<UsageSummaryRow> page,
            @Param("query") UsageSummaryQuery query);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET status = 'COMPLETED',
                input_tokens = #{inputTokens},
                output_tokens = #{outputTokens},
                reasoning_tokens = #{reasoningTokens},
                cache_tokens = #{cacheTokens},
                usage_json = #{usageJson},
                finished_at = #{finishedAt},
                update_time = #{finishedAt}
            WHERE run_id = #{runId}
              AND model_call_id = #{modelCallId}
              AND status = 'STARTED'
            """)
    int completeStarted(
            @Param("runId") String runId,
            @Param("modelCallId") String modelCallId,
            @Param("inputTokens") Long inputTokens,
            @Param("outputTokens") Long outputTokens,
            @Param("reasoningTokens") Long reasoningTokens,
            @Param("cacheTokens") Long cacheTokens,
            @Param("usageJson") String usageJson,
            @Param("finishedAt") LocalDateTime finishedAt);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET status = #{status},
                finished_at = #{finishedAt},
                update_time = #{finishedAt}
            WHERE run_id = #{runId}
              AND model_call_id = #{modelCallId}
              AND status = 'STARTED'
            """)
    int finishStarted(
            @Param("runId") String runId,
            @Param("modelCallId") String modelCallId,
            @Param("status") String status,
            @Param("finishedAt") LocalDateTime finishedAt);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET status = #{status},
                finished_at = #{finishedAt},
                update_time = #{finishedAt}
            WHERE run_id = #{runId}
              AND status = 'STARTED'
            """)
    int finishAllStartedForRun(
            @Param("runId") String runId,
            @Param("status") String status,
            @Param("finishedAt") LocalDateTime finishedAt);

    @Select("""
            SELECT *
            FROM ia_agent_model_call_usage
            WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
              AND (
                    (settlement_status = 'PENDING'
                     AND (next_settlement_attempt_at IS NULL
                          OR next_settlement_attempt_at <= #{now}))
                 OR (settlement_status = 'CLAIMED'
                     AND settlement_claim_until <= #{now})
              )
            ORDER BY id
            LIMIT #{limit}
            FOR UPDATE
            """)
    List<AgentModelCallUsage> selectSettlementCandidatesForUpdate(
            @Param("now") LocalDateTime now,
            @Param("limit") int limit);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET settlement_status = 'CLAIMED',
                settlement_claim_owner = #{claimOwner},
                settlement_claim_until = #{claimUntil},
                settlement_attempts = settlement_attempts + 1,
                next_settlement_attempt_at = NULL,
                update_time = #{now}
            WHERE id = #{usageId}
              AND status IN ('COMPLETED', 'FAILED', 'CANCELLED')
              AND (
                    (settlement_status = 'PENDING'
                     AND (next_settlement_attempt_at IS NULL
                          OR next_settlement_attempt_at <= #{now}))
                 OR (settlement_status = 'CLAIMED'
                     AND settlement_claim_until <= #{now})
              )
            """)
    int claimCandidate(
            @Param("usageId") long usageId,
            @Param("claimOwner") String claimOwner,
            @Param("claimUntil") LocalDateTime claimUntil,
            @Param("now") LocalDateTime now);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET settlement_status = 'SETTLED',
                settlement_claim_owner = NULL,
                settlement_claim_until = NULL,
                next_settlement_attempt_at = NULL,
                downstream_settlement_id = #{downstreamSettlementId},
                last_settlement_error = NULL,
                update_time = (clock_timestamp() AT TIME ZONE 'UTC')
            WHERE id = #{usageId}
              AND settlement_status = 'CLAIMED'
              AND settlement_claim_owner = #{claimOwner}
              AND settlement_claim_until > (clock_timestamp() AT TIME ZONE 'UTC')
            """)
    int markSettled(
            @Param("usageId") long usageId,
            @Param("claimOwner") String claimOwner,
            @Param("downstreamSettlementId") String downstreamSettlementId);

    @Update("""
            UPDATE ia_agent_model_call_usage
            SET settlement_status = 'PENDING',
                settlement_claim_owner = NULL,
                settlement_claim_until = NULL,
                next_settlement_attempt_at = GREATEST(
                        #{nextAttemptAt}, (clock_timestamp() AT TIME ZONE 'UTC')),
                last_settlement_error = #{lastSettlementError},
                update_time = (clock_timestamp() AT TIME ZONE 'UTC')
            WHERE id = #{usageId}
              AND settlement_status = 'CLAIMED'
              AND settlement_claim_owner = #{claimOwner}
              AND settlement_claim_until > (clock_timestamp() AT TIME ZONE 'UTC')
            """)
    int releaseSettlementForRetry(
            @Param("usageId") long usageId,
            @Param("claimOwner") String claimOwner,
            @Param("nextAttemptAt") LocalDateTime nextAttemptAt,
            @Param("lastSettlementError") String lastSettlementError);

    @Update("""
            UPDATE ia_agent_run r
            SET usage_settled = TRUE,
                usage_settled_at = #{settledAt},
                update_time = #{settledAt}
            WHERE r.run_id = #{runId}
              AND r.usage_settled = FALSE
              AND r.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
              AND NOT EXISTS (
                    SELECT 1
                    FROM ia_agent_model_call_usage u
                    WHERE u.run_id = r.run_id
                      AND u.settlement_status <> 'SETTLED'
              )
            """)
    int markRunUsageSettledIfNoUnsettledCall(
            @Param("runId") String runId,
            @Param("settledAt") LocalDateTime settledAt);
}
