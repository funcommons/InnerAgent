package com.inneragent.agent.mcp;

/**
 * 宿主调用超时(inneragent.mcp.call-timeout;P1-T2b 错误细分)。
 */
public class McpToolTimeoutException extends McpToolCallException {

    public McpToolTimeoutException(String message) {
        super(message);
    }

    public McpToolTimeoutException(String message, Throwable cause) {
        super(message, cause);
    }
}
