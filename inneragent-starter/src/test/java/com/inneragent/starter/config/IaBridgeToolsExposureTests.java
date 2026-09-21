package com.inneragent.starter.config;

import java.util.List;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.inneragent.starter.IaTool;
import com.inneragent.starter.bridge.IaMcpServerBridge;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 工具暴露开关(§9.2.1 inneragent.bridge.tools.*)装配与注册路径生效:
 * include 白名单、exclude 黑名单(exclude 优先)、prefix.* 通配、缺省全暴露不回归。
 */
class IaBridgeToolsExposureTests {

	private final WebApplicationContextRunner runner = new WebApplicationContextRunner(WebApplicationContextRunner
		.withMockServletContext(
				org.springframework.boot.web.servlet.context.AnnotationConfigServletWebApplicationContext::new))
		.withConfiguration(AutoConfigurations.of(IaBridgeAutoConfiguration.class))
		.withUserConfiguration(ExposureToolConfig.class)
		.withPropertyValues("inneragent.bridge.server-base=http://127.0.0.1:59999");

	@Test
	void defaultExposesAllToolsNoRegression() {
		runner.run(context -> {
			assertThat(context.getStartupFailure()).isNull();
			assertThat(registered(context.getBean(IaMcpServerBridge.class))).containsExactly("generate_image",
					"generate_video", "host_lookup");
		});
	}

	@Test
	void includeWhitelistOnlyExposesListedTools() {
		runner.withPropertyValues("inneragent.bridge.tools.include=generate_image,host_lookup").run(context -> {
			assertThat(context.getStartupFailure()).isNull();
			assertThat(registered(context.getBean(IaMcpServerBridge.class))).containsExactly("generate_image",
					"host_lookup");
		});
	}

	@Test
	void excludeRemovesMatchingTools() {
		runner.withPropertyValues("inneragent.bridge.tools.exclude=generate_video")
			.run(context -> assertThat(registered(context.getBean(IaMcpServerBridge.class)))
				.containsExactly("generate_image", "host_lookup"));
	}

	@Test
	void excludeWinsOverInclude() {
		runner.withPropertyValues("inneragent.bridge.tools.include=host_lookup,generate_*",
				"inneragent.bridge.tools.exclude=generate_video")
			.run(context -> assertThat(registered(context.getBean(IaMcpServerBridge.class)))
				.containsExactly("generate_image", "host_lookup"));
	}

	@Test
	void wildcardPrefixMatchesInInclude() {
		runner.withPropertyValues("inneragent.bridge.tools.include=generate_*")
			.run(context -> assertThat(registered(context.getBean(IaMcpServerBridge.class)))
				.containsExactly("generate_image", "generate_video"));
	}

	@Test
	void blockedCandidatesAreLoggedAtWarn() {
		ListAppender<ILoggingEvent> events = attachCapture();
		try {
			runner.withPropertyValues("inneragent.bridge.tools.include=host_lookup").run(context -> {
				assertThat(context.getStartupFailure()).isNull();
				assertThat(events.list).anyMatch(event -> event.getLevel() == Level.WARN
						&& event.getFormattedMessage().contains("generate_image")
						&& event.getFormattedMessage().contains("generate_video"));
			});
		}
		finally {
			detachCapture(events);
		}
	}

	private static List<String> registered(IaMcpServerBridge bridge) {
		return bridge.registeredTools().stream().sorted().toList();
	}

	private static ListAppender<ILoggingEvent> attachCapture() {
		ListAppender<ILoggingEvent> appender = new ListAppender<>();
		appender.start();
		((Logger) LoggerFactory.getLogger(com.inneragent.starter.bridge.IaToolExposureFilter.class)).addAppender(appender);
		return appender;
	}

	private static void detachCapture(ListAppender<ILoggingEvent> appender) {
		((Logger) LoggerFactory.getLogger(com.inneragent.starter.bridge.IaToolExposureFilter.class)).detachAppender(appender);
	}

	@Configuration(proxyBeanMethods = false)
	static class ExposureToolConfig {

		@Bean
		Object imageTool() {
			return new ImageTool();
		}

		@Bean
		Object videoTool() {
			return new VideoTool();
		}

		@Bean
		Object lookupTool() {
			return new LookupTool();
		}

		static class ImageTool {

			@IaTool(name = "generate_image", description = "生图")
			public String generate() {
				return "img";
			}

		}

		static class VideoTool {

			@IaTool(name = "generate_video", description = "生视频")
			public String generate() {
				return "video";
			}

		}

		static class LookupTool {

			@IaTool(name = "host_lookup", description = "查询")
			public String lookup() {
				return "ok";
			}

		}

	}

}
