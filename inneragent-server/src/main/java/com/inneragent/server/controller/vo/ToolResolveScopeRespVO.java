package com.inneragent.server.controller.vo;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * resolve_scope 反查 REST 出参(PRD §6.1.4 协议四数组)。
 *
 * <p>[adapt] 刻意不带 CommonResult 信封与 degraded/degradeReason 附加字段:
 * starter InnerAgentBridgeClient 以原生 Jackson 直接反序列化本结构
 * (FAIL_ON_UNKNOWN_PROPERTIES 默认开启),协议面保持最窄。降级时四数组恒为空,
 * 降级原因仅落服务端日志。
 */
@Schema(description = "resolve_scope 反查结果(宿主仍是最终权限裁决方,ADR-3)")
public record ToolResolveScopeRespVO(
        List<String> visibleDomains,
        List<String> writableFields,
        List<String> forbidden,
        List<String> hints) {

    public ToolResolveScopeRespVO {
        visibleDomains = visibleDomains == null ? List.of() : List.copyOf(visibleDomains);
        writableFields = writableFields == null ? List.of() : List.copyOf(writableFields);
        forbidden = forbidden == null ? List.of() : List.copyOf(forbidden);
        hints = hints == null ? List.of() : List.copyOf(hints);
    }
}
