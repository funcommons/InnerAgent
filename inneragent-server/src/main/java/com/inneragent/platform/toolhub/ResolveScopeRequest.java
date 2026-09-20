package com.inneragent.platform.toolhub;

import java.util.Map;

/**
 * resolve_scope 反查入参(02-技术方案 §4.3 协议字段)。
 *
 * @param pageId     当前页标识(SDK setPage 上报)
 * @param objectId   当前对象标识(SDK setObject 上报)
 * @param objectType 当前对象域(如 user/product)
 * @param custom     扩展键值(SDK setContext 透传)
 */
public record ResolveScopeRequest(
        String pageId,
        String objectId,
        String objectType,
        Map<String, String> custom) {

    public ResolveScopeRequest {
        custom = custom == null ? Map.of() : Map.copyOf(custom);
    }

    /** 序列化为 MCP 工具入参 JSON(字段名与协议约定一致)。 */
    public java.util.Map<String, Object> toToolArgs() {
        java.util.Map<String, Object> args = new java.util.LinkedHashMap<>();
        if (pageId != null) {
            args.put("pageId", pageId);
        }
        if (objectId != null) {
            args.put("objectId", objectId);
        }
        if (objectType != null) {
            args.put("objectType", objectType);
        }
        args.put("custom", custom);
        return args;
    }
}
