package com.inneragent.starter.act;

import java.util.LinkedHashMap;
import java.util.Map;

import com.inneragent.starter.IaBridgeContextKeys;
import io.modelcontextprotocol.common.McpTransportContext;

/**
 * 验签后的 act token 身份(P1-T2b 职责②),claims 按 RFC 8693 建模,
 * 字段名与主服务 {@code ActTokenIssuer} 对齐(02-技术方案 §6.1):
 * {@code sub}=终端用户、{@code act.sub}=运行身份、自定义 appKey/tenantId/toolName/runId。
 *
 * <p>本类不 import 主工程类 —— 仅按同一字段契约重建,契约核对点见
 * 「P1 收口对齐」报告项。
 */
public record IaActClaims(String userId, String actSub, String runId, String appKey, String tenantId,
		String toolName) {

	/** 与主服务 ActTokenIssuer.ACT_SUB_PREFIX 同值(运行身份前缀) */
	public static final String ACT_SUB_PREFIX = "inneragent-run:";

	public static IaActClaims from(Map<String, Object> claims) {
		String sub = str(claims.get("sub"));
		Object actRaw = claims.get("act");
		Map<?, ?> act = actRaw instanceof Map<?, ?> m ? m : Map.of();
		String actSub = str(act.get("sub"));
		Object runIdRaw = claims.get("runId");
		String runId = runIdRaw != null ? str(runIdRaw)
				: actSub.startsWith(ACT_SUB_PREFIX) ? actSub.substring(ACT_SUB_PREFIX.length()) : "";
		return new IaActClaims(sub, actSub, runId, str(claims.get("appKey")), str(claims.get("tenantId")),
				str(claims.get("toolName")));
	}

	public static IaActClaims fromContext(McpTransportContext context) {
		return new IaActClaims(text(context, IaBridgeContextKeys.USER_ID), text(context, IaBridgeContextKeys.ACT_SUB),
				text(context, IaBridgeContextKeys.RUN_ID), text(context, IaBridgeContextKeys.APP_KEY),
				text(context, IaBridgeContextKeys.TENANT_ID), text(context, IaBridgeContextKeys.TOOL_NAME));
	}

	/** 供 contextExtractor 放入 McpTransportContext(缺省空串,保证键存在) */
	public Map<String, Object> toContextMap() {
		Map<String, Object> context = new LinkedHashMap<>();
		context.put(IaBridgeContextKeys.USER_ID, nullToEmpty(this.userId));
		context.put(IaBridgeContextKeys.ACT_SUB, nullToEmpty(this.actSub));
		context.put(IaBridgeContextKeys.RUN_ID, nullToEmpty(this.runId));
		context.put(IaBridgeContextKeys.APP_KEY, nullToEmpty(this.appKey));
		context.put(IaBridgeContextKeys.TENANT_ID, nullToEmpty(this.tenantId));
		context.put(IaBridgeContextKeys.TOOL_NAME, nullToEmpty(this.toolName));
		return context;
	}

	private static String str(Object value) {
		return value == null ? "" : String.valueOf(value);
	}

	private static String nullToEmpty(String value) {
		return value == null ? "" : value;
	}

	private static String text(McpTransportContext context, String key) {
		Object value = context == null ? null : context.get(key);
		return value == null ? "" : String.valueOf(value);
	}

}
