package com.inneragent.platform.skillhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.skillhub.IaSkill;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 应用级 Skill 目录 Mapper(ia_skill;V19,P4-W13)。
 *
 * <p>表为业务表(app_id 参与行级注入,不在 IGNORED_TABLES);注解 SQL 中
 * 显式携带 app_id 条件,拦截器重复注入同值条件语义无害。
 */
@Mapper
public interface IaSkillMapper extends BaseMapper<IaSkill> {

    /** 按应用+业务名定位(不含软删过滤:复活/唯一键判定用)。 */
    @Select("""
            SELECT *
            FROM ia_skill
            WHERE app_id = #{appId}
              AND name = #{name}
            LIMIT 1
            """)
    IaSkill selectAnyByAppAndName(@Param("appId") long appId,
                                  @Param("name") String name);

    /** 应用内当前激活数(status=active 且未删;激活上限判定)。 */
    @Select("""
            SELECT COUNT(*)
            FROM ia_skill
            WHERE app_id = #{appId}
              AND status = 'active'
              AND deleted = FALSE
            """)
    long countActive(@Param("appId") long appId);
}
