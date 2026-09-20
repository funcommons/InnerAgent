package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentWorkspaceConfig;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AgentWorkspaceConfigMapper extends BaseMapper<AgentWorkspaceConfig> {

    @Select("SELECT * FROM ia_agent_workspace_config WHERE id = 1 AND deleted = FALSE FOR UPDATE")
    AgentWorkspaceConfig selectCurrentForUpdate();
}
