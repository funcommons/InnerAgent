package com.inneragent.agent.mcp;

/**
 * MCP 工具调用端口未接管异常(P1-T2a 缺省态)。
 *
 * <p>{@code UnavailableMcpToolInvoker} 在 T2b 宿主桥接入前对任何调用抛出;
 * 上层(resolve_scope 反查/降级判定)可按本类型精确识别「桥未就绪」,
 * 与宿主工具真实失败区分。
 */
public class McpInvokerUnavailableException extends RuntimeException {

    public McpInvokerUnavailableException(String message) {
        super(message);
    }
}
