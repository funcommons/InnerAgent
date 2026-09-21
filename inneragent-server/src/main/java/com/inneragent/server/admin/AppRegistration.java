package com.inneragent.server.admin;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import com.inneragent.platform.common.handler.JsonbTypeHandler;
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
 *
 * <p>V14:熔断域配置落本行(circuit_limits_json/circuit_stopped 三列,优化
 * 建议 #2 服务端半)与 Webhook 订阅两列(webhook_enabled/webhook_events;
 * url/secret 列 V2 已有),供 CircuitBreakerAdminService/WebhookConfigAdminService
 * 读写。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName(value = "ia_app", autoResultMap = true)
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

    /** 熔断资源上限配置 JSON(V14;§4.7 默认值,执行层接线待后续) */
    @TableField(typeHandler = JsonbTypeHandler.class)
    private String circuitLimitsJson;

    /** 应用级紧急停用总开关(V14;TRUE 时新 run 拒绝 403) */
    private Boolean circuitStopped;

    /** 紧急停用时刻(恢复时清空;V14) */
    private LocalDateTime circuitStoppedAt;

    /** 紧急停用原因(恢复时清空;V14) */
    private String circuitStopReason;

    /** 终态 Webhook 投递总开关(V14;FALSE 时终态事件不入队) */
    private Boolean webhookEnabled;

    /** Webhook 订阅事件(逗号分隔 CSV;V14) */
    private String webhookEvents;

    /** 会话保留天数(超期物理清理,默认 180,ADR-9) */
    private Integer conversationRetentionDays;

    /** 状态:0-禁用 1-启用 */
    private Integer status;
}
