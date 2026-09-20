package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentWorkspaceEntry;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AgentWorkspaceEntryMapper extends BaseMapper<AgentWorkspaceEntry> {

    @Select("""
            SELECT * FROM ia_agent_workspace_entry
            WHERE namespace_hash = #{namespaceHash} AND item_hash = #{itemHash} AND deleted = FALSE
            LIMIT 1 FOR UPDATE
            """)
    AgentWorkspaceEntry selectForUpdate(
            @Param("namespaceHash") String namespaceHash,
            @Param("itemHash") String itemHash);

    @Delete("DELETE FROM ia_agent_workspace_entry WHERE id = #{id}")
    int physicalDeleteById(@Param("id") Long id);

    @Select("SELECT COALESCE(SUM(content_size), 0) FROM ia_agent_workspace_entry WHERE deleted = FALSE")
    long sumContentSize();
}
