package com.inneragent.agent.kernel;

import com.inneragent.agent.context.ToolExecutionContext;

/**
 * act token（X-IA-Act）供给挂点（P1-T1 预留，技术方案 §6.1）。
 *
 * <p>每次工具调用执行前由 {@link AgentScopeToolAdapter} 询问本接口；P1-T2 的
 * MCP 工具适配器（McpToolAdapter）接管后签发 RS256 act token 并随
 * {@code tools/call} 携带给宿主，宿主验签后重建用户上下文。本任务仅留挂点：
 * 缺省实现（{@code NoopActTokenSupplier}）返回 null 并打 DEBUG 日志，
 * 本地内置工具不外发令牌。
 *
 * <p>实现方应自行捕获签发失败并降级返回 null，避免令牌故障阻断本地工具执行。
 */
@FunctionalInterface
public interface ActTokenSupplier {

    /**
     * 为一次工具调用供给 act token。
     *
     * @param runId       发起本次调用的运行 ID（act.sub 的 run 身份）
     * @param toolContext 运行链路显式携带的工具执行身份（userId/tenantId）
     * @param toolName    即将执行的工具名
     * @return act token（JWT 字符串）；null 表示不携带（本地工具/签发降级）
     */
    String supply(String runId, ToolExecutionContext toolContext, String toolName);
}
