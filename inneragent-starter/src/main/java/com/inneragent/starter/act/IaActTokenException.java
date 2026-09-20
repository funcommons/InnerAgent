package com.inneragent.starter.act;

/**
 * act token 验签失败(P1-T2b 职责②)。Filter 捕获后一律 401 fail-closed,
 * 不向调用方区分失败细节(仅服务端日志留因)。
 */
public class IaActTokenException extends RuntimeException {

	public IaActTokenException(String reason) {
		super(reason);
	}

}
