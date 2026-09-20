package com.inneragent.agent.permission;

import com.inneragent.agent.context.ToolPermissionContext;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.permission.PermissionBehavior;
import io.agentscope.core.permission.PermissionContextState;
import io.agentscope.core.permission.PermissionMode;
import io.agentscope.core.permission.PermissionRule;
import io.agentscope.core.tool.AgentTool;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.harness.agent.HarnessAgent;

import java.util.Objects;

/** Builds and applies the platform's four user-facing AgentScope permission policies. */
public final class AgentToolPermissionPolicy {

    public static final String HIGH_RISK_RULE_CONTENT = "afv:risk:high";
    private static final String RULE_SOURCE = "platformPolicy";

    private AgentToolPermissionPolicy() {
    }

    public static PermissionContextState contextFor(
            Toolkit toolkit, ToolExecutionMode executionMode) {
        Objects.requireNonNull(toolkit, "toolkit must not be null");
        ToolExecutionMode safeMode = Objects.requireNonNull(
                executionMode, "executionMode must not be null");
        PermissionContextState.Builder builder = PermissionContextState.builder()
                .mode(safeMode == ToolExecutionMode.ALWAYS_ALLOW
                        || safeMode == ToolExecutionMode.FULL_ACCESS
                        ? PermissionMode.BYPASS
                        : PermissionMode.DEFAULT);

        for (String toolName : toolkit.getToolNames()) {
            AgentTool tool = Objects.requireNonNull(
                    toolkit.getTool(toolName), "Toolkit lost registered tool: " + toolName);
            // 产品决策（2026-09-17）：执行模式语义化——写操作是否免确认由模式决定。
            // ALWAYS_ASK 一律确认；ALWAYS_ALLOW/FULL_ACCESS 全部豁免（批量 Agent 自动化）；
            // DEFAULT 维持"只读放行、写操作人工确认"。此前所有模式强制写确认导致
            // 批量生图逐图请求权限（确认踏步机），与 FULL_ACCESS 语义矛盾。
            switch (safeMode) {
                case ALWAYS_ASK -> builder.addAskRule(toolName, rule(
                        toolName, null, PermissionBehavior.ASK));
                case ALWAYS_ALLOW, FULL_ACCESS -> builder.addAllowRule(toolName, rule(
                        toolName, null, PermissionBehavior.ALLOW));
                case DEFAULT -> {
                    if (tool.isReadOnly()) {
                        builder.addAllowRule(toolName, rule(
                                toolName, null, PermissionBehavior.ALLOW));
                    } else {
                        builder.addAskRule(toolName, rule(
                                toolName, null, PermissionBehavior.ASK));
                    }
                }
            }
        }
        return builder.build();
    }

    public static void applyRequestedPolicy(
            HarnessAgent agent, RuntimeContext runtimeContext) {
        Objects.requireNonNull(agent, "agent must not be null");
        Objects.requireNonNull(runtimeContext, "runtimeContext must not be null");
        ToolPermissionContext requested = Objects.requireNonNull(
                runtimeContext.get(ToolPermissionContext.class),
                "RuntimeContext is missing ToolPermissionContext");
        PermissionContextState context = contextFor(agent.getToolkit(), requested.mode());
        agent.getDelegate()
                .getAgentState(runtimeContext.getUserId(), runtimeContext.getSessionId())
                .setPermissionContext(context);
        // Rebuilds AgentScope's per-session PermissionEngine and persists the new context.
        agent.setPermissionMode(runtimeContext, context.getMode());
    }

    private static PermissionRule rule(
            String toolName, String content, PermissionBehavior behavior) {
        return new PermissionRule(toolName, content, behavior, RULE_SOURCE);
    }
}
