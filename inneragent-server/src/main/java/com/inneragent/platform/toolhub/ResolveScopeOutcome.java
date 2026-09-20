package com.inneragent.platform.toolhub;

import java.util.List;
import java.util.Objects;

/**
 * resolve_scope 反查结果(02-技术方案 §4.3;PRD §6.1.4)。
 *
 * <p>协议:宿主 MCP 实现标准工具 {@code resolve_scope},入参
 * {@code {pageId, objectId, objectType, custom:{...}}},出参
 * {@code {visibleDomains[], writableFields[], forbidden[], hints[]}}。
 *
 * @param visibleDomains 当前上下文下可见对象域
 * @param writableFields 可写范围
 * @param forbidden      禁止操作清单
 * @param hints          宿主补充提示(原样透传)
 * @param degraded       true=宿主未实现 resolve_scope,走降级(PRD §6.1.4:
 *                       无上下文提示 + 全量白名单工具 + 写操作一律确认);
 *                       此时四个列表恒为空,写确认强制由确认档位映射消费
 * @param degradeReason  降级原因:tool_absent/invoker_unavailable
 */
public record ResolveScopeOutcome(
        List<String> visibleDomains,
        List<String> writableFields,
        List<String> forbidden,
        List<String> hints,
        boolean degraded,
        String degradeReason) {

    public ResolveScopeOutcome {
        visibleDomains = Objects.requireNonNullElse(visibleDomains, List.of());
        writableFields = Objects.requireNonNullElse(writableFields, List.of());
        forbidden = Objects.requireNonNullElse(forbidden, List.of());
        hints = Objects.requireNonNullElse(hints, List.of());
    }

    /** 命中反查的构造。 */
    public static ResolveScopeOutcome resolved(
            List<String> visibleDomains,
            List<String> writableFields,
            List<String> forbidden,
            List<String> hints) {
        return new ResolveScopeOutcome(
                visibleDomains, writableFields, forbidden, hints, false, null);
    }

    /** 降级构造(PRD §6.1.4 缺省行为)。 */
    public static ResolveScopeOutcome degraded(String reason) {
        return new ResolveScopeOutcome(List.of(), List.of(), List.of(), List.of(), true, reason);
    }
}
