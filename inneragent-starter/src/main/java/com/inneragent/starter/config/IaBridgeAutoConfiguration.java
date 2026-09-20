package com.inneragent.starter.config;

import java.net.URI;
import java.time.Clock;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.starter.IaToolInvoker;
import com.inneragent.starter.act.IaActJwksCache;
import com.inneragent.starter.act.IaActTokenFilter;
import com.inneragent.starter.act.IaActTokenVerifier;
import com.inneragent.starter.bridge.IaMcpServerBridge;
import com.inneragent.starter.bridge.IaToolRegistrar;
import com.inneragent.starter.bridge.IaToolScanner;
import com.inneragent.starter.client.InnerAgentBridgeClient;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.util.StringUtils;

/**
 * InnerAgent 宿主桥自动装配(P1-T2b 职责④):
 * <ul>
 *   <li>{@code inneragent.bridge.enabled=false} 不装配任何桥组件;</li>
 *   <li>依赖 servlet web 宿主(spring-boot-starter-web 栈即可,不强制其他技术栈);</li>
 *   <li>serverBase 未配置:启动 WARN 不阻断,验签 fail-closed(401)。</li>
 * </ul>
 * Filter/Servlet 均以 RegistrationBean 形态注册(避免 Boot 对裸 Filter/Servlet bean 的
 * 全局兜底注册把验签 Filter 铺到宿主全部路径),Filter 仅拦桥端点。
 */
@AutoConfiguration(after = ServletWebServerFactoryAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "inneragent.bridge", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(IaBridgeProperties.class)
public class IaBridgeAutoConfiguration {

	private static final Logger log = LoggerFactory.getLogger(IaBridgeAutoConfiguration.class);

	@Bean
	public IaToolInvoker iaToolInvoker(ObjectProvider<ObjectMapper> objectMapper) {
		return new IaToolInvoker(objectMapper.getIfAvailable(ObjectMapper::new));
	}

	@Bean
	public IaActJwksCache iaActJwksCache(IaBridgeProperties properties) {
		String serverBase = properties.getServerBase() == null ? ""
				: StringUtils.trimWhitespace(properties.getServerBase());
		if (serverBase.isEmpty()) {
			log.warn("inneragent.bridge.server-base 未配置:JWKS 不可达,/ia-mcp 所有请求将 401 fail-closed(启动不阻断)");
		}
		URI jwksUri = serverBase.isEmpty() ? null : URI.create(serverBase + properties.getAct().getJwksPath());
		return new IaActJwksCache(jwksUri, properties.getAct().getCacheTtl(), properties.getAct().getKeyRetention(),
				properties.getAct().getForcedRefreshCooldown(), Clock.systemUTC());
	}

	@Bean
	public IaActTokenVerifier iaActTokenVerifier(IaActJwksCache jwksCache, IaBridgeProperties properties) {
		List<String> audiences = properties.getAct().getAudiences();
		return new IaActTokenVerifier(jwksCache, properties.getAct().getIssuer(),
				audiences == null || audiences.isEmpty() ? List.of("ia-mcp") : audiences,
				properties.getAct().getClockSkew(), Clock.systemUTC());
	}

	@Bean
	public FilterRegistrationBean<IaActTokenFilter> iaActTokenFilterRegistration(IaActTokenVerifier verifier,
			IaBridgeProperties properties) {
		FilterRegistrationBean<IaActTokenFilter> registration = new FilterRegistrationBean<>(
				new IaActTokenFilter(verifier, properties.getEndpoint()));
		registration.addUrlPatterns(properties.getEndpoint());
		registration.setName("iaActTokenFilter");
		registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
		return registration;
	}

	@Bean
	public IaMcpServerBridge iaMcpServerBridge(IaBridgeProperties properties, IaToolInvoker invoker) {
		return new IaMcpServerBridge(properties.getEndpoint(), properties.getServerName(), "0.1.0", invoker);
	}

	@Bean
	public ServletRegistrationBean<HttpServletStatelessServerTransport> iaMcpTransportRegistration(
			IaMcpServerBridge bridge, IaBridgeProperties properties) {
		return new ServletRegistrationBean<>(bridge.transport(), properties.getEndpoint());
	}

	@Bean
	public IaToolScanner iaToolScanner(ConfigurableApplicationContext applicationContext, IaBridgeProperties properties) {
		return new IaToolScanner(applicationContext, properties.getToolPackages(), properties.getScan().isFailFast());
	}

	@Bean
	public IaToolRegistrar iaToolRegistrar(IaToolScanner scanner, IaMcpServerBridge bridge) {
		return new IaToolRegistrar(scanner, bridge);
	}

	@Bean
	public InnerAgentBridgeClient innerAgentBridgeClient(IaBridgeProperties properties,
			ObjectProvider<ObjectMapper> objectMapper) {
		return new InnerAgentBridgeClient(properties.getServerBase(), objectMapper.getIfAvailable(ObjectMapper::new));
	}

}
