package com.inneragent.server.auth.act;

import com.inneragent.agent.context.ToolExecutionContext;
import com.inneragent.agent.kernel.ActTokenSupplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * act token 供给缺省实现(P1-T1 挂点占位)。
 *
 * <p>始终返回 null(不携带 X-IA-Act)并 DEBUG 说明;P1-T2 由 MCP 工具适配器
 * 接入真实供给方(签发经 {@link ActTokenIssuer},audience 绑定宿主 MCP URI)。
 */
@Component
@Slf4j
public class NoopActTokenSupplier implements ActTokenSupplier {

    @Override
    public String supply(String runId, ToolExecutionContext toolContext, String toolName) {
        log.debug("ActTokenSupplier 缺省实现:本地工具不携带 X-IA-Act(挂点待 P1-T2 接管), "
                + "tool={}, runId={}", toolName, runId);
        return null;
    }
}
