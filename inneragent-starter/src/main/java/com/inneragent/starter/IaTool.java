package com.inneragent.starter;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记宿主 bean 方法为 InnerAgent 可调用的 MCP 工具(P1-T2b 职责①)。
 *
 * <p>starter 启动时扫描容器 bean(及 {@code inneragent.bridge.tool-packages} 指定包)
 * 中带本注解的方法,生成 {@code McpSchema.Tool}(schema 见
 * {@link IaToolSchemas} 的最小生成规则)注册进 stateless 形态的 /ia-mcp;
 * 方法调用时从 {@code McpTransportContext} 取验签后的 act token 身份。
 *
 * <p>工具名在桥内唯一(重复注册 fail-fast 可配);模型可见 FQN 由 InnerAgent 主服务
 * 按 {@code mcp__<serverKey>__<name>} 组装(02-技术方案 §6.2.1),starter 不参与命名。
 */
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface IaTool {

	/** MCP 工具名(桥内唯一);缺省取方法名 */
	String name() default "";

	/** 工具描述(模型可见);缺省取工具名 */
	String description() default "";

	/** 风险等级声明(注册默认值,主服务可覆盖) */
	ToolRiskLevel riskLevel() default ToolRiskLevel.WRITE;

}
