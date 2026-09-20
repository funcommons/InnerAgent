package spike.bridge;

import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import spike.bridge.server.ActTokenFilter;
import spike.bridge.server.BridgeObservatory;

/**
 * Minimal Spring Boot host application: proves the official SDK servlet transports can be
 * mounted on an embedded Tomcat (the deployment shape of the real starter bridge) with an
 * auth filter in front - without any Spring AI dependency.
 */
@SpringBootApplication
public class BridgeApp {

	public static void main(String[] args) {
		SpringApplication.run(BridgeApp.class, args);
	}

	@Bean
	public HttpServletStreamableServerTransportProvider statefulTransportProvider() {
		return IaMcpBridge.statefulTransportProvider();
	}

	@Bean
	public McpSyncServer iaStatefulMcpServer(HttpServletStreamableServerTransportProvider provider,
			BridgeObservatory observatory) {
		return IaMcpBridge.statefulServer(provider, observatory);
	}

	@Bean
	public HttpServletStatelessServerTransport statelessTransport() {
		return IaMcpBridge.statelessTransport();
	}

	@Bean
	public McpStatelessSyncServer iaStatelessMcpServer(HttpServletStatelessServerTransport transport,
			BridgeObservatory observatory) {
		return IaMcpBridge.statelessServer(transport, observatory);
	}

	@Bean
	public ServletRegistrationBean<HttpServletStreamableServerTransportProvider> iaMcpServlet(
			HttpServletStreamableServerTransportProvider provider) {
		return new ServletRegistrationBean<>(provider, IaMcpBridge.STATEFUL_ENDPOINT);
	}

	@Bean
	public ServletRegistrationBean<HttpServletStatelessServerTransport> iaMcpStatelessServlet(
			HttpServletStatelessServerTransport transport) {
		return new ServletRegistrationBean<>(transport, IaMcpBridge.STATELESS_ENDPOINT);
	}

	@Bean
	public FilterRegistrationBean<ActTokenFilter> actTokenFilter(BridgeObservatory observatory) {
		FilterRegistrationBean<ActTokenFilter> registration = new FilterRegistrationBean<>(
				new ActTokenFilter(observatory));
		registration.addUrlPatterns(IaMcpBridge.STATEFUL_ENDPOINT, IaMcpBridge.STATELESS_ENDPOINT);
		registration.setOrder(1);
		return registration;
	}

}
