package com.inneragent.agent.mcp;

/**
 * 宿主鉴权失败(401/403;P1-T2b 错误细分)。
 *
 * <p>act token 被宿主拒签(过期/audience 不符/验签失败)或端点要求授权而未携带。
 * 不属于重连可恢复类:重连后 initialize 仍携同一身份管线签发的新 token,
 * 若宿主持续拒绝则每次调用明确报鉴权失败。
 */
public class McpToolAuthException extends McpToolCallException {

    public McpToolAuthException(String message) {
        super(message);
    }

    public McpToolAuthException(String message, Throwable cause) {
        super(message, cause);
    }
}
