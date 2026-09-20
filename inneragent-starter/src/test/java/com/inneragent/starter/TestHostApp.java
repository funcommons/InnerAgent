package com.inneragent.starter;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/**
 * 测试宿主应用:空白 Spring Boot web 应用 + 一个 @IaTool 工具 bean。
 * starter 的自动装配经 classpath 上的 AutoConfiguration.imports 生效(宿主零配置接入路径)。
 */
@SpringBootApplication
public class TestHostApp {

	@Bean
	public TestTools testTools() {
		return new TestTools();
	}

}
