package com.inneragent.agent.mcp;

import java.util.Objects;

/**
 * MCP 工具调用结果。
 *
 * @param payloadJson 结果载荷 JSON(宿主返回的 content 展平;调用方回灌模型)
 * @param error       true=宿主工具侧错误(status:error/failed 映射,PRD 工具失败回灌模型)
 */
public record McpToolInvocationResult(String payloadJson, boolean error) {

    public McpToolInvocationResult {
        Objects.requireNonNull(payloadJson, "payloadJson must not be null");
    }

    public static McpToolInvocationResult ok(String payloadJson) {
        return new McpToolInvocationResult(payloadJson, false);
    }

    public static McpToolInvocationResult error(String payloadJson) {
        return new McpToolInvocationResult(payloadJson, true);
    }
}
