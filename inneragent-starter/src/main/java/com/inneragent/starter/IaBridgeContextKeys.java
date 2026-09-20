package com.inneragent.starter;

/**
 * 验签后的 act token 身份在 {@code McpTransportContext} 中的键
 * (P1-T2b 职责②/③:Filter 验签 → contextExtractor 提升为传输上下文 →
 * 工具处理器按本常量读取,对齐 FINDINGS §2.3 第三段挂点)。
 */
public final class IaBridgeContextKeys {

	/** 终端用户 ID(act claims 的 sub) */
	public static final String USER_ID = "ia.userId";

	/** 运行身份(act.sub,形如 inneragent-run:{runId}) */
	public static final String ACT_SUB = "ia.actSub";

	/** 运行 ID(claims.runId,缺省从 act.sub 前缀剥离推导) */
	public static final String RUN_ID = "ia.runId";

	public static final String APP_KEY = "ia.appKey";

	public static final String TENANT_ID = "ia.tenantId";

	public static final String TOOL_NAME = "ia.toolName";

	private IaBridgeContextKeys() {
	}

}
