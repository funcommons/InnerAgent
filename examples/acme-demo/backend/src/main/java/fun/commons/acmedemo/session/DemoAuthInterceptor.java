package fun.commons.acmedemo.session;

import com.fasterxml.jackson.databind.ObjectMapper;
import fun.commons.acmedemo.common.R;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 演示登录拦截器:校验 Authorization: Bearer {demo-token},
 * 通过后把 username / userId 放入 request attribute 供控制器使用。
 *
 * 失败 → 401 + {code,msg,data} 信封。注册范围见 WebConfig(仅 /api 下需登录
 * 端点;/ia/webhook 是 InnerAgent 回调,靠 HMAC 验签保护;/ia-mcp 是 starter
 * 桥端点,靠 X-IA-Act 验签 Filter 保护——都不走本拦截器,接入指南 §4.2/§6.3)。
 */
@Component
@RequiredArgsConstructor
public class DemoAuthInterceptor implements HandlerInterceptor {

    public static final String ATTR_USERNAME = "demoUsername";
    public static final String ATTR_USER_ID = "demoUserId";

    private static final ThreadLocal<DemoSessionService.Session> CURRENT = new ThreadLocal<>();

    private final DemoSessionService sessionService;
    private final ObjectMapper objectMapper;

    /** 控制器取当前演示会话;仅在拦截器放行的请求内有效。 */
    public static DemoSessionService.Session current() {
        return CURRENT.get();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String auth = request.getHeader(HttpHeaders.AUTHORIZATION);
        String token = auth != null && auth.startsWith("Bearer ") ? auth.substring(7).trim() : null;
        var session = sessionService.resolve(token);
        if (session.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write(objectMapper.writeValueAsString(R.error(401, "未登录或演示会话无效")));
            return false;
        }
        request.setAttribute(ATTR_USERNAME, session.get().username());
        request.setAttribute(ATTR_USER_ID, session.get().userId());
        CURRENT.set(session.get());
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                Exception ex) {
        CURRENT.remove(); // 线程池复用,必须清理
    }
}
