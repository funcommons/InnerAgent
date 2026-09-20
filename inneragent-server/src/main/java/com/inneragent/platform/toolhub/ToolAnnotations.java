package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Objects;

/**
 * MCP 工具注解(readOnlyHint/destructiveHint/idempotentHint/openWorldHint)。
 *
 * <p>V15 裁定:注解是 hints,规范明示不可信——仅可信宿主(host_app)服务器
 * 的注解被采信为策略软输入;三方工具一律按写操作确认。本类型保存
 * 原始 JSON(ia_tool_registry.annotations_json)与解析后的四个布尔位。
 *
 * @param rawJson          原始注解 JSON(规范化后落库;null 表示宿主未提供)
 * @param readOnlyHint     只读提示(true → DEFAULT 模式自动执行)
 * @param destructiveHint  破坏性提示(true → 风险等级默认 high)
 * @param idempotentHint   幂等提示(true → resumeSafe 默认值来源,V34)
 * @param openWorldHint    开放世界提示(true → 确认卡出口警示)
 */
public record ToolAnnotations(
        String rawJson,
        Boolean readOnlyHint,
        Boolean destructiveHint,
        Boolean idempotentHint,
        Boolean openWorldHint) {

    public ToolAnnotations {
        rawJson = rawJson == null || rawJson.isBlank() ? null : rawJson;
    }

    public static ToolAnnotations empty() {
        return new ToolAnnotations(null, null, null, null, null);
    }

    /**
     * 解析注解 JSON(容忍 null/非对象;未知字段保留在 rawJson 中)。
     */
    public static ToolAnnotations parse(ObjectMapper objectMapper, String annotationsJson) {
        if (annotationsJson == null || annotationsJson.isBlank()) {
            return empty();
        }
        try {
            JsonNode node = objectMapper.readTree(annotationsJson);
            if (node == null || !node.isObject()) {
                return empty();
            }
            String normalized = objectMapper.writeValueAsString(node);
            return new ToolAnnotations(
                    normalized,
                    booleanValue(node, "readOnlyHint"),
                    booleanValue(node, "destructiveHint"),
                    booleanValue(node, "idempotentHint"),
                    booleanValue(node, "openWorldHint"));
        } catch (Exception invalid) {
            throw new IllegalArgumentException("工具注解不是合法 JSON: " + invalid.getMessage(),
                    invalid);
        }
    }

    private static Boolean booleanValue(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isBoolean() ? value.asBoolean() : null;
    }

    /** 注解安全位是否与另一份注解一致(分诊用:仅比较安全相关两位)。 */
    public boolean safetyBitsEqual(ToolAnnotations other) {
        Objects.requireNonNull(other, "other must not be null");
        return Objects.equals(readOnlyHint, other.readOnlyHint())
                && Objects.equals(destructiveHint, other.destructiveHint());
    }
}
