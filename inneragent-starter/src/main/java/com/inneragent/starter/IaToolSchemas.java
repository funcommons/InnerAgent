package com.inneragent.starter;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 最小 JSON Schema 生成器(P1-T2b 职责①)。
 *
 * <p>背景(FINDINGS §2.4):官方 SDK core 不提供 POJO→JSON Schema 生成(那在 Spring AI
 * 的 MCP Annotations 模块,技术方案已排除);spike 验证 {@code Tool.builder(name, Map)}
 * 接受手工 Map。本类把方法参数映射为基础 JSON Schema:
 * <ul>
 *   <li>String/char/enum → string(enum 附 values);boolean → boolean</li>
 *   <li>byte/short/int/long(含包装)→ integer;float/double/BigDecimal → number</li>
 *   <li>Collection/数组 → array(集合元素类型可从泛型解析,解析不出则不写 items)</li>
 *   <li>Map 及其他类型(含 POJO)→ object(运行期以 JSON Map 原样传入,不做反序列化绑定)</li>
 * </ul>
 * 形状与 spike 同款 {@code {"type":"object","properties":{...},"required":[...]}}。
 */
public final class IaToolSchemas {

	private IaToolSchemas() {
	}

	/** 生成方法入参 schema(参数顺序即 properties 顺序,保证 schema 指纹稳定) */
	public static Map<String, Object> inputSchema(Method method) {
		Map<String, Object> properties = new LinkedHashMap<>();
		List<String> required = new java.util.ArrayList<>();
		for (Parameter parameter : method.getParameters()) {
			// 注入型参数(验签身份)不是调用方入参,不进 schema
			if (com.inneragent.starter.act.IaActClaims.class.isAssignableFrom(parameter.getType())) {
				continue;
			}
			IaToolParam meta = parameter.getAnnotation(IaToolParam.class);
			String name = parameterName(parameter, meta);
			properties.put(name, propertySchema(parameter, meta));
			if (meta == null || meta.required()) {
				required.add(name);
			}
		}
		Map<String, Object> schema = new LinkedHashMap<>();
		schema.put("type", "object");
		schema.put("properties", properties);
		if (!required.isEmpty()) {
			schema.put("required", required);
		}
		return schema;
	}

	public static String parameterName(Parameter parameter, IaToolParam meta) {
		if (meta != null && !meta.value().isBlank()) {
			return meta.value();
		}
		if (parameter.isNamePresent()) {
			return parameter.getName();
		}
		throw new IllegalStateException("参数名不可得(缺 -parameters 编译参数)且未标注 @IaToolParam: "
				+ parameter.getDeclaringExecutable().toGenericString());
	}

	private static Map<String, Object> propertySchema(Parameter parameter, IaToolParam meta) {
		Map<String, Object> property = new LinkedHashMap<>(baseSchema(parameter.getType(), parameter.getParameterizedType()));
		if (meta != null && !meta.description().isBlank()) {
			property.put("description", meta.description());
		}
		return property;
	}

	static Map<String, Object> baseSchema(Class<?> type, Type genericType) {
		Map<String, Object> schema = new LinkedHashMap<>();
		if (type == String.class || type == char.class || type == Character.class) {
			schema.put("type", "string");
		}
		else if (type.isEnum()) {
			schema.put("type", "string");
			schema.put("enum", java.util.Arrays.stream(type.getEnumConstants())
				.map(v -> ((Enum<?>) v).name())
				.toList());
		}
		else if (type == boolean.class || type == Boolean.class) {
			schema.put("type", "boolean");
		}
		else if (type == byte.class || type == Byte.class || type == short.class || type == Short.class
				|| type == int.class || type == Integer.class || type == long.class || type == Long.class) {
			schema.put("type", "integer");
		}
		else if (type == float.class || type == Float.class || type == double.class || type == Double.class
				|| type == BigDecimal.class) {
			schema.put("type", "number");
		}
		else if (type.isArray()) {
			schema.put("type", "array");
			schema.put("items", baseSchema(type.getComponentType(), null));
		}
		else if (Collection.class.isAssignableFrom(type)) {
			schema.put("type", "array");
			Type item = itemType(genericType);
			if (item instanceof Class<?> itemClass) {
				schema.put("items", baseSchema(itemClass, null));
			}
		}
		else {
			// Map、POJO、record 等:按 object 透传(运行期以 JSON Map 形态进入方法)
			schema.put("type", "object");
		}
		return schema;
	}

	private static Type itemType(Type genericType) {
		if (genericType instanceof ParameterizedType parameterized && parameterized.getActualTypeArguments().length == 1) {
			Type argument = parameterized.getActualTypeArguments()[0];
			return argument instanceof Class<?> clazz ? clazz : null;
		}
		return null;
	}

}
