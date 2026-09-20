package com.inneragent.starter;

import java.util.LinkedHashMap;
import java.util.Map;

import com.inneragent.starter.act.IaActClaims;

/**
 * 测试宿主工具 bean(模拟业务 ToolExecutor):一读一写一炸,外加枚举参数。
 */
public class TestTools {

	@IaTool(name = "host_lookup", description = "只读宿主查询工具", riskLevel = ToolRiskLevel.READ)
	public Map<String, Object> lookup(@IaToolParam(description = "检索词") String query,
			@IaToolParam(value = "nonce", description = "调用方关联令牌", required = false) String nonce,
			@IaToolParam(value = "delayMs", description = "模拟延迟毫秒", required = false) Integer delayMs,
			IaActClaims claims) {
		if (delayMs != null && delayMs > 0) {
			try {
				Thread.sleep(delayMs);
			}
			catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
			}
		}
		Map<String, Object> result = new LinkedHashMap<>();
		result.put("status", "ok");
		result.put("query", query);
		result.put("nonce", nonce == null ? "" : nonce);
		result.put("userId", claims.userId());
		result.put("appKey", claims.appKey());
		result.put("tenantId", claims.tenantId());
		result.put("toolName", claims.toolName());
		result.put("runId", claims.runId());
		return result;
	}

	@IaTool(name = "host_create_ticket", description = "写宿主工具(建工单)", riskLevel = ToolRiskLevel.WRITE)
	public Map<String, Object> createTicket(@IaToolParam(description = "工单标题") String title,
			@IaToolParam(description = "优先级") Priority priority, IaActClaims claims) {
		Map<String, Object> result = new LinkedHashMap<>();
		result.put("status", "ok");
		result.put("ticketId", "T-1");
		result.put("title", title);
		result.put("priority", String.valueOf(priority));
		result.put("createdBy", claims.userId());
		return result;
	}

	@IaTool(name = "host_boom", description = "抛错工具(错误映射用例)", riskLevel = ToolRiskLevel.DESTRUCTIVE)
	public void boom() {
		throw new IllegalStateException("boom: 业务异常");
	}

	public enum Priority {

		LOW, NORMAL, HIGH

	}

}
