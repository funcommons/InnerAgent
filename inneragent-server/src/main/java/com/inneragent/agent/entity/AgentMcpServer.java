package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import com.inneragent.platform.common.TenantBaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@TableName("ia_agent_mcp_server")
@Data
@EqualsAndHashCode(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AgentMcpServer extends TenantBaseEntity {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String name;
    private String transport;
    private String url;
    private String headersJson;
    private String queryParamsJson;
    private String enabledToolsJson;
    private String protocolVersionsJson;
    private Integer timeoutSeconds;
    private Integer initializationTimeoutSeconds;
    private Integer status;
    private String lastTestStatus;
    private String lastTestMessage;
}
