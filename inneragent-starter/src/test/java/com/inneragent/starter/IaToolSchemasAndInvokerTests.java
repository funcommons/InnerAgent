package com.inneragent.starter;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.starter.act.IaActClaims;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 最小 schema 生成器 + 反射调用器单元用例(P1-T2b 职责①核心机制)。 */
class IaToolSchemasAndInvokerTests {

	private final ObjectMapper mapper = new ObjectMapper();
	private final InvokerTarget target = new InvokerTarget();
	private final IaToolInvoker invoker = new IaToolInvoker(this.mapper);

	static class InvokerTarget {

		@IaTool(name = "mixed", description = "多型参数工具")
		public String mixed(@IaToolParam(description = "文本") String text, int count, long big,
				@IaToolParam(required = false) Double ratio, boolean flag, BigDecimal amount, List<String> labels,
				Map<String, Object> payload) {
			return text + ":" + count + ":" + big + ":" + ratio + ":" + flag + ":" + amount.toPlainString() + ":"
					+ labels.size() + ":" + payload.size();
		}

		@IaTool(name = "claims_taker", description = "上下文注入工具")
		public Map<String, Object> claimsTaker(IaActClaims claims) {
			return Map.of("userId", claims.userId(), "runId", claims.runId());
		}

		@IaTool(name = "void_tool", description = "空返回工具")
		public void voidTool() {
			// no-op
		}

	}

	private static Method method(String name) {
		for (Method candidate : InvokerTarget.class.getDeclaredMethods()) {
			if (candidate.getName().equals(name)) {
				return candidate;
			}
			IaTool annotation = candidate.getAnnotation(IaTool.class);
			if (annotation != null && annotation.name().equals(name)) {
				return candidate;
			}
		}
		throw new IllegalArgumentException(name);
	}

	private static IaToolDefinition definition(String name) {
		Method method = method(name);
		String toolName = method.getAnnotation(IaTool.class) != null ? name : method.getName();
		return new IaToolDefinition(toolName, toolName, ToolRiskLevel.READ, new InvokerTarget(), method,
				IaToolSchemas.inputSchema(method));
	}

	private static McpTransportContext contextWith(String userId, String runId) {
		return McpTransportContext.create(new IaActClaims(userId, "inneragent-run:" + runId, runId, "app", "7", "tool")
			.toContextMap());
	}

	@Test
	void schemaMapsParameterTypesAndRequired() {
		Map<String, Object> schema = IaToolSchemas.inputSchema(method("mixed"));

		assertThat(schema.get("type")).isEqualTo("object");
		Map<?, ?> properties = (Map<?, ?>) schema.get("properties");
		assertThat(properties.get("text")).isEqualTo(Map.of("type", "string", "description", "文本"));
		assertThat(properties.get("count")).isEqualTo(Map.of("type", "integer"));
		assertThat(properties.get("big")).isEqualTo(Map.of("type", "integer"));
		assertThat(properties.get("ratio")).isEqualTo(Map.of("type", "number"));
		assertThat(properties.get("flag")).isEqualTo(Map.of("type", "boolean"));
		assertThat(properties.get("amount")).isEqualTo(Map.of("type", "number"));
		assertThat(properties.get("labels")).isEqualTo(Map.of("type", "array", "items", Map.of("type", "string")));
		assertThat(properties.get("payload")).isEqualTo(Map.of("type", "object"));
		// ratio 未标 required=false 之外的都必填
		@SuppressWarnings("unchecked")
		List<String> required = (List<String>) schema.get("required");
		assertThat(required).containsExactly("text", "count", "big", "flag", "amount", "labels", "payload");
	}

	@Test
	void invokerBindsAndConvertsArguments() {
		McpSchema.CallToolRequest request = McpSchema.CallToolRequest.builder("mixed")
			.arguments(Map.of("text", "t", "count", 3, "big", 7, "flag", true, "amount", "1.5", "labels",
					List.of("a", "b"), "payload", Map.of("k", "v")))
			.build();

		McpSchema.CallToolResult result = this.invoker.invoke(definition("mixed"), contextWith("u", "r"), request);

		assertThat(result.isError()).isNotEqualTo(Boolean.TRUE);
		assertThat(((Map<?, ?>) result.structuredContent()).get("result"))
			.isEqualTo("t:3:7:null:true:1.5:2:1");
	}

	@Test
	void invokerInjectsVerifiedClaimsFromContext() {
		McpSchema.CallToolResult result = this.invoker.invoke(definition("claims_taker"), contextWith("u-1", "run-9"),
				McpSchema.CallToolRequest.builder("claims_taker").arguments(Map.of()).build());

		Map<?, ?> structured = (Map<?, ?>) result.structuredContent();
		assertThat(structured.get("userId")).isEqualTo("u-1");
		assertThat(structured.get("runId")).isEqualTo("run-9");
	}

	@Test
	void invokerMapsMissingRequiredArgAndThrowingMethodToErrorResult() {
		McpSchema.CallToolResult missingArg = this.invoker.invoke(definition("mixed"), contextWith("u", "r"),
				McpSchema.CallToolRequest.builder("mixed").arguments(Map.of()).build());
		assertThat(missingArg.isError()).isTrue();
		assertThat(((Map<?, ?>) missingArg.structuredContent()).get("status")).isEqualTo("error");

		McpSchema.CallToolResult badType = this.invoker.invoke(definition("mixed"), contextWith("u", "r"),
				McpSchema.CallToolRequest.builder("mixed").arguments(Map.of("text", "t", "count", "not-a-number"))
					.build());
		assertThat(badType.isError()).isTrue();
	}

	@Test
	void invokerWrapsVoidReturnAsOkStatus() {
		McpSchema.CallToolResult result = this.invoker.invoke(definition("void_tool"), contextWith("u", "r"),
				McpSchema.CallToolRequest.builder("void_tool").arguments(Map.of()).build());

		assertThat(result.isError()).isNotEqualTo(Boolean.TRUE);
		assertThat(((Map<?, ?>) result.structuredContent()).get("status")).isEqualTo("ok");
	}

	@Test
	void riskLevelMapsToAnnotations() {
		McpSchema.Tool tool = new IaToolDefinition("n", "d", ToolRiskLevel.DESTRUCTIVE, new InvokerTarget(),
				method("voidTool"), Map.of("type", "object")).toMcpTool();

		assertThat(tool.annotations().readOnlyHint()).isFalse();
		assertThat(tool.annotations().destructiveHint()).isTrue();
		assertThat(tool.meta()).containsEntry("ia.riskLevel", "DESTRUCTIVE");
	}

}
