package com.inneragent.platform.toolhub;

import java.util.Locale;

/**
 * 审计裁决来源(V22;ia_audit_log.decision_source,值域见 V2 DDL 列注释)。
 *
 * <p>使「高危 100% 确认」可从日志证明:每条放行/拒绝可指出是哪条路径
 * (模式默认/用户授权/强制策略/实弹确认/全开放)作出的决策。
 */
public enum ToolDecisionSource {

    /** 模式默认路径(DEFAULT:只读放行/写确认)。 */
    MODE_DEFAULT("mode-default"),

    /** 用户「总是允许」授权放行(ia_tool_grant)。 */
    USER_GRANT("user-grant"),

    /** 管理员强制策略(force-ask/force-allow/deny)。 */
    FORCED_POLICY("forced-policy"),

    /** 确认流实弹批准(live confirm)。 */
    LIVE_CONFIRM("live-confirm"),

    /**
     * 确认流超时系统裁决(P2-srv U1:审批超时未执行,过期=denied)。
     * decision_source 取独立值 {@code expired},与用户/模式路径区分——
     * 高危「100% 确认」审计可证明未发生用户实弹批准。
     */
    EXPIRED("expired"),

    /** FULL_ACCESS 全开放(平台管理员开启,审计一次性确认)。 */
    FULL_ACCESS("full-access"),

    /**
     * 管理面直接写操作(P2-W5:Agent 定义提示词编辑/导入导出落审计;
     * decision 取 definition-updated/definition-imported)。与
     * forced-policy(运行期强制策略裁决)区分:admin 指「管理面对定义
     * 本体的变更」这一动作来源,而非对某次工具调用的放行裁决。
     */
    ADMIN("admin"),

    /**
     * 内容安全接入点干预(P2-safety W6;S7/PRD §6.9):过滤链对用户输入
     * (ingress)或助手内容投递(egress)作出 block/redact 干预,
     * decision=blocked/redacted。工具治理语义复用 ia_audit_log 单表
     * (V12 列宽兼容:decision 8 字符、decision_source 6 字符)。
     */
    SAFETY("safety");

    private final String code;

    ToolDecisionSource(String code) {
        this.code = code;
    }

    /** 落库码值(对齐 V2 DDL decision_source 列注释)。 */
    public String code() {
        return code;
    }

    public static ToolDecisionSource fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String normalized = code.trim().toLowerCase(Locale.ROOT);
        for (ToolDecisionSource source : values()) {
            if (source.code.equals(normalized)) {
                return source;
            }
        }
        throw new IllegalArgumentException("Unsupported decision source: " + code);
    }
}
