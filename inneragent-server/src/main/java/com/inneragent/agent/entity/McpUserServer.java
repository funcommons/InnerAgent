package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.TenantBaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 用户级三方 MCP 服务器配置(V18;PRD M2 三方 MCP,03-开发计划 §7.1 W13)。
 *
 * <p>用户面(/ia/api/v1/mcp-servers,embed token 链)自接;行级 userId 隔离
 * ——他人不可见/不可调用。继承 {@link TenantBaseEntity}(同 ia_agent_mcp_server
 * 形态):用户面请求携带租户上下文,行级拦截器按列注入。
 */
@TableName("ia_mcp_user_server")
@Data
@EqualsAndHashCode(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class McpUserServer extends TenantBaseEntity {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long appId;
    private Long userId;
    private String serverKey;
    private String name;
    private String endpointUrl;
    private String transport;
    private String authType;
    private String headerName;
    private String credentials;
    private Integer timeoutSeconds;
    private Boolean enabled;
}
