package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentEvent;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface AgentEventMapper extends BaseMapper<AgentEvent> {

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND sequence_no = #{sequenceNo}
            LIMIT 1
            """)
    AgentEvent selectByRunAndSequence(
            @Param("runId") String runId,
            @Param("sequenceNo") long sequenceNo);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE publish_required = TRUE
              AND publish_status = 'PENDING'
              AND (next_publish_attempt_at IS NULL
                   OR next_publish_attempt_at <= #{now})
            ORDER BY next_publish_attempt_at, id
            LIMIT #{limit}
            FOR UPDATE SKIP LOCKED
            """)
    List<AgentEvent> selectPendingPublishCandidatesForUpdate(
            @Param("now") LocalDateTime now,
            @Param("limit") int limit);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE publish_required = TRUE
              AND publish_status = 'CLAIMED'
              AND publish_claim_until <= #{now}
            ORDER BY id
            LIMIT #{limit}
            FOR UPDATE SKIP LOCKED
            """)
    List<AgentEvent> selectExpiredPublishCandidatesForUpdate(
            @Param("now") LocalDateTime now,
            @Param("limit") int limit);

    @Update("""
            UPDATE ia_agent_event
            SET publish_status = 'CLAIMED',
                publish_claim_owner = #{claimOwner},
                publish_claim_until = #{claimUntil},
                publish_attempts = publish_attempts + 1,
                next_publish_attempt_at = NULL
            WHERE id = #{eventId}
              AND publish_required = TRUE
              AND (
                    (publish_status = 'PENDING'
                     AND (next_publish_attempt_at IS NULL
                          OR next_publish_attempt_at <= #{now}))
                 OR (publish_status = 'CLAIMED'
                     AND publish_claim_until <= #{now})
              )
            """)
    int claimPublishCandidate(
            @Param("eventId") long eventId,
            @Param("claimOwner") String claimOwner,
            @Param("claimUntil") LocalDateTime claimUntil,
            @Param("now") LocalDateTime now);

    /**
     * [O-1] 批量认领:调用方已在同一事务内以 FOR UPDATE SKIP LOCKED 锁定
     * 候选行,守卫与 {@link #claimPublishCandidate} 完全一致,单条
     * UPDATE ... IN 完成整批认领(每批 O(n) 次往返 → O(1) 次)。
     *
     * @return 实际认领行数;与候选数不符说明行在锁外被改动,调用方必须回滚
     */
    @Update("""
            <script>
            UPDATE ia_agent_event
            SET publish_status = 'CLAIMED',
                publish_claim_owner = #{claimOwner},
                publish_claim_until = #{claimUntil},
                publish_attempts = publish_attempts + 1,
                next_publish_attempt_at = NULL
            WHERE publish_required = TRUE
              AND id IN
              <foreach collection="eventIds" item="eventId" open="(" separator="," close=")">#{eventId}</foreach>
              AND (
                    (publish_status = 'PENDING'
                     AND (next_publish_attempt_at IS NULL
                          OR next_publish_attempt_at &lt;= #{now}))
                 OR (publish_status = 'CLAIMED'
                     AND publish_claim_until &lt;= #{now})
              )
            </script>
            """)
    int claimPublishCandidatesBatch(
            @Param("claimOwner") String claimOwner,
            @Param("claimUntil") LocalDateTime claimUntil,
            @Param("now") LocalDateTime now,
            @Param("eventIds") List<Long> eventIds);

    @Update("""
            UPDATE ia_agent_event
            SET publish_status = 'PUBLISHED',
                redis_published_at = (clock_timestamp() AT TIME ZONE 'UTC'),
                publish_claim_owner = NULL,
                publish_claim_until = NULL,
                next_publish_attempt_at = NULL,
                last_publish_error = NULL
            WHERE id = #{eventId}
              AND publish_status = 'CLAIMED'
              AND publish_claim_owner = #{claimOwner}
              AND publish_claim_until > (clock_timestamp() AT TIME ZONE 'UTC')
            """)
    int markPublished(
            @Param("eventId") long eventId,
            @Param("claimOwner") String claimOwner);

    /**
     * [O-1] 批量 ack:守卫与 {@link #markPublished} 完全一致(认领令牌匹配
     * 且 30s 租约未过期),整批成功唤醒后一次 UPDATE ... IN 完成。
     *
     * @return 实际更新行数;少于入参数量说明有事件租约被抢,调用方回退逐条判定
     */
    @Update("""
            <script>
            UPDATE ia_agent_event
            SET publish_status = 'PUBLISHED',
                redis_published_at = (clock_timestamp() AT TIME ZONE 'UTC'),
                publish_claim_owner = NULL,
                publish_claim_until = NULL,
                next_publish_attempt_at = NULL,
                last_publish_error = NULL
            WHERE publish_status = 'CLAIMED'
              AND publish_claim_owner = #{claimOwner}
              AND publish_claim_until > (clock_timestamp() AT TIME ZONE 'UTC')
              AND id IN
              <foreach collection="eventIds" item="eventId" open="(" separator="," close=")">#{eventId}</foreach>
            </script>
            """)
    int markPublishedBatch(
            @Param("claimOwner") String claimOwner,
            @Param("eventIds") List<Long> eventIds);

    @Update("""
            UPDATE ia_agent_event
            SET publish_status = 'PENDING',
                publish_claim_owner = NULL,
                publish_claim_until = NULL,
                next_publish_attempt_at = GREATEST(
                        #{nextAttemptAt}, (clock_timestamp() AT TIME ZONE 'UTC')),
                last_publish_error = #{lastPublishError}
            WHERE id = #{eventId}
              AND publish_status = 'CLAIMED'
              AND publish_claim_owner = #{claimOwner}
              AND publish_claim_until > (clock_timestamp() AT TIME ZONE 'UTC')
            """)
    int releasePublishForRetry(
            @Param("eventId") long eventId,
            @Param("claimOwner") String claimOwner,
            @Param("nextAttemptAt") LocalDateTime nextAttemptAt,
            @Param("lastPublishError") String lastPublishError);

    @Select("""
            SELECT COUNT(*)
            FROM ia_agent_event
            WHERE publish_required = TRUE
              AND publish_status <> 'PUBLISHED'
            """)
    long countOutstandingPublish();

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND sequence_no > #{afterSequence}
              AND sequence_no <= #{throughSequence}
            ORDER BY sequence_no
            LIMIT #{limit}
            """)
    List<AgentEvent> selectProjectionRange(
            @Param("runId") String runId,
            @Param("afterSequence") long afterSequence,
            @Param("throughSequence") long throughSequence,
            @Param("limit") int limit);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND sequence_no > #{afterSequence}
              AND sequence_no <= #{throughSequence}
            ORDER BY sequence_no
            LIMIT #{limit}
            """)
    List<AgentEvent> selectReplayRange(
            @Param("runId") String runId,
            @Param("afterSequence") long afterSequence,
            @Param("throughSequence") long throughSequence,
            @Param("limit") int limit);

    @Select("""
            SELECT COALESCE(MAX(sequence_no), 0)
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND sequence_no < #{beforeSequence}
              AND output_type IS NOT NULL
              AND output_type NOT IN ('CONTENT', 'REASONING')
              AND parent_tool_call_id IS NOT DISTINCT FROM #{parentToolCallId}
            """)
    long selectLastContextBoundarySequence(
            @Param("runId") String runId,
            @Param("beforeSequence") long beforeSequence,
            @Param("parentToolCallId") String parentToolCallId);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND sequence_no > #{afterSequence}
              AND sequence_no < #{beforeSequence}
              AND output_type IN ('CONTENT', 'REASONING')
              AND parent_tool_call_id IS NOT DISTINCT FROM #{parentToolCallId}
            ORDER BY sequence_no
            """)
    List<AgentEvent> selectContextDeltas(
            @Param("runId") String runId,
            @Param("afterSequence") long afterSequence,
            @Param("beforeSequence") long beforeSequence,
            @Param("parentToolCallId") String parentToolCallId);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND tool_call_id = #{toolCallId}
              AND sequence_no <= #{throughSequence}
              AND raw_event_type IN (
                    'TOOL_CALL_DELTA',
                    'TOOL_RESULT_TEXT_DELTA',
                    'TOOL_RESULT_DATA_DELTA')
            ORDER BY sequence_no
            """)
    List<AgentEvent> selectToolDeltas(
            @Param("runId") String runId,
            @Param("toolCallId") String toolCallId,
            @Param("throughSequence") long throughSequence);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND reply_id = #{replyId}
              AND raw_event_type = 'REQUIRE_USER_CONFIRM'
              AND source = 'platform/waiting-candidate'
            ORDER BY sequence_no DESC
            LIMIT 1
            """)
    AgentEvent selectConfirmationCandidate(
            @Param("runId") String runId,
            @Param("replyId") String replyId);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND raw_event_type = 'REQUIRE_USER_CONFIRM'
              AND source = 'platform/waiting-candidate'
            ORDER BY sequence_no DESC
            LIMIT 1
            """)
    AgentEvent selectLatestConfirmationCandidate(@Param("runId") String runId);

    @Select("""
            SELECT *
            FROM ia_agent_event
            WHERE run_id = #{runId}
              AND tool_call_id = #{toolCallId}
              AND raw_event_type = 'PLATFORM_REQUIRE_EXTERNAL_EXECUTION'
              AND source = 'platform/waiting'
            ORDER BY sequence_no DESC
            LIMIT 1
            """)
    AgentEvent selectPendingExternalExecution(
            @Param("runId") String runId,
            @Param("toolCallId") String toolCallId);
}
