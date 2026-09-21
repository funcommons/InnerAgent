package com.inneragent.platform.toolhub;

import java.util.Locale;

/**
 * 工具体检结论(V16;ia_tool_registry.health_status,PRD §6.8 M8 + W5 体检 v1)。
 *
 * <p>三态语义(检查项矩阵见 {@link ToolHealthService}):
 * <ul>
 *   <li><strong>ok</strong>:endpoint 握手可达,toolName 在宿主清单中,
 *       schema 指纹与注册一致,注解与宿主上报无 diff;</li>
 *   <li><strong>degraded</strong>:endpoint 可达,但清单缺失工具 / 指纹漂移 /
 *       注解 diff 至少一项成立(注册快照与宿主现状漂移,给出整改建议;
 *       v1 不引入第四态,「宿主已下线该工具」归入本档——自拟语义,已标注);</li>
 *   <li><strong>unreachable</strong>:endpoint_url 未配置,或 MCP
 *       initialize/listTools 握手失败(连接拒绝/超时/鉴权失败/传输错误)
 *       ——工具当前不可调用。</li>
 * </ul>
 */
public enum ToolHealthStatus {

    OK("ok"),
    DEGRADED("degraded"),
    UNREACHABLE("unreachable");

    private final String code;

    ToolHealthStatus(String code) {
        this.code = code;
    }

    /** 落库码值(ia_tool_registry.health_status)。 */
    public String code() {
        return code;
    }

    public static ToolHealthStatus fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String normalized = code.trim().toLowerCase(Locale.ROOT);
        for (ToolHealthStatus status : values()) {
            if (status.code.equals(normalized)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unsupported tool health status: " + code);
    }
}
