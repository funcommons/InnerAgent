package spike.bridge;

import java.io.InputStream;
import java.util.Properties;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Checklist item 1: the official MCP Java SDK coordinates resolve from Maven Central and
 * provide the classes the bridge needs in ONE artifact (no Spring AI required).
 */
class T01_DependencyReachabilityTest {

	private static final String EXPECTED_VERSION = "2.0.1";

	@Test
	void sdkJarCarriesPinnedVersion() throws Exception {
		Properties props = new Properties();
		try (InputStream in = getClass().getClassLoader()
			.getResourceAsStream("META-INF/maven/io.modelcontextprotocol.sdk/mcp-core/pom.properties")) {
			assertTrue(in != null, "mcp-core pom.properties not on classpath");
			props.load(in);
		}
		assertEquals(EXPECTED_VERSION, props.getProperty("version"), "resolved mcp-core version");
		assertEquals("io.modelcontextprotocol.sdk", props.getProperty("groupId"));
		assertEquals("mcp-core", props.getProperty("artifactId"));
	}

	@Test
	void allBridgeRelevantClassesPresentInCoreArtifact() throws Exception {
		for (String className : new String[] {
				// client side
				"io.modelcontextprotocol.client.McpSyncClient",
				"io.modelcontextprotocol.client.McpClient",
				"io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport",
				"io.modelcontextprotocol.client.transport.customizer.McpSyncHttpClientRequestCustomizer",
				// server side (servlet transport lives in core, NOT in a Spring module)
				"io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider",
				"io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport",
				"io.modelcontextprotocol.server.McpStatelessSyncServer",
				// schema surface
				"io.modelcontextprotocol.spec.McpSchema$ToolAnnotations",
				"io.modelcontextprotocol.common.McpTransportContext" }) {
			Class.forName(className);
		}
	}

	@Test
	void springAiOwnedTransportsAreNotOnClasspath() {
		// Tech spec Q1: "Spring 传输在 Spring AI 2.0,不引入".
		// The core artifact must not drag the WebFlux/WebMVC transports in.
		assertThrows(ClassNotFoundException.class,
				() -> Class.forName("io.modelcontextprotocol.server.transport.WebFluxSseServerTransportProvider"));
		assertThrows(ClassNotFoundException.class,
				() -> Class.forName("io.modelcontextprotocol.server.transport.WebMvcSseServerTransportProvider"));
	}

	@Test
	void runtimeStackSatisfiesJava21AndJakartaServlet() throws Exception {
		assertEquals(21, Runtime.version().feature(), "must run on Java 21");
		// jakarta.servlet 5+/6 (embedded Tomcat 10.1 from Spring Boot 3.5) is what the
		// SDK's HttpServlet*ServerTransport* requires.
		Class.forName("jakarta.servlet.http.HttpServlet");
		Class.forName("org.apache.catalina.startup.Tomcat");
	}

}
