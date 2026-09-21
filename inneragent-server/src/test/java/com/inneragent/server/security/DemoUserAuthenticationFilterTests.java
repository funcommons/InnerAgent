package com.inneragent.server.security;

import com.inneragent.server.admin.AdminTokenFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 演示用户认证过滤器作用域测试(OBS-R3-1 回归守卫):演示身份只兜底
 * <strong>非管理面</strong>的无 Bearer 请求;管理面凭据由
 * {@link AdminTokenFilter} 双轨裁决——
 * 引导 key 通道本就不写认证,demo 过滤器若再覆写 SecurityContext,
 * 熔断事件/审计的操作者会误记 demo-user(应按契约回落 admin)。
 */
class DemoUserAuthenticationFilterTests {

    /** 捕获过滤器链落地到控制器时的 SecurityContext 认证 */
    static final AtomicReference<Authentication> SEEN = new AtomicReference<>();

    @RestController
    static class ProbeController {

        @GetMapping("/ia/api/v1/admin/circuit-breaker")
        String adminEndpoint() {
            SEEN.set(SecurityContextHolder.getContext().getAuthentication());
            return "ok";
        }

        @GetMapping("/ia/api/v1/runs")
        String conversationEndpoint() {
            SEEN.set(SecurityContextHolder.getContext().getAuthentication());
            return "ok";
        }
    }

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SEEN.set(null);
        // 链序与 DemoSecurityConfiguration 一致:AdminTokenFilter → demo 过滤器
        mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .addFilters(new AdminTokenFilter("it-admin-key"),
                        new DemoSecurityConfiguration.DemoUserAuthenticationFilter())
                .build();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("OBS-R3-1:引导 key 通道到管理面,演示身份不再覆写 SecurityContext(操作者契约回落 admin)")
    void adminKeyChannelOnAdminPlaneStaysUnauthenticated() throws Exception {
        mockMvc.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header(AdminTokenFilter.HEADER, "it-admin-key"))
                .andExpect(status().isOk());

        // 无认证 → CircuitBreakerAdminService.currentOperator() 缺省 admin
        assertThat(SEEN.get()).isNull();
    }

    @Test
    @DisplayName("管理面会话通道(Bearer)同样不给演示身份留位")
    void bearerOnAdminPlaneSkipsDemoIdentity() throws Exception {
        mockMvc.perform(get("/ia/api/v1/admin/circuit-breaker")
                        .header("Authorization", "Bearer whatever"))
                // 单测便捷构造(无会话服务)下 Bearer 一律 403,但 demo 过滤器已跳过
                .andExpect(status().isForbidden());

        assertThat(SEEN.get()).as("请求被 AdminTokenFilter 拒绝,未达控制器").isNull();
        // shouldNotFilter 直接可证:Bearer 存在即跳过(与路径无关)
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest("GET", "/ia/api/v1/runs");
        request.addHeader("Authorization", "Bearer whatever");
        assertThat(new DemoSecurityConfiguration.DemoUserAuthenticationFilter().shouldNotFilter(request)).isTrue();
    }

    @Test
    @DisplayName("非管理面无 Bearer:演示身份照常兜底(P0 演示语义不破)")
    void nonAdminPlaneStillDefaultsToDemoUser() throws Exception {
        mockMvc.perform(get("/ia/api/v1/runs")).andExpect(status().isOk());

        assertThat(SEEN.get()).isNotNull();
        assertThat(SEEN.get().getName()).isEqualTo("demo-user");
    }

    @Test
    @DisplayName("管理面前缀判定:admin 路径即跳过(凭 X-IA-Demo-User 头与否无关)")
    void adminPrefixAlwaysSkipsDemoIdentity() {
        DemoSecurityConfiguration.DemoUserAuthenticationFilter filter = new DemoSecurityConfiguration.DemoUserAuthenticationFilter();

        org.springframework.mock.web.MockHttpServletRequest adminRequest =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "GET", "/ia/api/v1/admin/webhook-deliveries");
        assertThat(filter.shouldNotFilter(adminRequest)).isTrue();

        org.springframework.mock.web.MockHttpServletRequest plainRequest =
                new org.springframework.mock.web.MockHttpServletRequest("GET", "/ia/api/v1/runs");
        assertThat(filter.shouldNotFilter(plainRequest)).isFalse();
    }
}
