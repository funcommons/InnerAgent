package com.inneragent.server.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * actuator 端点凭据域豁免测试(IA-1 指标出口,docs/灰度与指标大盘.md §7.1;
 * 与 02-技术方案 §S5「同源策略由部署层收敛」同口径:actuator 是部署层内网
 * 端点,不属 embed-token 业务凭据域):
 * <ul>
 *   <li>{@code /actuator/**} 不进入 embed 验签——避免垃圾 Bearer 让内网抓取
 *       fail-closed 401,也避免 embed 身份(AppContext/UserContext)写入
 *       基础设施端点;</li>
 *   <li>业务路径豁免不扩散:embed 过滤器对业务请求行为不变。</li>
 * </ul>
 */
class ActuatorPathExemptionTests {

    private final EmbedTokenAuthenticationFilter embedFilter =
            new EmbedTokenAuthenticationFilter(stubVerifier());

    @Test
    @DisplayName("actuator 前缀:embed 验签过滤器整体跳过(有无 Bearer 均然)")
    void embedFilterSkipsActuatorPrefix() {
        assertThat(embedFilter.shouldNotFilter(actuatorRequest(null))).isTrue();
        assertThat(embedFilter.shouldNotFilter(actuatorRequest("Bearer not-a-token")))
                .isTrue();
        assertThat(embedFilter.shouldNotFilter(actuatorRequest("Bearer "))).isTrue();
    }

    @Test
    @DisplayName("业务路径豁免不扩散:embed 过滤器照常进入验签判定")
    void businessPathsRemainFiltered() {
        MockHttpServletRequest business = actuatorRequest(null);
        business.setRequestURI("/ia/api/v1/runs");
        assertThat(embedFilter.shouldNotFilter(business)).isFalse();

        // admin 凭据域既有豁免保持不变(P2-admin 双轨裁决语义)
        MockHttpServletRequest admin = actuatorRequest(null);
        admin.setRequestURI("/ia/api/v1/admin/apps");
        assertThat(embedFilter.shouldNotFilter(admin)).isTrue();
    }

    private static MockHttpServletRequest actuatorRequest(String authorization) {
        MockHttpServletRequest request =
                new MockHttpServletRequest("GET", "/actuator/prometheus");
        if (authorization != null) {
            request.addHeader("Authorization", authorization);
        }
        return request;
    }

    /** 验签器不参与 shouldNotFilter 判定,null 依赖即可(不会被调用) */
    private static EmbedTokenVerifier stubVerifier() {
        return new EmbedTokenVerifier(null);
    }
}
