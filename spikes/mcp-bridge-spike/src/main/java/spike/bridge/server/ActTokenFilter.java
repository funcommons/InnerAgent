package spike.bridge.server;

import java.io.IOException;
import java.util.Map;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Spike proof for starter responsibility ③'s hook point: a plain Jakarta Servlet Filter
 * registered in front of the MCP transport servlets (/ia-mcp, /ia-mcp-stateless) that
 * validates the X-IA-Act header and stashes the parsed claims as a request attribute.
 *
 * The MCP SDK knows nothing about this filter - which is exactly the point: auth happens
 * in the host's normal servlet filter chain, before the SDK transport sees the request.
 * The stashed attribute is later lifted into McpTransportContext by the transport's
 * contextExtractor (see IaMcpBridge), so tool handlers receive the verified identity.
 */
public class ActTokenFilter implements Filter {

	public static final String ATTR_ACT_CLAIMS = "ia.spike.actClaims";

	private final BridgeObservatory observatory;

	public ActTokenFilter(BridgeObservatory observatory) {
		this.observatory = observatory;
	}

	@Override
	@SuppressWarnings("unchecked")
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		HttpServletRequest req = (HttpServletRequest) request;
		HttpServletResponse res = (HttpServletResponse) response;
		if (!req.getRequestURI().startsWith("/ia-mcp")) {
			chain.doFilter(request, response);
			return;
		}
		Map<String, Object> claims = ActTokens.parse(req.getHeader(ActTokens.HEADER));
		Map<String, Object> act = claims == null ? null : (Map<String, Object>) claims.get("act");
		if (claims == null || act == null || act.get("sub") == null) {
			this.observatory.actRejected.incrementAndGet();
			res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "missing or invalid " + ActTokens.HEADER);
			return;
		}
		this.observatory.actValidated.incrementAndGet();
		this.observatory.lastValidatedActSub = String.valueOf(act.get("sub"));
		req.setAttribute(ATTR_ACT_CLAIMS, claims);
		chain.doFilter(request, response);
	}

}
