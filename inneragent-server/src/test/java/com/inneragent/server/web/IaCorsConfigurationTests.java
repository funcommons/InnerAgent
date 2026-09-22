package com.inneragent.server.web;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * iframe 跨源 CORS 测试(K 清单②):真实 WebMvc 装配(AnnotationConfig
 * 上下文 + WebMvcConfigurer 发现 + PreFlightHandler)下:
 * <ul>
 *   <li>配置 allowlist → 预检 200 + 头齐(来源/方法/头/credentials),
 *       API 与 SSE 端点同规则;放行来源实际请求带 Allow-Origin;</li>
 *   <li>未配置(缺省)→ 无任何 CORS 头(零回归:与未引入前行为一致);
 *       非放行来源预检被拒(403)且不带 Allow-Origin。</li>
 * </ul>
 */
class IaCorsConfigurationTests {

    private static final String ALLOWED = "https://host.example";

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mockMvc;

    @AfterEach
    void tearDown() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    @DisplayName("配置 allowlist:预检 200 + 头齐;非放行来源 403 且无 Allow-Origin")
    void configuredOriginsServePreflightWithFullHeaders() throws Exception {
        boot(Map.of("inneragent.cors.allowed-origins",
                ALLOWED + " , https://evil.example,, "));

        // 放行来源预检:API 端点(逗号分隔绑定 + 空白项忽略)
        mockMvc.perform(options("/ia/api/v1/skills")
                        .header(ORIGIN, ALLOWED)
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET")
                        .header(ACCESS_CONTROL_REQUEST_HEADERS,
                                "Authorization, X-IA-Act, X-IA-Admin-Key, X-Trace-Id"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_METHODS,
                        "GET,POST,OPTIONS"))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_HEADERS,
                        containsString("Authorization")))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_HEADERS,
                        containsString("X-Trace-Id")))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_HEADERS,
                        containsString("X-IA-Act")))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_HEADERS,
                        containsString("X-IA-Admin-Key")))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"));

        // SSE 端点同规则(POST /runs 与 GET /runs/{id}/events 预检;/ia/api/** 映射覆盖)
        mockMvc.perform(options("/ia/api/v1/runs")
                        .header(ORIGIN, ALLOWED)
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED));

        mockMvc.perform(options("/ia/api/v1/runs/run-1/events")
                        .header(ORIGIN, ALLOWED)
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED));

        // 非放行来源:预检被拒(403),不带 Allow-Origin
        mockMvc.perform(options("/ia/api/v1/skills")
                        .header(ORIGIN, "https://not-allowed.example")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    @DisplayName("未配置(缺省):预检被框架拒绝(403)且无任何 CORS 头——"
            + "与未引入本配置前行为一致(零回归)")
    void defaultConfigAddsNoCorsHeaders() throws Exception {
        boot(Map.of());

        mockMvc.perform(options("/ia/api/v1/skills")
                        .header(ORIGIN, ALLOWED)
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_ORIGIN))
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_METHODS))
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_CREDENTIALS))
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_HEADERS));
    }

    @Test
    @DisplayName("放行来源实际请求带 Allow-Origin(GET 路径)")
    void actualRequestCarriesAllowOrigin() throws Exception {
        boot(Map.of("inneragent.cors.allowed-origins", ALLOWED));

        mockMvc.perform(get("/ia/api/v1/skills").header(ORIGIN, ALLOWED))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED));
    }

    @Test
    @DisplayName("空白项被忽略;全空白 = 关闭(effectiveOrigins 为空)")
    void blankEntriesAreIgnoredAndCloseCors() {
        assertThat(new IaCorsConfiguration(
                        IaCorsConfiguration.Properties.of("  ", "", ALLOWED))
                .effectiveOrigins()).containsExactly(ALLOWED);
        assertThat(new IaCorsConfiguration(
                        IaCorsConfiguration.Properties.of("  ", ""))
                .effectiveOrigins()).isEmpty();
        assertThat(new IaCorsConfiguration(new IaCorsConfiguration.Properties())
                .effectiveOrigins()).isEmpty();
    }

    // ------------------------------------------------------------------

    /** 最小真实装配:注册 CORS 配置 + 探针控制器,验证 WebMvcConfigurer 生效。 */
    private void boot(Map<String, String> properties) {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new org.springframework.mock.web.MockServletContext());
        context.getEnvironment().getPropertySources()
                .addFirst(new MapPropertySource("ia-cors-test",
                        Map.copyOf(properties)));
        context.register(IaCorsConfiguration.class, ProbeController.class,
                EnableWebMvcConfig.class);
        context.refresh();
        mockMvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    /** 全量 MVC 基建(WebMvcConfigurationSupport),使 WebMvcConfigurer 被收集生效。 */
    @org.springframework.context.annotation.Configuration
    @org.springframework.web.servlet.config.annotation.EnableWebMvc
    static class EnableWebMvcConfig {
    }

    /** 探针控制器:仅为 CORS 链提供 /ia/api/** 下的真实 handler(含 SSE 形)。 */
    @RestController
    static class ProbeController {

        @GetMapping("/ia/api/v1/skills")
        String skills() {
            return "[]";
        }

        @org.springframework.web.bind.annotation.PostMapping("/ia/api/v1/runs")
        String run() {
            return "";
        }

        @GetMapping("/ia/api/v1/runs/{runId}/events")
        String events(@org.springframework.web.bind.annotation.PathVariable
                      String runId) {
            return "";
        }
    }
}
