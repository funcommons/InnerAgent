package com.inneragent.platform.toolhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * ia_tool_registry 读写 Mapper(工具注册管理 + McpToolCatalog 聚合)。
 *
 * <p>注:本表已纳入 app_id 行级拦截(P1-T2a),裸 SQL 会自动追加 app_id 条件。
 */
@Mapper
public interface ToolRegistryMapper extends BaseMapper<ToolRegistryEntry> {

    /** 按 FQN 精确查找(含逻辑删除行,供重复注册时复活,规避唯一键残留) */
    @Select("""
            SELECT *
            FROM ia_tool_registry
            WHERE fqn = #{fqn}
            LIMIT 1
            """)
    ToolRegistryEntry selectByFqnIncludingDeleted(@Param("fqn") String fqn);

    /** 应用内按工具名查找(未删除;工具名应用内唯一,冲突保护 PRD §6.2.1) */
    @Select("""
            SELECT *
            FROM ia_tool_registry
            WHERE tool_name = #{toolName}
              AND deleted = FALSE
            LIMIT 1
            """)
    ToolRegistryEntry selectActiveByToolName(@Param("toolName") String toolName);
}
