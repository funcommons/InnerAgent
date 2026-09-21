package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.NonNull;

import java.time.LocalDateTime;
import com.inneragent.platform.common.TenantBaseEntity;

@TableName("ia_agent_run")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentRun {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String runId;
    private String conversationId;
    private Long userId;
    private Long projectId;

    /** 所属租户（团队）ID */
    private Long tenantId;
    private String agentType;
    private String parentRunId;
    private String parentToolCallId;
    private String agentName;
    private String kernelFingerprint;
    private String agentDefinitionSnapshotJson;
    private String agentStateSessionId;
    private String status;
    private String ownerInstanceId;

    @Builder.Default
    private Long ownerEpoch = 0L;

    private LocalDateTime leaseUntil;

    @Builder.Default
    private Long nextSequence = 1L;

    private Long terminalSequence;
    private String terminalOutputType;
    private LocalDateTime cancelRequestedAt;
    private LocalDateTime cancelBroadcastAt;
    private LocalDateTime cancelAcknowledgedAt;
    private LocalDateTime cancelNextAttemptAt;
    private String waitingReplyId;
    private String waitingToolCallId;
    private String waitingToolName;
    private LocalDateTime waitExpiresAt;
    private Long pausedThroughSequence;

    @NonNull
    private LocalDateTime deadlineAt;

    private LocalDateTime startedAt;
    private LocalDateTime heartbeatAt;
    private LocalDateTime finishedAt;
    private String errorCode;
    private String errorMessage;

    @Builder.Default
    private Boolean usageSettled = false;

    private LocalDateTime usageSettledAt;

    @Builder.Default
    private Long projectedThroughSequence = 0L;

    private LocalDateTime projectionCompletedAt;

    /**
     * [adapt] P4-W14 mini KB 引用溯源:运行组装命中的知识库分段清单
     * (JSON 字符串,TEXT 列 V20;DEF-08 教训 service 层序列化)。
     * 无命中为 NULL;终态 DONE 事件投影时回填 kbCitations(可选字段)。
     */
    private String kbCitationsJson;

    @TableField(
            value = "active_conversation_id",
            insertStrategy = FieldStrategy.NEVER,
            updateStrategy = FieldStrategy.NEVER)
    private String activeConversationId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
