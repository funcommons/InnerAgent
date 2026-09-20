package com.inneragent.starter;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.starter.act.IaActClaims;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 反射调用宿主工具方法(P1-T2b 职责①):JSON args → 方法实参的绑定与类型收敛、
 * {@link IaActClaims} 上下文注入、返回值 → 结构化内容、异常 → {@code status:error}
 * (错误映射沿用 FINDINGS §③:CallToolResult.isError + JSON status:error)。
 */
public class IaToolInvoker {

	private static final Logger log = LoggerFactory.getLogger(IaToolInvoker.class);

	private final ObjectMapper mapper;

	public IaToolInvoker(ObjectMapper mapper) {
		this.mapper = mapper;
	}

	public McpSchema.CallToolResult invoke(IaToolDefinition definition, McpTransportContext context,
			McpSchema.CallToolRequest request) {
		try {
			Object[] arguments = bindArguments(definition, context, request.arguments());
			Object outcome = definition.method().invoke(definition.bean(), arguments);
			return toResult(outcome);
		}
		catch (InvocationTargetException invocationFailure) {
			return errorResult(invocationFailure.getCause() == null ? invocationFailure : invocationFailure.getCause());
		}
		catch (Throwable bindingOrInvokeFailure) {
			return errorResult(bindingOrInvokeFailure);
		}
	}

	private Object[] bindArguments(IaToolDefinition definition, McpTransportContext context, Map<String, Object> raw)
			throws Exception {
		Method method = definition.method();
		Parameter[] parameters = method.getParameters();
		Object[] bound = new Object[parameters.length];
		for (int i = 0; i < parameters.length; i++) {
			Parameter parameter = parameters[i];
			IaToolParam meta = parameter.getAnnotation(IaToolParam.class);
			if (IaActClaims.class.isAssignableFrom(parameter.getType())) {
				bound[i] = IaActClaims.fromContext(context);
				continue;
			}
			String name = IaToolSchemas.parameterName(parameter, meta);
			Object value = raw == null ? null : raw.get(name);
			if (value == null) {
				if (meta == null || meta.required()) {
					throw new IllegalArgumentException("缺少必填参数: " + name);
				}
				bound[i] = parameter.getType().isPrimitive() ? defaultPrimitive(parameter.getType()) : null;
				continue;
			}
			bound[i] = convert(value, parameter, name);
		}
		return bound;
	}

	private Object convert(Object value, Parameter parameter, String name) {
		try {
			return this.mapper.convertValue(value, this.mapper.constructType(parameter.getParameterizedType()));
		}
		catch (IllegalArgumentException conversionFailure) {
			throw new IllegalArgumentException(
					"参数 " + name + " 类型不匹配(期望 " + parameter.getType().getSimpleName() + "): " + value);
		}
	}

	private static Object defaultPrimitive(Class<?> type) {
		if (type == boolean.class) {
			return false;
		}
		if (type == long.class) {
			return 0L;
		}
		if (type == double.class) {
			return 0D;
		}
		if (type == float.class) {
			return 0F;
		}
		if (type == short.class) {
			return (short) 0;
		}
		if (type == byte.class) {
			return (byte) 0;
		}
		if (type == char.class) {
			return '\0';
		}
		return 0;
	}

	@SuppressWarnings("unchecked")
	private McpSchema.CallToolResult toResult(Object outcome) throws Exception {
		Object structured;
		if (outcome instanceof Map<?, ?> map) {
			structured = map;
		}
		else if (outcome == null) {
			structured = Map.of("status", "ok");
		}
		else {
			Map<String, Object> wrapper = new LinkedHashMap<>();
			wrapper.put("status", "ok");
			wrapper.put("result", outcome instanceof Collection<?> || outcome.getClass().isArray() ? outcome
					: String.valueOf(outcome));
			structured = wrapper;
		}
		String text = this.mapper.writeValueAsString(structured);
		return McpSchema.CallToolResult.builder().addTextContent(text).structuredContent(structured).build();
	}

	private McpSchema.CallToolResult errorResult(Throwable failure) {
		String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
		log.warn("宿主工具调用失败: {}", message);
		Map<String, Object> structured = new LinkedHashMap<>();
		structured.put("status", "error");
		structured.put("message", message);
		try {
			return McpSchema.CallToolResult.builder()
				.addTextContent(this.mapper.writeValueAsString(structured))
				.structuredContent(structured)
				.isError(true)
				.build();
		}
		catch (Exception serializationFailure) {
			return McpSchema.CallToolResult.builder()
				.addTextContent("tool error: " + message)
				.isError(true)
				.build();
		}
	}

}
