package com.inneragent.starter.bridge;

import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.inneragent.starter.IaTool;
import com.inneragent.starter.IaToolDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.AutowireCapableBeanFactory;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.classreading.MetadataReader;
import org.springframework.core.type.classreading.MetadataReaderFactory;
import org.springframework.util.ClassUtils;

/**
 * 宿主工具扫描(P1-T2b 职责①):两条来源 ——
 * <ol>
 *   <li>容器中既有 bean:遍历已实例化的单例(smart 单例阶段,不做 eager 初始化),
 *       收集其 {@link IaTool} 方法;代理 bean 取 user class 上的注解。</li>
 *   <li>{@code inneragent.bridge.tool-packages} 指定包:类路径扫描带 @IaTool 方法的
 *       类,非 bean 者以 {@code createBean} 实例化并注册(宿主无注解驱动需求时不配置)。</li>
 * </ol>
 * 工具名重复、schema 生成失败等按 {@code scan.fail-fast}(默认 true)决定抛出阻断启动
 * 还是 WARN 跳过。扫描顺序排序后输出,保证注册次序确定。
 */
public class IaToolScanner {

	private static final Logger log = LoggerFactory.getLogger(IaToolScanner.class);

	private final ConfigurableApplicationContext applicationContext;
	private final List<String> toolPackages;
	private final boolean failFast;
	/** 本扫描器已实例化的非 bean 工具类(重复扫描复用,避免重复 createBean/注册) */
	private final Map<String, Object> instantiatedToolBeans = new java.util.concurrent.ConcurrentHashMap<>();

	public IaToolScanner(ConfigurableApplicationContext applicationContext, List<String> toolPackages, boolean failFast) {
		this.applicationContext = applicationContext;
		this.toolPackages = toolPackages == null ? List.of() : toolPackages;
		this.failFast = failFast;
	}

	public List<IaToolDefinition> scan() {
		Map<String, IaToolDefinition> definitions = new LinkedHashMap<>();
		scanExistingBeans(definitions);
		if (!this.toolPackages.isEmpty()) {
			scanPackages(definitions);
		}
		return List.copyOf(definitions.values());
	}

	private void scanExistingBeans(Map<String, IaToolDefinition> definitions) {
		ConfigurableListableBeanFactory beanFactory = this.applicationContext.getBeanFactory();
		// allowEagerInit=false:仅遍历已实例化的单例,不触发 lazy/prototype 提前创建
		for (String beanName : beanFactory.getBeanNamesForType(Object.class, true, false)) {
			Object bean = beanFactory.getSingleton(beanName);
			if (bean == null || bean instanceof String || bean.getClass().getName().startsWith("org.springframework")) {
				continue;
			}
			collectFrom(ClassUtils.getUserClass(bean), bean, definitions);
		}
	}

	private void scanPackages(Map<String, IaToolDefinition> definitions) {
		ClassLoader classLoader = this.applicationContext.getClassLoader();
		ClassPathScanningCandidateComponentProvider provider = new ClassPathScanningCandidateComponentProvider(false,
				this.applicationContext.getEnvironment());
		// @IaTool 标在方法上,默认的类级注解过滤器不适用:自定义 TypeFilter 加载类后检查方法
		provider.addIncludeFilter((MetadataReader metadataReader, MetadataReaderFactory metadataReaderFactory) -> {
			try {
				return hasIaToolMethod(ClassUtils.forName(metadataReader.getClassMetadata().getClassName(), classLoader));
			}
			catch (ClassNotFoundException unreadable) {
				handleFailure("tool-packages 扫描类不可加载: " + metadataReader.getClassMetadata().getClassName(),
						unreadable);
				return false;
			}
		});
		for (String toolPackage : this.toolPackages) {
			for (BeanDefinition candidate : provider.findCandidateComponents(toolPackage)) {
				try {
					Class<?> toolClass = ClassUtils.forName(candidate.getBeanClassName(), classLoader);
					Object bean = this.instantiatedToolBeans.get(toolClass.getName());
					if (bean == null) {
						bean = existingBean(toolClass);
					}
					if (bean == null) {
						AutowireCapableBeanFactory autowiring = this.applicationContext.getAutowireCapableBeanFactory();
						bean = autowiring.createBean(toolClass);
						this.applicationContext.getBeanFactory()
							.registerSingleton("ia.tool." + toolClass.getName(), bean);
					}
					this.instantiatedToolBeans.put(toolClass.getName(), bean);
					collectFrom(ClassUtils.getUserClass(bean), bean, definitions);
				}
				catch (Exception failedCandidate) {
					handleFailure("tool-packages 候选类处理失败: " + candidate.getBeanClassName(), failedCandidate);
				}
			}
		}
	}

	private static boolean hasIaToolMethod(Class<?> type) {
		for (Class<?> current = type; current != null && current != Object.class; current = current.getSuperclass()) {
			for (Method method : current.getDeclaredMethods()) {
				if (method.isAnnotationPresent(IaTool.class)) {
					return true;
				}
			}
		}
		return false;
	}

	private Object existingBean(Class<?> type) {
		ConfigurableListableBeanFactory beanFactory = this.applicationContext.getBeanFactory();
		Object byWellKnownName = beanFactory.getSingleton("ia.tool." + type.getName());
		if (byWellKnownName != null) {
			return byWellKnownName;
		}
		for (String beanName : beanFactory.getBeanNamesForType(type, true, false)) {
			Object bean = beanFactory.getSingleton(beanName);
			if (bean != null) {
				return bean;
			}
		}
		return null;
	}

	private void collectFrom(Class<?> clazz, Object bean, Map<String, IaToolDefinition> definitions) {
		for (Class<?> type = clazz; type != null && type != Object.class; type = type.getSuperclass()) {
			for (Method method : type.getDeclaredMethods()) {
				if (!method.isAnnotationPresent(IaTool.class) || method.isSynthetic()) {
					continue;
				}
				try {
					IaToolDefinition definition = IaToolDefinition.of(method, bean);
					IaToolDefinition existing = definitions.get(definition.name());
					if (existing != null) {
						if (existing.method().equals(definition.method()) && existing.bean() == definition.bean()) {
							// 幂等:同一工具经多条来源(容器单例 + 包扫描)重复发现
							return;
						}
						throw new IllegalStateException("工具名重复: " + definition.name() + "(已在 "
								+ existing.method().getDeclaringClass().getSimpleName() + " 声明)");
					}
					definitions.put(definition.name(), definition);
				}
				catch (Exception invalidTool) {
					handleFailure("@IaTool 方法处理失败: " + method, invalidTool);
				}
			}
		}
	}

	private void handleFailure(String message, Exception failure) {
		if (this.failFast) {
			throw new IllegalStateException(message, failure);
		}
		log.warn("{}(scan.fail-fast=false,已跳过): {}", message, failure.toString());
	}

}
