package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.AgentDefinition;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Agent 定义 Mapper(ia_agent_definition;P2-W5 定义管理/导入导出)。
 *
 * <p>表为平台级({@code AppTenantLineInnerInterceptor#IGNORED_TABLES}),
 * 行级 app_id 不自动注入,归属过滤一律显式(appId 条件/唯一键定位)。
 */
@Mapper
public interface AgentDefinitionMapper extends BaseMapper<AgentDefinition> {

    /**
     * 按应用 + 业务标识定位活跃定义(唯一键 uk_ia_agent_definition_key;
     * deleted=FALSE 由注解重复声明,显式写出以直读语义自洽)。
     */
    @Select("""
            SELECT *
            FROM ia_agent_definition
            WHERE app_id = #{appId}
              AND agent_key = #{agentKey}
              AND deleted = FALSE
            LIMIT 1
            """)
    AgentDefinition selectByAppAndKey(@Param("appId") long appId,
                                      @Param("agentKey") String agentKey);
}
