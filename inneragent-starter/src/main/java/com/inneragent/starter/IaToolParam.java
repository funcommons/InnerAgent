package com.inneragent.starter;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具方法参数的 schema 元数据(P1-T2b 职责①)。
 *
 * <p>MCP Java SDK core 无 POJO→JSON Schema 生成器(FINDINGS §2.4,Spring AI 注解模块
 * 已被技术方案排除),starter 按「最小自写生成器」路线:参数类型映射基础 JSON Schema
 * 类型,本注解补充参数名/描述/必填声明。
 */
@Documented
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface IaToolParam {

	/** 参数名;缺省取反射参数名(依赖 -parameters 编译参数,本模块构建已开启) */
	String value() default "";

	/** 参数描述(模型可见) */
	String description() default "";

	/** 是否必填(进 schema 的 required 数组);缺省必填 —— 保守默认 */
	boolean required() default true;

}
