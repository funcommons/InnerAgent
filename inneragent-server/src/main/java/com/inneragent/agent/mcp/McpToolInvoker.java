package com.inneragent.agent.mcp;

import com.inneragent.agent.context.ToolExecutionContext;

import java.util.Map;

/**
 * MCP 工具调用端口(P1-T2a [new];<strong>T2b 接管点</strong>)。
 *
 * <p>02-技术方案 §4.3 的 McpToolAdapter:封装 MCP {@code tools/call},
 * 携带身份头(X-IA-Act,act token 由 ActTokenIssuer 签发,audience 绑定
 * ia_tool_registry.endpoint_url),超时/重试按 §4.7,JSON {@code status:error}
 * 映射沿用。T2b 的 MCP client 适配器实现本端口后,内核工具注册链路与
 * resolve_scope 反查即经此执行宿主调用。
 *
 * <p>挂点方式与 T1 的 ActTokenSupplier 一致:内核侧经
 * {@code ObjectProvider<McpToolInvoker>} 可选注入;本任务提供缺省实现
 * {@code UnavailableMcpToolInvoker}(调用即抛
 * {@link McpInvokerUnavailableException}),T2b 声明自己的 Bean 后
 * (@ConditionalOnMissingBean 让位)自动接管。
 */
@FunctionalInterface
public interface McpToolInvoker {

    /**
     * 调用一次宿主 MCP 工具。
     *
     * @param appId       所属应用(ia_app.id;目录与端点定位)
     * @param toolName    工具名(注册表 tool_name;FQN 由实现方按 serverKey 还原)
     * @param args        工具入参(模型产出的 JSON 参数展开)
     * @param actContext  执行身份上下文(userId/tenantId 等,act token claims 来源)
     * @return 调用结果(payload JSON;宿主工具错误以 error=true 表达,不抛异常)
     */
    McpToolInvocationResult invoke(
            long appId,
            String toolName,
            Map<String, Object> args,
            ToolExecutionContext actContext);
}
