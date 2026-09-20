package com.inneragent.agent.permission;

import java.util.Set;

/**
 * 授权 → 确认档位映射端口(P1-T2a [new];02-技术方案 §4.3 授权管线)。
 *
 * <p>运行链路构建 {@code ToolPermissionContext} 时经 ObjectProvider 查询:
 * 用户的「总是允许」永久授权(ia_tool_grant)将使 DEFAULT 模式下对应工具的
 * 写操作免确认(decision_source=user-grant)。实现位于工具中枢
 * (IaToolGrantPolicyView);内核不感知存储。
 */
@FunctionalInterface
public interface ToolGrantPolicyView {

    /**
     * @param appId 所属应用
     * @param userId 发起用户
     * @return 用户持有效永久授权的工具 FQN 集合(失效/撤销的不含)
     */
    Set<String> permanentGrantedToolFqns(long appId, long userId);
}
