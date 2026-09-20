package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import com.inneragent.platform.common.TenantBaseEntity;

@TableName("ia_agent_event")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentEvent {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String runId;

    /** 所属租户（团队）ID */
    private Long tenantId;
    private Long sequenceNo;

    @Builder.Default
    private Integer schemaVersion = 1;

    private String rawEventId;
    private String rawEventType;
    private String source;
    private String replyId;
    private String blockId;
    private String toolCallId;
    private String parentToolCallId;
    private String agentName;
    private String outputType;
    private String payloadJson;
    private LocalDateTime eventCreatedAt;
    private LocalDateTime redisPublishedAt;
    private Boolean publishRequired;
    private String publishStatus;
    private String publishClaimOwner;
    private LocalDateTime publishClaimUntil;
    private LocalDateTime nextPublishAttemptAt;
    private String lastPublishError;

    @Builder.Default
    private Integer publishAttempts = 0;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
