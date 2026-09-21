package com.inneragent.server.controller.vo;

import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.entity.McpUserServer;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 三方 MCP 服务器响应体(P4-W13)。<strong>credentials 永不回显原文</strong>
 * ——仅打码形(前 2 字符 + ***),值不进审计/日志的口径延伸到 API 响应。
 */
@Schema(description = "三方 MCP 服务器配置")
public record McpServerRespVO(
        Long id,
        String serverKey,
        String name,
        String endpointUrl,
        String transport,
        String authType,
        String headerName,
        @Schema(description = "静态头值(打码)") String credentialsMasked,
        Integer timeoutSeconds,
        Boolean enabled,
        LocalDateTime updateTime) {

    public static McpServerRespVO of(McpServerConfig row) {
        return new McpServerRespVO(row.getId(), row.getServerKey(), row.getName(),
                row.getEndpointUrl(), row.getTransport(), row.getAuthType(),
                row.getHeaderName(), mask(row.getCredentials()), row.getTimeoutSeconds(),
                row.getEnabled(), row.getUpdateTime());
    }

    public static McpServerRespVO of(McpUserServer row) {
        return new McpServerRespVO(row.getId(), row.getServerKey(), row.getName(),
                row.getEndpointUrl(), row.getTransport(), row.getAuthType(),
                row.getHeaderName(), mask(row.getCredentials()), row.getTimeoutSeconds(),
                row.getEnabled(), row.getUpdateTime());
    }

    private static String mask(String credentials) {
        if (credentials == null || credentials.isBlank()) {
            return null;
        }
        return credentials.length() <= 2 ? "***" : credentials.substring(0, 2) + "***";
    }
}
