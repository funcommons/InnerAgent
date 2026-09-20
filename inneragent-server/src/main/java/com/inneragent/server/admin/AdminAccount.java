package com.inneragent.server.admin;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理站内置管理员账号(ia_admin_account,V10 DDL;02-技术方案 §6.3)。
 *
 * <p>口令散列为 Argon2id(spring-security {@code Argon2PasswordEncoder},
 * salt 16B/hash 32B/parallelism 1/memory 16 MiB/iterations 2,参数封存于
 * V10 迁移注释);校验经 {@code matches} 自描述哈希完成,改参数不破坏存量行。
 * 平台级表(管理员跨应用):不参与 app_id/tenant_id 行级注入
 * (AppTenantLineInnerInterceptor.IGNORED_TABLES),列仍按迁移规范保留。
 */
@Data
@TableName("ia_admin_account")
public class AdminAccount {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(平台级账号,单应用部署固定 1;迁移规范强制携带) */
    private Long appId;

    /** 所属租户 ID(平台级账号固定 0) */
    private Long tenantId;

    /** 登录用户名(全局唯一) */
    private String username;

    /** Argon2id 口令散列($argon2id$…,含盐自校验;绝不下发) */
    private String passwordHash;

    /** 连续登录失败次数(成功清零;达阈值锁定) */
    private Integer failedAttempts;

    /** 锁定截止时间(NULL=未锁定) */
    private LocalDateTime lockedUntil;

    /** 账号状态:1-启用 0-停用 */
    private Integer status;

    /** 最近一次成功登录时间 */
    private LocalDateTime lastLoginAt;

    /** 备注 */
    private String remark;

    /** 创建时间(DDL 默认兜底) */
    private LocalDateTime createTime;

    /** 更新时间(更新路径显式回写) */
    private LocalDateTime updateTime;
}
