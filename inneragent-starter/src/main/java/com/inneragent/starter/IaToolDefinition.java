package com.inneragent.starter;

import java.lang.reflect.Method;
import java.util.Map;

import io.modelcontextprotocol.spec.McpSchema;

/**
 * 一个已识别的宿主工具:注解 + 反射方法 + schema 的聚合(P1-T2b 职责①)。
 * {@link #toMcpTool()} 生成 MCP 工具模型(annotations 由风险等级落位;
 * _meta 携带 ia.riskLevel,供主服务指纹轮询/分诊时读取)。
 */
public record IaToolDefinition(String name, String description, ToolRiskLevel riskLevel, Object bean, Method method,
		Map<String, Object> inputSchema) {

	public static IaToolDefinition of(Method method, Object bean) {
		IaTool annotation = method.getAnnotation(IaTool.class);
		if (annotation == null) {
			throw new IllegalArgumentException("方法未标注 @IaTool: " + method);
		}
		String name = annotation.name().isBlank() ? method.getName() : annotation.name();
		String description = annotation.description().isBlank() ? name : annotation.description();
		return new IaToolDefinition(name, description, annotation.riskLevel(), bean, method,
				IaToolSchemas.inputSchema(method));
	}

	public McpSchema.Tool toMcpTool() {
		return McpSchema.Tool.builder(name, inputSchema)
			.description(description)
			.annotations(McpSchema.ToolAnnotations.builder()
				.title(name)
				.readOnlyHint(riskLevel.readOnlyHint())
				.destructiveHint(riskLevel.destructiveHint())
				.build())
			.meta(Map.of("ia.riskLevel", riskLevel.name()))
			.build();
	}

}
