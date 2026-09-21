package com.inneragent.platform.skillhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.skillhub.IaSkill;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 应用级 Skill 目录 Mapper(ia_skill;V19,P4-W13)。
 *
 * <p>表为业务表(app_id 参与行级注入,不在 IGNORED_TABLES);注解 SQL 中
 * 显式携带 app_id 条件,拦截器重复注入同值条件语义无害。
 *
 * <p>deleted 为 @TableLogic 字段:MP 常规 updateById 不参与 SET 且自动追加
 * deleted=FALSE 条件,故「软删」与「复活」走显式 SQL(同 tool_revived 先例)。
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

    /** 软删 + 复位激活位(单条 SQL 保证删除语义原子)。 */
    @Update("""
            UPDATE ia_skill
            SET deleted = TRUE,
                status = 'inactive',
                activated_at = NULL,
                activated_by = NULL
            WHERE id = #{id}
              AND deleted = FALSE
            """)
    int softDelete(@Param("id") long id);

    /** 复活(软删行重导入;deleted 列不可经 MP 常规更新)。 */
    @Update("""
            UPDATE ia_skill
            SET deleted = FALSE
            WHERE id = #{id}
              AND deleted = TRUE
            """)
    int undelete(@Param("id") long id);
}
