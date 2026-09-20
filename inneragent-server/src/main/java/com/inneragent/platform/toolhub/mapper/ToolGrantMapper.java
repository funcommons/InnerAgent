package com.inneragent.platform.toolhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.toolhub.ToolGrant;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * ia_tool_grant 读写 Mapper(授权管理 + 确认档位映射输入)。
 */
@Mapper
public interface ToolGrantMapper extends BaseMapper<ToolGrant> {

    /** 用户在某工具上的有效授权(deleted=FALSE 且未自动失效) */
    @Select("""
            SELECT *
            FROM ia_tool_grant
            WHERE user_id = #{userId}
              AND tool_fqn = #{toolFqn}
              AND deleted = FALSE
              AND invalidated = FALSE
            ORDER BY id
            """)
    List<ToolGrant> selectActiveByUserAndFqn(
            @Param("userId") long userId,
            @Param("toolFqn") String toolFqn);

    /**
     * 用户的永久授权集合(确认档位映射:DEFAULT 模式下写操作免确认依据;
     * 会话级授权由确认流按 conversationId 追加,不进本查询)。
     */
    @Select("""
            SELECT *
            FROM ia_tool_grant
            WHERE user_id = #{userId}
              AND scope = 'permanent'
              AND deleted = FALSE
              AND invalidated = FALSE
            ORDER BY id
            """)
    List<ToolGrant> selectActivePermanentByUser(@Param("userId") long userId);

    /** 某工具上的全部有效授权(风险升级/安全 schema 变更时级联失效) */
    @Select("""
            SELECT *
            FROM ia_tool_grant
            WHERE tool_fqn = #{toolFqn}
              AND deleted = FALSE
              AND invalidated = FALSE
            ORDER BY id
            """)
    List<ToolGrant> selectActiveByFqn(@Param("toolFqn") String toolFqn);
}
