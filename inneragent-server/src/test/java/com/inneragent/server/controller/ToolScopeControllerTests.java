package com.inneragent.server.controller;

import com.inneragent.platform.toolhub.ResolveScopeOutcome;
import com.inneragent.platform.toolhub.ResolveScopeRequest;
import com.inneragent.platform.toolhub.ResolveScopeService;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.server.controller.vo.ToolResolveScopeReqVO;
import com.inneragent.server.controller.vo.ToolResolveScopeRespVO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * [new] /ia/api/v1/tools/resolve-scope 薄 REST 封装(P1-T3c 收口裁决):
 * 契约字段映射到 ResolveScopeService;降级返回空数组不报错;
 * 响应为协议四数组裸对象(无 CommonResult 信封,starter 直读)。
 */
class ToolScopeControllerTests {

    private ResolveScopeService resolveScopeService;
    private ToolScopeController controller;

    @BeforeEach
    void setUp() {
        resolveScopeService = mock(ResolveScopeService.class);
        controller = new ToolScopeController(resolveScopeService);
        authenticate(42L);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void mapsContractFieldsToResolveScopeService() {
        ResolveScopeOutcome outcome = ResolveScopeOutcome.resolved(
                List.of("page.objA"),
                List.of("objA.title"),
                List.of("objA.delete"),
                List.of("仅可编辑标题"));
        when(resolveScopeService.resolve(eq(1L), isNull(), any(ResolveScopeRequest.class), isNull()))
                .thenReturn(outcome);
        ToolResolveScopeReqVO request = new ToolResolveScopeReqVO();
        request.setUserId("10001");
        request.setTenantId("7");
        request.setPageId("page-1");
        request.setPageName("首页");
        request.setObjectId("obj-9");
        request.setObjectType("CHANGE_ORDER");
        request.setCustom(Map.of("kind", "urgent"));

        ToolResolveScopeRespVO response = controller.resolveScope(request);

        ArgumentCaptor<ResolveScopeRequest> payload =
                ArgumentCaptor.forClass(ResolveScopeRequest.class);
        org.mockito.Mockito.verify(resolveScopeService).resolve(
                eq(1L), isNull(), payload.capture(), isNull());
        assertThat(payload.getValue().pageId()).isEqualTo("page-1");
        assertThat(payload.getValue().objectId()).isEqualTo("obj-9");
        assertThat(payload.getValue().objectType()).isEqualTo("CHANGE_ORDER");
        assertThat(payload.getValue().toToolArgs())
                .containsEntry("custom", Map.of("kind", "urgent"));
        assertThat(response.visibleDomains()).containsExactly("page.objA");
        assertThat(response.writableFields()).containsExactly("objA.title");
        assertThat(response.forbidden()).containsExactly("objA.delete");
        assertThat(response.hints()).containsExactly("仅可编辑标题");
    }

    @Test
    void degradeStillReturnsEmptyProtocolArrays() {
        when(resolveScopeService.resolve(eq(1L), isNull(), any(), isNull()))
                .thenReturn(ResolveScopeOutcome.degraded("tool_absent"));

        ToolResolveScopeRespVO response = controller.resolveScope(new ToolResolveScopeReqVO());

        assertThat(response.visibleDomains()).isEmpty();
        assertThat(response.writableFields()).isEmpty();
        assertThat(response.forbidden()).isEmpty();
        assertThat(response.hints()).isEmpty();
    }

    private void authenticate(long userId) {
        SecurityUserDetails user = new SecurityUserDetails(
                userId, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }
}
