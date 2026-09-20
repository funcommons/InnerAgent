package com.inneragent.starter.scanned;

import java.util.Map;

import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolParam;
import com.inneragent.starter.ToolRiskLevel;

/**
 * tool-packages 扫描来源的测试工具:非 Spring bean(无任何 stereotype),
 * 由 starter 以 createBean 实例化并注册 —— 验证「扫描包 → 非容器 bean 工具」路径。
 */
public class ScannedHostTool {

	@IaTool(name = "scanned_probe", description = "tool-packages 扫描所得工具", riskLevel = ToolRiskLevel.READ)
	public Map<String, Object> probe(@IaToolParam(description = "标签") String label) {
		return Map.of("status", "ok", "label", label);
	}

}
