package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 工具调用/决策审计(ia_audit_log,V2 DDL;仅追加,无更新/删除)。
 *
 * <p>V22:decision_source 必填(V2 已建列,P1-T2a 起由写入方填充),
 * 使「高危 100% 确认」可从日志证明。conversation_id 为会话 UUID
 * (V6 改为 VARCHAR(64),对齐 ia_agent_conversation.conversation_id)。
 */
@Data
@TableName("ia_audit_log")
public class ToolAuditLog {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(行级拦截器显式注入) */
    private Long appId;

    /** 所属租户 ID(无租户上下文时落 DDL 默认 0) */
    private Long tenantId;

    /** 发起用户 ID */
    private Long userId;

    /** 会话 ID(UUID) */
    private String conversationId;

    /** 运行 ID */
    private String runId;

    /** 工具全限定名 */
    private String toolFqn;

    /** 裁决结果:allowed-放行 denied-拒绝;授权生命周期:granted/revoked/invalidated */
    private String decision;

    /** 裁决来源(V22):mode-default/user-grant/forced-policy/live-confirm/full-access */
    private String decisionSource;

    /** 裁决时工具风险等级 */
    private String riskLevel;

    /** 工具入参(敏感字段脱敏后 JSON) */
    private String paramsMaskedJson;

    /** 执行结果摘要 */
    private String resultSummary;

    /** 失败错误信息 */
    private String errorText;

    /** 工具执行耗时(毫秒) */
    private Long durationMs;

    /** 创建时间(仅追加) */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
