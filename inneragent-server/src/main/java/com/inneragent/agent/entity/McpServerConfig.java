package com.inneragent.agent.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 应用级三方 MCP 服务器配置(V18;PRD M2 三方 MCP,03-开发计划 §7.1 W13)。
 *
 * <p>管理面(/ia/api/v1/admin/mcp-servers)注册;工具清单经
 * {@code McpThirdPartyToolListCache}(LRU)聚入 McpToolCatalog。app 级治理表
 * (无 tenant_id 列,同 ia_tool_registry 形态):服务层查询显式携带 app_id,
 * 租户上下文可能存在的读取路径以系统模式执行。
 *
 * <p>凭据列 {@code credentials} 为 TEXT(DEF-08 教训:不用 JSONB/TypeHandler),
 * 值不进审计/日志;加密存储可延后。
 */
@TableName("ia_mcp_server_config")
@Data
@EqualsAndHashCode(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class McpServerConfig extends BaseEntity {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long appId;
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
