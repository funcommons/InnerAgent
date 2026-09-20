package com.inneragent.server.admin;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理员登录审计(ia_admin_login_log,V10 DDL;仅追加,无更新/删除)。
 *
 * <p>全部登录尝试落库(含成功与一切失败形态:账号不存在/密码错误/锁定中/
 * 已停用),支撑 02-技术方案 §6.3「登录审计」与爆破行为回溯。
 * 与 ia_audit_log(工具决策审计)分域:登录事件无工具生命周期字段,
 * 独立表避免值域稀释(文档未定处自拟,见 V10 迁移头注)。
 */
@Data
@TableName("ia_admin_login_log")
public class AdminLoginLog {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(平台级审计,固定 1;迁移规范强制携带) */
    private Long appId;

    /** 所属租户 ID(平台级审计固定 0) */
    private Long tenantId;

    /** 尝试登录的用户名(原样记录,含不存在的账号) */
    private String username;

    /** 发起方 IP(X-Forwarded-For 首值,缺省 remoteAddr) */
    private String ip;

    /** 是否登录成功 */
    private Boolean success;

    /** 失败原因(成功为 NULL) */
    private String failReason;

    /** 创建时间(仅追加;DDL 默认兜底) */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
