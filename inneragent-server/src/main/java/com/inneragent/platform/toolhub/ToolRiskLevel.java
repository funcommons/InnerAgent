package com.inneragent.platform.toolhub;

import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * 工具风险等级(PRD §6.2.1:注册时由注解生成默认值,人工确认/覆盖;
 * 删除类/资金类/凭据类工具后台强制标为高危)。落库为小写码值,
 * 与 ia_tool_registry.risk_level 列注释(low/medium/high)对齐。
 */
public enum ToolRiskLevel {

    LOW,
    MEDIUM,
    HIGH;

    /** 落库码值(小写,对齐 V2 DDL 列注释)。 */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** 解析库值/入参(大小写不敏感;空白视为未声明返回 null)。 */
    public static ToolRiskLevel parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return ToolRiskLevel.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException(
                    "Unsupported tool risk level: " + value
                            + " (expected low/medium/high)");
        }
    }

    /**
     * 由 MCP 注解生成默认风险等级(V15:注解为可信宿主下的策略软输入):
     * destructiveHint=true → high;readOnlyHint=true → low;其余 medium。
     */
    public static ToolRiskLevel defaultFromAnnotations(ToolAnnotations annotations) {
        if (annotations != null && Boolean.TRUE.equals(annotations.destructiveHint())) {
            return HIGH;
        }
        if (annotations != null && Boolean.TRUE.equals(annotations.readOnlyHint())) {
            return LOW;
        }
        return MEDIUM;
    }

    /**
     * 删除类/资金类/凭据类关键词强制高危(PRD §6.2.2:此类工具后台强制标为高危,
     * 管理员不得下调)。命中返回 true。
     */
    public static boolean forcedHigh(String toolName, String description) {
        String text = ((toolName == null ? "" : toolName) + " "
                + (description == null ? "" : description)).toLowerCase(Locale.ROOT);
        return FORCED_HIGH_KEYWORDS.stream().anyMatch(text::contains);
    }

    private static final java.util.List<String> FORCED_HIGH_KEYWORDS = List.of(
            // 删除类
            "delete", "remove", "drop", "destroy", "purge", "删除",
            // 资金类
            "payment", "refund", "billing", "charge", "withdraw", "transfer_money",
            "付款", "退款", "资金",
            // 凭据类
            "password", "passwd", "credential", "secret", "api_key", "apikey",
            "密码", "凭据");

    static {
        Objects.requireNonNull(FORCED_HIGH_KEYWORDS);
    }
}
