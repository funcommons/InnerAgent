package com.inneragent.platform.toolhub;

import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.mcp.McpInvokerUnavailableException;
import com.inneragent.agent.mcp.McpToolInvoker;
import com.inneragent.agent.mcp.McpToolInvocationResult;
import lombok.extern.slf4j.Slf4j;

import java.util.Map;

/**
 * McpToolInvoker 缺省实现(P1-T2a [new];<strong>T2b 接管点</strong>)。
 *
 * <p>调用即抛 {@link McpInvokerUnavailableException}(fail-fast,不留隐式降级),
 * 明确提示等待 P1-T2b 的 MCP client 适配器(宿主桥 tools/call + X-IA-Act
 * 身份透传)接管。经 {@code ToolHubDefaultsConfiguration} 以
 * {@code @ConditionalOnMissingBean(McpToolInvoker.class)} 装配:
 * T2b 声明自己的 McpToolInvoker Bean 后本实现自动让位,内核侧
 * ObjectProvider 注入零改动切换。
 */
@Slf4j
public final class UnavailableMcpToolInvoker implements McpToolInvoker {

    static final String TAKEOVER_MESSAGE =
            "MCP 工具调用尚未接管:等待 P1-T2b MCP client 适配器实现 McpToolInvoker"
                    + "(宿主桥 tools/call + X-IA-Act 身份透传)";

    @Override
    public McpToolInvocationResult invoke(
            long appId,
            String toolName,
            Map<String, Object> args,
            ToolExecutionContext actContext) {
        log.debug("McpToolInvoker 缺省实现被调用(tool={}, appId={}): 拒绝并提示 T2b 接管",
                toolName, appId);
        throw new McpInvokerUnavailableException(TAKEOVER_MESSAGE);
    }

    @Override
    public String toString() {
        return "UnavailableMcpToolInvoker(T2b 接管前缺省)";
    }
}
