package com.inneragent.agent.mcp;

/**
 * 传输层失败:连接被拒/会话失效(spike R1「MCP session with server
 * terminated」)/流断连(P1-T2b 错误细分)。
 *
 * <p>本类型是重连编排的触发信号:首次出现时经单飞锁 + 指数退避对同实例
 * re-initialize 后重试;重试仍失败(或重连本身失败)以本类型上抛。
 */
public class McpToolTransportException extends McpToolCallException {

    public McpToolTransportException(String message) {
        super(message);
    }

    public McpToolTransportException(String message, Throwable cause) {
        super(message, cause);
    }
}
