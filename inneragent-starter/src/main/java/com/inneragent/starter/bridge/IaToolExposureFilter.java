package com.inneragent.starter.bridge;

import java.util.ArrayList;
import java.util.List;

import com.inneragent.starter.IaToolDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;

/**
 * 工具暴露开关(§9.2.1「application.yaml 配置 sign-key、工具暴露开关」):
 * 按 {@code inneragent.bridge.tools.include/exclude} 过滤扫描出的候选工具,
 * 落在注册前({@link IaToolRegistrar} 是注册进桥前的唯一闸口,启动期只执行一次,
 * WARN 不随重复扫描刷屏)。
 * <ul>
 *   <li>include 缺省空 = 全部暴露;非空 = 仅名单内工具暴露;</li>
 *   <li>exclude 命中即剔除,<b>优先于</b> include(先白后黑,黑名单一票否决);</li>
 *   <li>元素支持精确工具名与前缀通配 {@code prefix.*}(如 {@code generate_*};
 *       裸 {@code *} 视为匹配全部),大小写敏感;</li>
 *   <li>被开关挡掉的候选工具名以 WARN 列出(灰度排障需要)。</li>
 * </ul>
 */
public class IaToolExposureFilter {

	private static final Logger log = LoggerFactory.getLogger(IaToolExposureFilter.class);

	private final List<String> include;

	private final List<String> exclude;

	public IaToolExposureFilter(List<String> include, List<String> exclude) {
		this.include = normalize(include);
		this.exclude = normalize(exclude);
	}

	/**
	 * 过滤候选工具。include/exclude 均缺省时原样返回(零开销快路径,缺省行为不回归)。
	 */
	public List<IaToolDefinition> apply(List<IaToolDefinition> definitions) {
		if (this.include.isEmpty() && this.exclude.isEmpty()) {
			return definitions;
		}
		List<IaToolDefinition> exposed = new ArrayList<>(definitions.size());
		List<String> blocked = new ArrayList<>();
		for (IaToolDefinition definition : definitions) {
			String name = definition.name();
			if (matchesAny(this.exclude, name)) {
				blocked.add(name);
				continue;
			}
			if (!this.include.isEmpty() && !matchesAny(this.include, name)) {
				blocked.add(name);
				continue;
			}
			exposed.add(definition);
		}
		if (!blocked.isEmpty()) {
			log.warn("工具暴露开关挡掉 {} 个候选工具(不暴露): [{}](include={}, exclude={})", blocked.size(),
					String.join(", ", blocked), this.include, this.exclude);
		}
		return exposed;
	}

	private static boolean matchesAny(List<String> patterns, String toolName) {
		for (String pattern : patterns) {
			if (pattern.equals("*") || (pattern.endsWith("*") && toolName
				.startsWith(pattern.substring(0, pattern.length() - 1))) || pattern.equals(toolName)) {
				return true;
			}
		}
		return false;
	}

	private static List<String> normalize(List<String> entries) {
		if (entries == null) {
			return List.of();
		}
		return entries.stream()
			.filter(StringUtils::hasText)
			.map(String::trim)
			.toList();
	}

}
