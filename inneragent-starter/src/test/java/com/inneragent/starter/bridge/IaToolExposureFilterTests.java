package com.inneragent.starter.bridge;

import java.lang.reflect.Method;
import java.util.List;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolDefinition;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 工具暴露开关匹配规则(§9.2.1):include 白名单 / exclude 黑名单(exclude 优先)、
 * 精确名与 prefix.* 前缀通配、大小写敏感、被挡候选 WARN 可见。
 */
class IaToolExposureFilterTests {

	private final ListAppender<ILoggingEvent> events = attachCapture();

	@Test
	void emptyIncludeAndExcludeExposesEverythingWithoutWarning() {
		var filter = new IaToolExposureFilter(List.of(), List.of());
		List<IaToolDefinition> all = definitions();
		assertThat(filter.apply(all)).isSameAs(all);
		assertThat(this.events.list).isEmpty();
	}

	@Test
	void includeWhitelistExposesOnlyListedTools() {
		var filter = new IaToolExposureFilter(List.of("host_lookup"), List.of());
		assertThat(names(filter.apply(definitions()))).containsExactly("host_lookup");
		assertThat(blockedNames()).containsExactly("generate_image", "generate_video");
	}

	@Test
	void excludeRemovesMatchingTools() {
		var filter = new IaToolExposureFilter(List.of(), List.of("generate_video"));
		assertThat(names(filter.apply(definitions()))).containsExactly("generate_image", "host_lookup");
		assertThat(blockedNames()).containsExactly("generate_video");
	}

	@Test
	void excludeWinsOverInclude() {
		var filter = new IaToolExposureFilter(List.of("host_lookup", "generate_image", "generate_video"),
				List.of("generate_image"));
		assertThat(names(filter.apply(definitions()))).containsExactly("generate_video", "host_lookup");
		assertThat(blockedNames()).containsExactly("generate_image");
	}

	@Test
	void prefixWildcardMatchesByPrefix() {
		var filter = new IaToolExposureFilter(List.of("generate_*"), List.of());
		assertThat(names(filter.apply(definitions()))).containsExactly("generate_image", "generate_video");
		assertThat(blockedNames()).containsExactly("host_lookup");
	}

	@Test
	void wildcardAppliesToExcludeToo() {
		var filter = new IaToolExposureFilter(List.of(), List.of("generate_*"));
		assertThat(names(filter.apply(definitions()))).containsExactly("host_lookup");
	}

	@Test
	void bareWildcardMatchesEverything() {
		var filter = new IaToolExposureFilter(List.of("*"), List.of());
		assertThat(names(filter.apply(definitions()))).containsExactly("generate_image", "generate_video",
				"host_lookup");
	}

	@Test
	void matchingIsCaseSensitive() {
		var filter = new IaToolExposureFilter(List.of("Host_Lookup", "GENERATE_*"), List.of());
		assertThat(filter.apply(definitions())).isEmpty();
		assertThat(blockedNames()).containsExactly("generate_image", "generate_video", "host_lookup");
	}

	@Test
	void blankEntriesAreIgnored() {
		var filter = new IaToolExposureFilter(List.of(" ", ""), List.of());
		assertThat(names(filter.apply(definitions()))).containsExactly("generate_image", "generate_video",
				"host_lookup");
		assertThat(this.events.list).isEmpty();
	}

	@Test
	void warnLogListsBlockedToolNamesAndRules() {
		var filter = new IaToolExposureFilter(List.of("host_lookup"), List.of("generate_video"));
		filter.apply(definitions());
		assertThat(this.events.list).anyMatch(event -> event.getLevel() == Level.WARN
				&& event.getFormattedMessage().contains("generate_video")
				&& event.getFormattedMessage().contains("host_lookup"));
	}

	private List<String> blockedNames() {
		return this.events.list.stream()
			.filter(event -> event.getLevel() == Level.WARN && event.getFormattedMessage().contains("暴露开关"))
			.findFirst()
			.map(event -> {
				String message = event.getFormattedMessage();
				return message.substring(message.indexOf('[') + 1, message.indexOf(']'));
			})
			.stream()
			.flatMap(part -> java.util.Arrays.stream(part.split(", ")))
			.toList();
	}

	private static List<String> names(List<IaToolDefinition> definitions) {
		return definitions.stream().map(IaToolDefinition::name).toList();
	}

	private static List<IaToolDefinition> definitions() {
		return List.of(definition("generate_image"), definition("generate_video"), definition("host_lookup"));
	}

	private static IaToolDefinition definition(String name) {
		for (Method method : SampleTools.class.getDeclaredMethods()) {
			IaTool annotation = method.getAnnotation(IaTool.class);
			if (annotation != null && annotation.name().equals(name)) {
				return IaToolDefinition.of(method, new SampleTools());
			}
		}
		throw new IllegalArgumentException("样本工具缺失: " + name);
	}

	private ListAppender<ILoggingEvent> attachCapture() {
		ListAppender<ILoggingEvent> appender = new ListAppender<>();
		appender.start();
		((Logger) LoggerFactory.getLogger(IaToolExposureFilter.class)).addAppender(appender);
		return appender;
	}

	static class SampleTools {

		@IaTool(name = "generate_image", description = "生图")
		public String generateImage() {
			return "img";
		}

		@IaTool(name = "generate_video", description = "生视频")
		public String generateVideo() {
			return "video";
		}

		@IaTool(name = "host_lookup", description = "查询")
		public String lookup() {
			return "ok";
		}

	}

}
