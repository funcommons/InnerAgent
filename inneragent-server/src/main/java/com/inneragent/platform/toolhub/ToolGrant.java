package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.TenantBaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 用户工具授权(ia_tool_grant,V2 DDL + V6 生命周期列;PRD §6.2.4/04-调研 V18)。
 *
 * <p>「总是允许/本会话允许」的持久化:deleted=TRUE 为主动撤销,
 * invalidated=TRUE 为自动失效(风险升级/安全 schema 变更/工具停用注销);
 * 授予时快照风险等级与 schema 指纹,用于失效判定与审计。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_tool_grant")
public class ToolGrant extends TenantBaseEntity {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(单应用部署固定 1;由行级拦截器显式注入) */
    private Long appId;

    /** 被授权用户 ID */
    private Long userId;

    /** 工具全限定名(ia_tool_registry.fqn) */
    private String toolFqn;

    /** 授权作用域:conversation-本会话 permanent-永久 */
    private String scope;

    /** 会话 ID(ia_agent_conversation.conversation_id UUID;scope=permanent 时为 NULL) */
    private String conversationId;

    /** 授予时工具风险等级快照 */
    private String riskAtGrant;

    /** 授予时 schema SHA-256 快照(安全 schema 变更失效判定) */
    private String schemaSha256;

    /** 授权来源:live-confirm(确认流)/admin */
    private String source;

    /** 是否已自动失效(区别于 deleted 主动撤销) */
    private Boolean invalidated;

    /** 自动失效原因:risk_upgrade/schema_breaking/tool_disabled/tool_deleted */
    private String invalidatedReason;

    /** 授予决策记录(操作说明/来源上下文) */
    private String decisionNote;
}
