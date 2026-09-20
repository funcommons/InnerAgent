package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.BusinessException;

import java.util.TreeMap;
import java.util.Objects;

/**
 * 工具 schema 指纹(sha256 over canonical JSON;02-技术方案 §4.3/V14)。
 *
 * <p>canonical 化规则:JSON 解析后按 key 字典序递归排序再序列化,
 * 使「属性声明顺序差异」不产生新指纹(活刷新分诊的对比基准)。
 * 与内核 AgentKernelToolManifest.schemaSha256 的快照锁定用途解耦:
 * 前者面向注册表分诊,后者面向运行级 pinning(ADR-5,保持绝对)。
 */
public final class ToolSchemaFingerprint {

    private ToolSchemaFingerprint() {
    }

    /**
     * 计算 schema(或注解 JSON)指纹;空白输入返回空串指纹(合法:无 schema 工具)。
     */
    public static String of(ObjectMapper objectMapper, String schemaJson) {
        Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        String canonical = canonicalJson(objectMapper, schemaJson);
        return AgentKernelToolManifestHolder.sha256(canonical);
    }

    /**
     * 规范化 JSON:解析后按 key 字典序递归排序;非法 JSON 抛 400 语义异常。
     */
    public static String canonicalJson(ObjectMapper objectMapper, String schemaJson) {
        if (schemaJson == null || schemaJson.isBlank()) {
            return "";
        }
        try {
            JsonNode node = objectMapper.readTree(schemaJson);
            Object sorted = sortKeys(objectMapper.treeToValue(node, Object.class));
            return objectMapper.writeValueAsString(sorted);
        } catch (Exception invalid) {
            throw new BusinessException(400,
                    "parametersSchema 不是合法 JSON: " + invalid.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private static Object sortKeys(Object value) {
        if (value instanceof java.util.Map<?, ?> map) {
            TreeMap<Object, Object> sorted = new TreeMap<>();
            map.forEach((key, val) -> sorted.put(key, sortKeys(val)));
            return sorted;
        }
        if (value instanceof java.util.List<?> list) {
            java.util.List<Object> copy = new java.util.ArrayList<>(list.size());
            list.forEach(item -> copy.add(sortKeys(item)));
            return copy;
        }
        return value;
    }

    /**
     * 对 AgentKernelToolManifest.sha256 的桥接(避免工具中枢依赖内核包的记录类型,
     * 仅复用其 SHA-256 实现;[new] P1-T2a)。
     */
    private static final class AgentKernelToolManifestHolder {
        static String sha256(String value) {
            return com.inneragent.agent.kernel.AgentKernelToolManifest.schemaSha256(value);
        }
    }
}
