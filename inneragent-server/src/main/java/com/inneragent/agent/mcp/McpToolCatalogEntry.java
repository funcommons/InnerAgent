package com.inneragent.agent.mcp;

import com.inneragent.platform.toolhub.ToolAnnotations;

/**
 * 工具目录条目(McpToolCatalog 聚合视图;P1-T2a [new])。
 *
 * <p>合并注册表治理字段与注解派生位;readOnlyEffective 仅在注解可信
 * (host_app 来源,V15)时采信 readOnlyHint,三方工具一律按写操作确认。
 *
 * @param granted          当前用户是否持有有效 permanent 授权(catalogForUser 填充)
 */
public record McpToolCatalogEntry(
        Long id,
        String fqn,
        String serverKey,
        String toolName,
        String description,
        String parametersSchemaJson,
        String schemaSha256,
        String riskLevel,
        String adminPolicy,
        boolean resumeSafe,
        boolean concurrencySafe,
        boolean enabled,
        boolean revalidateRequired,
        boolean annotationsTrusted,
        boolean readOnlyEffective,
        boolean destructiveHint,
        boolean idempotentHint,
        boolean openWorldHint,
        boolean granted) {

    public static McpToolCatalogEntry of(
            com.inneragent.platform.toolhub.ToolRegistryEntry entry,
            ToolAnnotations annotations,
            boolean granted) {
        boolean trusted = com.inneragent.platform.toolhub.ToolRegistryService.SOURCE_HOST_APP
                .equals(entry.getSource());
        return new McpToolCatalogEntry(
                entry.getId(),
                entry.getFqn(),
                entry.getServerKey(),
                entry.getToolName(),
                entry.getDescription(),
                entry.getParametersSchema(),
                entry.getSchemaSha256(),
                entry.getRiskLevel(),
                entry.getAdminPolicy(),
                Boolean.TRUE.equals(entry.getResumeSafe()),
                Boolean.TRUE.equals(entry.getConcurrencySafe()),
                Boolean.TRUE.equals(entry.getEnabled()),
                Boolean.TRUE.equals(entry.getRevalidateRequired()),
                trusted,
                // V15:注解仅可信宿主采信;三方一律视为写操作(readOnly=false)
                trusted && Boolean.TRUE.equals(annotations.readOnlyHint()),
                Boolean.TRUE.equals(annotations.destructiveHint()),
                Boolean.TRUE.equals(annotations.idempotentHint()),
                Boolean.TRUE.equals(annotations.openWorldHint()),
                granted);
    }
}
