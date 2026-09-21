package com.inneragent.server.controller;

import com.inneragent.agent.entity.McpUserServer;
import com.inneragent.agent.mcp.McpThirdPartyServerSupport;
import com.inneragent.agent.mcp.McpUserServerService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.security.SecurityUserDetails;
import com.inneragent.server.controller.vo.McpServerRespVO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用户级三方 MCP 服务器 API 切片测试(P4-W13):embed 用户态(requireCurrentUserId)
 * 驱动的 CRUD 路由语义 + 行级归属透传 + 凭据打码。
 */
class McpUserServerControllerTests {

    private static final String BASE = "/ia/api/v1/mcp-servers";

    private McpUserServerService userServerService;
    private MockMvc mockMvc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        userServerService = Mockito.mock(McpUserServerService.class);
        McpUserServerController controller = new McpUserServerController(userServerService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new McpUserServerControllerTests.Advice())
                .build();
        authenticate(10001L);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static String body() {
        return """
                {
                  "serverKey": "ucrm",
                  "name": "我的 CRM",
                  "endpointUrl": "https://my-crm.example.com/mcp",
                  "authType": "STATIC_HEADER",
                  "headerName": "X-Api-Key",
                  "credentials": "secret-user-key",
                  "enabled": true
                }
                """;
    }

    private static McpUserServer row(long id) {
        McpUserServer server = McpUserServer.builder()
                .appId(1L).userId(10001L).serverKey("ucrm").name("我的 CRM")
                .endpointUrl("https://my-crm.example.com/mcp")
                .transport("streamable-http").authType("STATIC_HEADER")
                .headerName("X-Api-Key").credentials("secret-user-key")
                .timeoutSeconds(30).enabled(true)
                .build();
        server.setId(id);
        server.setUpdateTime(LocalDateTime.of(2026, 1, 1, 0, 0));
        return server;
    }

    @Test
    @DisplayName("注册:当前用户态透传服务层;响应凭据打码")
    void registerPassesScopedIdentity() throws Exception {
        when(userServerService.register(eq(1L), eq(10001L),
                any(McpThirdPartyServerSupport.Upsert.class))).thenReturn(row(7L));
        mockMvc.perform(post(BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.serverKey").value("ucrm"))
                .andExpect(jsonPath("$.data.credentialsMasked").value("se***"));
    }

    @Test
    @DisplayName("列表/详情:行级归属;他人行 404")
    void listAndGetOwned() throws Exception {
        when(userServerService.list(1L, 10001L)).thenReturn(List.of(row(7L)));
        when(userServerService.requireOwned(1L, 10001L, 8L))
                .thenThrow(new BusinessException(404, "三方 MCP 服务不存在"));

        mockMvc.perform(get(BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(7));
        mockMvc.perform(get(BASE + "/8"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("未登录(requireCurrentUserId 抛业务异常)→ 500 透传(生产 GlobalExceptionHandler 同口径)")
    void requiresAuthenticatedUser() throws Exception {
        SecurityContextHolder.clearContext();
        mockMvc.perform(get(BASE))
                .andExpect(status().isInternalServerError());
    }

    @Test
    @DisplayName("启停/删除/更新路由接通服务层")
    void lifecycleRoutes() throws Exception {
        when(userServerService.setEnabled(1L, 10001L, 7L, true)).thenReturn(row(7L));
        when(userServerService.setEnabled(1L, 10001L, 7L, false)).thenReturn(row(7L));
        when(userServerService.update(eq(1L), eq(10001L), eq(7L),
                any(McpThirdPartyServerSupport.Upsert.class))).thenReturn(row(7L));

        mockMvc.perform(post(BASE + "/7/disable"))
                .andExpect(status().isOk());
        mockMvc.perform(post(BASE + "/7/enable"))
                .andExpect(status().isOk());
        mockMvc.perform(put(BASE + "/7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body()))
                .andExpect(status().isOk());
        mockMvc.perform(delete(BASE + "/7"))
                .andExpect(status().isOk());
        Mockito.verify(userServerService).delete(1L, 10001L, 7L);
    }

    private void authenticate(long userId) {
        SecurityUserDetails user = new SecurityUserDetails(
                userId, "owner", "secret", 1, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    /** 测试态异常映射:BusinessException.code → HTTP 状态 + CommonResult 体。 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class Advice {

        @org.springframework.web.bind.annotation.ExceptionHandler(BusinessException.class)
        org.springframework.http.ResponseEntity<Object> onBusinessException(BusinessException e) {
            return org.springframework.http.ResponseEntity
                    .status(e.getCode() == null ? 500 : e.getCode())
                    .body(com.inneragent.platform.common.CommonResult.error(
                            e.getCode() == null ? 500 : e.getCode(), e.getMessage()));
        }
    }
}
