package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentMessage;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

@Mapper
public interface AgentMessageMapper extends BaseMapper<AgentMessage> {

    @Select("""
            SELECT MIN(message_order)
            FROM ia_agent_message
            WHERE run_id = #{runId}
              AND deleted = FALSE
            """)
    Long selectInitialOrderByRunId(@Param("runId") String runId);

    @Select("""
            SELECT *
            FROM ia_agent_message
            WHERE projection_key = #{projectionKey}
            LIMIT 1
            """)
    AgentMessage selectByProjectionKey(@Param("projectionKey") String projectionKey);

    @Update("""
            UPDATE ia_agent_message AS call_message
            SET tool_status = 'cancelled',
                update_time = #{updateTime}
            WHERE call_message.run_id = #{runId}
              AND call_message.role = 'tool'
              AND call_message.tool_status = 'running'
              AND call_message.deleted = FALSE
              AND NOT EXISTS (
                  SELECT 1
                  FROM ia_agent_message result_message
                  WHERE result_message.run_id = call_message.run_id
                    AND result_message.tool_call_id = call_message.tool_call_id
                    AND result_message.role = 'tool'
                    AND result_message.tool_status IN ('success', 'error', 'cancelled')
                    AND result_message.deleted = FALSE
              )
            """)
    int cancelUnfinishedTools(
            @Param("runId") String runId,
            @Param("updateTime") LocalDateTime updateTime);
}
