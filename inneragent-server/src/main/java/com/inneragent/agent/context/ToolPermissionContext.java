package com.inneragent.agent.context;

import com.inneragent.agent.permission.ToolExecutionMode;

import java.util.Objects;
import java.util.Set;

/**
 * Exact AgentScope tool policy selected for the current conversation.
 *
 * <p>[adapt] P1-T2a:追加确认档位映射的两个输入(02-技术方案 §4.3/PRD §6.2.2):
 * <ul>
 *   <li>{@code grantedTools}:用户「总是允许」的永久授权工具 FQN 集
 *       (ia_tool_grant;DEFAULT 模式下写操作免确认依据,
 *       decision_source=user-grant);</li>
 *   <li>{@code scopeDegraded}:resolve_scope 降级标记(PRD §6.1.4——宿主未实现
 *       反查时「写操作一律确认」,任何授权不绕过)。</li>
 * </ul>
 * 兼容旧调用方:单参构造保持原语义(无授权、未降级)。
 */
public record ToolPermissionContext(
        ToolExecutionMode mode,
        Set<String> grantedTools,
        boolean scopeDegraded) {

    public ToolPermissionContext {
        mode = Objects.requireNonNull(mode, "mode must not be null");
        grantedTools = grantedTools == null ? Set.of() : Set.copyOf(grantedTools);
    }

    /** 旧签名兼容构造:无授权、scope 未降级。 */
    public ToolPermissionContext(ToolExecutionMode mode) {
        this(mode, Set.of(), false);
    }

    /** 是否持有该工具的有效永久授权。 */
    public boolean granted(String toolName) {
        return grantedTools.contains(toolName);
    }
}
