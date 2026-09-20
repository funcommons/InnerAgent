package com.inneragent.platform.toolhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

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

    /**
     * 复活逻辑删行(DEF-03):显式 SQL 置 deleted=FALSE。
     *
     * <p>必须绕过 MyBatis-Plus 逻辑删机制——实体 deleted 字段带 {@code @TableLogic},
     * {@code updateById} 会被追加 {@code WHERE deleted = false},对逻辑删行更新
     * 0 行静默失效(唯一键被死行永久占用)。复活后再走常规 {@code updateById}
     * 完成字段更新。</p>
     */
    @Update("""
            UPDATE ia_tool_registry
            SET deleted = FALSE
            WHERE id = #{id}
            """)
    int revive(@Param("id") long id);

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
