package com.inneragent.server.admin.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.server.admin.AppRegistration;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * ia_app 读写 Mapper(embed 验签公钥加载 + 应用注册管理)。
 */
@Mapper
public interface AppRegistrationMapper extends BaseMapper<AppRegistration> {

    @Select("""
            SELECT *
            FROM ia_app
            WHERE app_key = #{appKey}
              AND deleted = FALSE
            LIMIT 1
            """)
    AppRegistration selectByAppKey(@Param("appKey") String appKey);
}
