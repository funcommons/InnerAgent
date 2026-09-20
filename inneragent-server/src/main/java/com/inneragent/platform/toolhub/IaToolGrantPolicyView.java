package com.inneragent.platform.toolhub;

import com.inneragent.agent.permission.ToolGrantPolicyView;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.Set;

/**
 * 授权档位映射端口实现(P1-T2a [new]):读 ia_tool_grant 有效永久授权。
 *
 * <p>注入即接通内核确认档位映射:DEFAULT 模式 + 用户永久授权 + 未降级
 * → 写操作放行(AgentToolPermissionPolicy,user-grant 路径)。
 */
@Component
public class IaToolGrantPolicyView implements ToolGrantPolicyView {

    private final ToolGrantService grantService;

    public IaToolGrantPolicyView(ToolGrantService grantService) {
        this.grantService = Objects.requireNonNull(grantService, "grantService must not be null");
    }

    @Override
    public Set<String> permanentGrantedToolFqns(long appId, long userId) {
        // appId 由行级拦截器按 AppContext 过滤(单应用部署恒为 1);此处仅供签名完整
        return grantService.activePermanentFqns(userId);
    }
}
