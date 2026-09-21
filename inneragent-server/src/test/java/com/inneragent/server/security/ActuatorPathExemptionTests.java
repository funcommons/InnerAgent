package com.inneragent.server.security;

import com.inneragent.server.security.DemoSecurityConfiguration.DemoUserAuthenticationFilter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * actuator 端点凭据域豁免测试(IA-1 指标出口,演示身份侧):
 * allow-anonymous-demo=true 场景下,{@code /actuator/**} 不注入 demo-user
 * ——抓取/探针端点与 embed 域豁免同口径(02-技术方案 §S5 部署层内网),
 * 凭据域保持干净;业务路径演示兜底语义不破。
 */
class ActuatorPathExemptionTests {

    private final DemoUserAuthenticationFilter demoFilter =
            new DemoUserAuthenticationFilter();

    @Test
    @DisplayName("actuator 前缀:演示身份过滤器跳过(不注入 demo-user)")
    void demoFilterSkipsActuatorPrefix() {
        assertThat(demoFilter.shouldNotFilter(actuatorRequest(null))).isTrue();
        assertThat(demoFilter.shouldNotFilter(actuatorRequest("Bearer whatever"))).isTrue();
    }

    @Test
    @DisplayName("业务路径豁免不扩散:演示兜底照常生效")
    void businessPathsRemainFiltered() {
        MockHttpServletRequest business = actuatorRequest(null);
        business.setRequestURI("/ia/api/v1/runs");
        assertThat(demoFilter.shouldNotFilter(business)).isFalse();
    }

    private static MockHttpServletRequest actuatorRequest(String authorization) {
        MockHttpServletRequest request =
                new MockHttpServletRequest("GET", "/actuator/prometheus");
        if (authorization != null) {
            request.addHeader("Authorization", authorization);
        }
        return request;
    }
}
