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

    /**
     * [adapt] 多应用运行 500 二轮根修:所属应用 ID。运行期事件写入以运行行
     * 归属显式落列(见 MySqlAgentEventRepository#insertEvent,与 tenantId
     * 同范);未显式设置时(null,NOT_NULL 策略不落列)仍由行级拦截器按
     * 环境注入,读路径 SELECT * 反查映射。
     */
    private Long appId;

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
