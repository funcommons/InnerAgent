package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentStateCleanupPolicy;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;

@Mapper
public interface AgentStateCleanupPolicyMapper
        extends BaseMapper<AgentStateCleanupPolicy> {

    @Select("""
            SELECT *
            FROM ia_agent_state_cleanup_policy
            WHERE id = 1
            FOR UPDATE
            """)
    AgentStateCleanupPolicy selectCurrentForUpdate();

    @Select("SELECT (clock_timestamp() AT TIME ZONE 'UTC')")
    LocalDateTime selectDatabaseNow();
}
