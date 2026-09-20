package com.inneragent.server.admin.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.server.admin.AdminLoginLog;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 管理员登录审计 Mapper(ia_admin_login_log,仅追加;不提供 update/delete)。
 */
@Mapper
public interface AdminLoginLogMapper extends BaseMapper<AdminLoginLog> {

    /**
     * 显式 INSERT(列集与实体对齐,create_time 由 DDL 默认值兜底)。
     * 失败吞掉不影响登录主流程(审计尽力而为;与 ia_audit_log 的 fail-closed
     * 语义相反:登录审计缺失不构成安全决策失效)。
     */
    @Insert("""
            INSERT INTO ia_admin_login_log (
                app_id, tenant_id, username, ip, success, fail_reason
            ) VALUES (
                #{e.appId}, #{e.tenantId}, #{e.username}, #{e.ip}, #{e.success}, #{e.failReason}
            )
            """)
    int append(@Param("e") AdminLoginLog entry);
}
