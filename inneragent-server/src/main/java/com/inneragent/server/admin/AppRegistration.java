package com.inneragent.server.admin;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 宿主应用注册(ia_app,V2 DDL;02-技术方案 §5.1)。
 *
 * <p>应用为隔离一等实体(PRD §6.9):embed token 以 appKey 定位本行,
 * sign_public_key 用于验签,ia_app.id 即各业务表 app_id。单应用部署预置
 * id=1 的 default 应用;行级双列拦截器对本表不注入 app_id/tenant_id
 * (见 AppTenantLineInnerInterceptor.IGNORED_TABLES)。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_app")
public class AppRegistration extends BaseEntity {

    /** 主键 ID(即各业务表 app_id) */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 应用唯一标识(embed token iss 与 SDK 初始化使用;唯一约束 uk_ia_app_key) */
    private String appKey;

    /** 应用名称 */
    private String name;

    /** 宿主应用签名公钥(PEM;embed token RS256 验签) */
    private String signPublicKey;

    /** 上一代签名公钥(PEM;轮换宽限期内存量 embed token 验签用,再次轮换覆盖;V9) */
    private String previousSignPublicKey;

    /** 当前签名公钥的轮换时刻(宽限期起点;NULL 表示从未轮换;V9) */
    private LocalDateTime signKeyRotatedAt;

    /** 终态通知 Webhook 回调地址(可空) */
    private String webhookUrl;

    /** Webhook 回调签名密钥(可空) */
    private String webhookSecret;

    /** 会话保留天数(超期物理清理,默认 180,ADR-9) */
    private Integer conversationRetentionDays;

    /** 状态:0-禁用 1-启用 */
    private Integer status;
}
