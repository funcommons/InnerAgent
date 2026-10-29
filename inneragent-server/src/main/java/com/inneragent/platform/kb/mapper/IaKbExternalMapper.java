package com.inneragent.platform.kb.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.kb.IaKbExternal;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 外部知识库登记 Mapper(ia_kb_external;V26)。表为业务表(app_id 参与行级
 * 注入,不在 IGNORED_TABLES);注解 SQL 显式携带 app_id 条件,拦截器重复注入
 * 同值条件语义无害;deleted 为 @TableLogic 字段,软删走显式 SQL(同 ia_skill)。
 */
@Mapper
public interface IaKbExternalMapper extends BaseMapper<IaKbExternal> {

    /** 应用内活跃登记数(每应用上限 1 判定)。 */
    @Select("SELECT COUNT(*) FROM ia_kb_external WHERE app_id = #{appId} AND deleted = FALSE")
    long countActive(@Param("appId") long appId);

    /** 软删(活跃行不占唯一键与额度,同应用可重新登记;幂等)。 */
    @Update("""
            UPDATE ia_kb_external SET deleted = TRUE, status = 'inactive'
            WHERE id = #{id} AND app_id = #{appId} AND deleted = FALSE
            """)
    int softDelete(@Param("appId") long appId, @Param("id") long id);
}
