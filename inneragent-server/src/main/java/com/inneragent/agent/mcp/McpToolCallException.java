package com.inneragent.agent.mcp;

/**
 * MCP 宿主调用失败基类(P1-T2b [new])。
 *
 * <p>错误细分语义(P1-T2b 交付项;spike 风险 R5「错误码语义薄」的适配层补齐):
 * <ul>
 *   <li>{@link McpToolAuthException} —— 宿主 401/403(act token 被拒/过期);</li>
 *   <li>{@link McpToolTimeoutException} —— 调用超时(inneragent.mcp.call-timeout);</li>
 *   <li>{@link McpToolTransportException} —— 连接失败/会话失效/传输断连
 *       (重连编排耗尽后上抛);</li>
 *   <li>宿主工具自身报错不上抛:按端口契约返回
 *       {@link McpToolInvocationResult#error(String)}(error=true,回灌模型)。</li>
 * </ul>
 * 与 {@link McpInvokerUnavailableException}(端口未接管,T2a 缺省态)严格区分。
 */
public class McpToolCallException extends RuntimeException {

    public McpToolCallException(String message) {
        super(message);
    }

    public McpToolCallException(String message, Throwable cause) {
        super(message, cause);
    }
}
