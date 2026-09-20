package com.inneragent.starter.config;

import java.util.List;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.inneragent.starter.IaTool;
import com.inneragent.starter.bridge.IaMcpServerBridge;
import com.inneragent.starter.bridge.IaToolRegistrar;
import com.inneragent.starter.client.InnerAgentBridgeClient;
import com.inneragent.starter.act.IaActJwksCache;
import com.inneragent.starter.act.IaActTokenVerifier;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 自动装配(P1-T2b 职责④):enabled 开关、装配件齐备、serverBase 缺失 WARN 不阻断、
 * 扫描 fail-fast 可配、Filter 仅拦桥端点。
 */
class IaBridgeAutoConfigurationTests {

	private final WebApplicationContextRunner runner = new WebApplicationContextRunner(WebApplicationContextRunner
		.withMockServletContext(
				org.springframework.boot.web.servlet.context.AnnotationConfigServletWebApplicationContext::new))
		.withConfiguration(AutoConfigurations.of(IaBridgeAutoConfiguration.class));

	@Test
	void disabledPropertyInstallsNothing() {
		runner.withPropertyValues("inneragent.bridge.enabled=false")
			.run(context -> assertThat(context).doesNotHaveBean(IaMcpServerBridge.class)
				.doesNotHaveBean(IaActTokenVerifier.class)
				.doesNotHaveBean(IaActJwksCache.class)
				.doesNotHaveBean(InnerAgentBridgeClient.class));
	}

	@Test
	void defaultInstallsFullBridgeStack() {
		runner.withPropertyValues("inneragent.bridge.server-base=http://127.0.0.1:59999")
			.run(context -> {
				assertThat(context).hasSingleBean(IaMcpServerBridge.class);
				assertThat(context).hasSingleBean(IaActTokenVerifier.class);
				assertThat(context).hasSingleBean(IaActJwksCache.class);
				assertThat(context).hasSingleBean(IaToolRegistrar.class);
				assertThat(context).hasSingleBean(InnerAgentBridgeClient.class);

				FilterRegistrationBean<?> filter = context.getBean(FilterRegistrationBean.class);
				assertThat(filter.getUrlPatterns()).containsExactly("/ia-mcp");
				ServletRegistrationBean<?> servlet = context.getBean(ServletRegistrationBean.class);
				assertThat(servlet.getUrlMappings()).containsExactly("/ia-mcp");
			});
	}

	@Test
	void missingServerBaseStartsWithWarningNotBlocking() {
		ListAppender<ILoggingEvent> events = attachCapture();
		try {
			runner.run(context -> {
				// 未配置 serverBase:上下文照常启动(不阻断)
				assertThat(context).hasBean("iaMcpServerBridge");
				assertThat(events.list)
					.anyMatch(event -> event.getLevel() == Level.WARN
							&& event.getFormattedMessage().contains("server-base"));
			});
		}
		finally {
			detachCapture(events);
		}
	}

	@Test
	void duplicateToolNamesFailFastByDefault() {
		runner.withPropertyValues("inneragent.bridge.server-base=http://127.0.0.1:59999")
			.withUserConfiguration(DuplicateToolConfig.class)
			.run(context -> assertThat(context.getStartupFailure()).isNotNull());
	}

	@Test
	void duplicateToolNamesSkippedWhenFailFastDisabled() {
		runner.withPropertyValues("inneragent.bridge.server-base=http://127.0.0.1:59999",
				"inneragent.bridge.scan.fail-fast=false")
			.withUserConfiguration(DuplicateToolConfig.class)
			.run(context -> {
				assertThat(context.getStartupFailure()).isNull();
				IaMcpServerBridge bridge = context.getBean(IaMcpServerBridge.class);
				assertThat(bridge.registeredTools()).containsExactly("clashing_tool");
			});
	}

	private static ListAppender<ILoggingEvent> attachCapture() {
		ListAppender<ILoggingEvent> appender = new ListAppender<>();
		appender.start();
		((Logger) LoggerFactory.getLogger(IaBridgeAutoConfiguration.class)).addAppender(appender);
		return appender;
	}

	private static void detachCapture(ListAppender<ILoggingEvent> appender) {
		((Logger) LoggerFactory.getLogger(IaBridgeAutoConfiguration.class)).detachAppender(appender);
	}

	@Configuration(proxyBeanMethods = false)
	static class DuplicateToolConfig {

		@Bean
		Object toolOne() {
			return new ToolOne();
		}

		@Bean
		Object toolTwo() {
			return new ToolTwo();
		}

		static class ToolOne {

			@IaTool(name = "clashing_tool", description = "first")
			public String first() {
				return "one";
			}

		}

		static class ToolTwo {

			@IaTool(name = "clashing_tool", description = "second")
			public String second() {
				return "two";
			}

		}

	}

}
