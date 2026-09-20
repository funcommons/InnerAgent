package com.inneragent.starter.act;

import java.io.IOException;

import com.inneragent.starter.IaBridgeContextKeys;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * X-IA-Act 验签 Filter(P1-T2b 职责②,FINDINGS §2.3 第二段挂点):
 * 普通 Jakarta Filter,注册在 MCP 传输 servlet 之前,仅拦截桥端点(默认 /ia-mcp);
 * 验签失败 401 fail-closed,MCP SDK 对此无感知 —— 正是宿主正常 Filter 链形态。
 *
 * <p>验签通过后把 {@link IaActClaims} 暂存为 request attribute,由传输的
 * contextExtractor 提升为 {@code McpTransportContext}(键见
 * {@link IaBridgeContextKeys}),工具处理器据此重建用户上下文 —— 主服务后续
 * tools/call 每请求携带新 token(exp 60s),上下文按请求独立。
 */
public class IaActTokenFilter implements Filter {

	private static final Logger log = LoggerFactory.getLogger(IaActTokenFilter.class);

	/** 验签后 claims 的 request attribute 名 */
	public static final String ATTR_ACT_CLAIMS = IaActClaims.class.getName() + ".verified";

	private final IaActTokenVerifier verifier;
	private final String endpointPath;

	public IaActTokenFilter(IaActTokenVerifier verifier, String endpointPath) {
		this.verifier = verifier;
		this.endpointPath = endpointPath;
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		HttpServletRequest req = (HttpServletRequest) request;
		HttpServletResponse res = (HttpServletResponse) response;
		if (!targetsEndpoint(req)) {
			chain.doFilter(request, response);
			return;
		}
		try {
			IaActClaims claims = this.verifier.verify(req.getHeader(IaActTokenVerifier.ACT_HEADER));
			req.setAttribute(ATTR_ACT_CLAIMS, claims);
			chain.doFilter(request, response);
		}
		catch (IaActTokenException rejected) {
			log.debug("act token 验签拒绝: {}", rejected.getMessage());
			reject(res);
		}
	}

	private boolean targetsEndpoint(HttpServletRequest request) {
		String uri = request.getRequestURI();
		String contextPath = request.getContextPath() == null ? "" : request.getContextPath();
		String path = contextPath.isEmpty() || !uri.startsWith(contextPath) ? uri
				: uri.substring(contextPath.length());
		return path.equals(this.endpointPath);
	}

	private static void reject(HttpServletResponse response) throws IOException {
		response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
		response.setContentType("application/json;charset=UTF-8");
		response.setHeader("WWW-Authenticate", "error=\"invalid_act_token\"");
		response.getWriter().write("{\"error\":\"invalid_act_token\"}");
	}

}
