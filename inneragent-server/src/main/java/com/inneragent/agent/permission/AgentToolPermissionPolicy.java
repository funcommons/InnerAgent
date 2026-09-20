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

    /**
     * 规则来源标记(V22 decision_source 对齐;审计可指出规则由哪条路径产生):
     * mode-default=模式默认,user-grant=用户「总是允许」授权。
     */
    public static final String SOURCE_MODE_DEFAULT = "mode-default";
    public static final String SOURCE_USER_GRANT = "user-grant";

    private AgentToolPermissionPolicy() {
    }

    public static PermissionContextState contextFor(
            Toolkit toolkit, ToolExecutionMode executionMode) {
        return contextFor(toolkit, executionMode, null, false);
    }

    /**
     * 确认档位映射(P1-T2a [adapt];PRD §6.2.2 + §6.2.4 授权管线):
     * <ul>
     *   <li>ALWAYS_ALLOW / FULL_ACCESS:BYPASS(显式豁免模式,授权无关);</li>
     *   <li>DEFAULT:只读放行;写操作 —— 持有永久授权(grantedTools)放行
     *       (规则来源 user-grant,V22),否则 ASK(规则来源 mode-default);</li>
     *   <li>ALWAYS_ASK:所有调用 ASK 且<strong>授权不可绕过</strong>
     *       (V19:ALWAYS_ASK=DEFAULT 减去授权通道;沿用 2026-09-17 在地语义
     *       对只读也逐次询问,授权绕过禁令为本任务强化的部分);</li>
     *   <li>scopeDegraded(resolve_scope 降级,PRD §6.1.4):写操作一律 ASK,
     *       授权不绕过。</li>
     * </ul>
     *
     * @param grantedTools  用户永久授权工具 FQN 集(确认档位映射输入;null=无授权)
     * @param scopeDegraded resolve_scope 降级标记(true 时写操作一律确认)
     */
    public static PermissionContextState contextFor(
            Toolkit toolkit,
            ToolExecutionMode executionMode,
            java.util.Set<String> grantedTools,
            boolean scopeDegraded) {
        Objects.requireNonNull(toolkit, "toolkit must not be null");
        ToolExecutionMode safeMode = Objects.requireNonNull(
                executionMode, "executionMode must not be null");
        java.util.Set<String> safeGrants = grantedTools == null
                ? java.util.Set.of() : grantedTools;
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
            // [adapt] P1-T2a：DEFAULT 写操作叠加用户授权（ia_tool_grant）与
            // scope 降级强制确认（授权不绕过降级语义，PRD §6.1.4）。
            switch (safeMode) {
                case ALWAYS_ASK -> builder.addAskRule(toolName, rule(
                        toolName, null, PermissionBehavior.ASK, RULE_SOURCE));
                case ALWAYS_ALLOW, FULL_ACCESS -> builder.addAllowRule(toolName, rule(
                        toolName, null, PermissionBehavior.ALLOW, RULE_SOURCE));
                case DEFAULT -> {
                    if (tool.isReadOnly()) {
                        builder.addAllowRule(toolName, rule(
                                toolName, null, PermissionBehavior.ALLOW, SOURCE_MODE_DEFAULT));
                    } else if (!scopeDegraded && safeGrants.contains(toolName)) {
                        builder.addAllowRule(toolName, rule(
                                toolName, null, PermissionBehavior.ALLOW, SOURCE_USER_GRANT));
                    } else {
                        builder.addAskRule(toolName, rule(
                                toolName, null, PermissionBehavior.ASK, SOURCE_MODE_DEFAULT));
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
        // [adapt] P1-T2a:确认档位映射消费授权集与 scope 降级标记
        PermissionContextState context = contextFor(
                agent.getToolkit(),
                requested.mode(),
                requested.grantedTools(),
                requested.scopeDegraded());
        agent.getDelegate()
                .getAgentState(runtimeContext.getUserId(), runtimeContext.getSessionId())
                .setPermissionContext(context);
        // Rebuilds AgentScope's per-session PermissionEngine and persists the new context.
        agent.setPermissionMode(runtimeContext, context.getMode());
    }

    private static PermissionRule rule(
            String toolName, String content, PermissionBehavior behavior) {
        return rule(toolName, content, behavior, RULE_SOURCE);
    }

    /** [adapt] P1-T2a:规则携带来源标记(V22 decision_source 对齐)。 */
    private static PermissionRule rule(
            String toolName, String content, PermissionBehavior behavior, String source) {
        return new PermissionRule(toolName, content, behavior, source);
    }
}
