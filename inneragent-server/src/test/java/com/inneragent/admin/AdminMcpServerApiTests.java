package com.inneragent.admin;

import com.inneragent.agent.entity.McpServerConfig;
import com.inneragent.agent.mcp.McpAppServerService;
import com.inneragent.agent.mcp.McpThirdPartyServerSupport;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminMcpServerController;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.controller.vo.McpServerRespVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
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
 * 三方 MCP 服务器 admin API 切片测试(P4-W13):X-IA-Admin-Key 403 矩阵 +
 * 注册/列表/更新/启停/删除路由语义 + 凭据打码。MockMvc standalone,
 * service 以 mock 注入(服务层校验逻辑由 McpThirdPartyServerServiceTests 覆盖)。
 */
class AdminMcpServerApiTests {

    private static final String ADMIN_KEY = "test-admin-key";
    private static final String BASE = "/ia/api/v1/admin/mcp-servers";

    private McpAppServerService appServerService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        appServerService = Mockito.mock(McpAppServerService.class);
        AdminMcpServerController controller = new AdminMcpServerController(appServerService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
    }

    private static String body() {
        return """
                {
                  "serverKey": "crm",
                  "name": "CRM 三方",
                  "endpointUrl": "https://crm.example.com/mcp",
                  "transport": "streamable-http",
                  "authType": "STATIC_HEADER",
                  "headerName": "X-Api-Key",
                  "credentials": "secret-crm-key",
                  "timeoutSeconds": 30,
                  "enabled": true
                }
                """;
    }

    private static McpServerConfig config(long id) {
        McpServerConfig row = McpServerConfig.builder()
                .appId(1L).serverKey("crm").name("CRM 三方")
                .endpointUrl("https://crm.example.com/mcp")
                .transport("streamable-http").authType("STATIC_HEADER")
                .headerName("X-Api-Key").credentials("secret-crm-key")
                .timeoutSeconds(30).enabled(true)
                .build();
        row.setId(id);
        row.setUpdateTime(LocalDateTime.of(2026, 1, 1, 0, 0));
        return row;
    }

    // ------------------------------------------------------------------
    // 403 矩阵(AdminTokenFilter 守卫)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("无密钥:全部路由 403(复用 AdminTokenFilter 缺省封闭)")
    void requiresAdminKey() throws Exception {
        MockMvc closed = MockMvcBuilders.standaloneSetup(new AdminMcpServerController(appServerService))
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
        closed.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isForbidden());
        closed.perform(get(BASE)).andExpect(status().isForbidden());
        closed.perform(put(BASE + "/9").contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isForbidden());
        closed.perform(post(BASE + "/9/enable")).andExpect(status().isForbidden());
        closed.perform(post(BASE + "/9/disable")).andExpect(status().isForbidden());
        closed.perform(delete(BASE + "/9")).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("错误密钥:403;正确密钥:200")
    void wrongKeyRejected() throws Exception {
        mockMvc.perform(get(BASE).header(AdminTokenFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());
        when(appServerService.list(1L)).thenReturn(List.of(config(9L)));
        mockMvc.perform(get(BASE).header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ------------------------------------------------------------------
    // CRUD 路由语义 + 凭据打码
    // ------------------------------------------------------------------

    @Test
    @DisplayName("注册:200 返回打码体(credentials 不回显原文);501 透传")
    void registerMasksCredentials() throws Exception {
        when(appServerService.register(any(McpThirdPartyServerSupport.Upsert.class)))
                .thenReturn(config(9L));
        mockMvc.perform(post(BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.serverKey").value("crm"))
                .andExpect(jsonPath("$.data.credentialsMasked").value("se***"));

        when(appServerService.register(any(McpThirdPartyServerSupport.Upsert.class)))
                .thenThrow(new BusinessException(501,
                        "三方 MCP OAuth(CIMD/DCR + RFC 8707)暂未实现"));
        mockMvc.perform(post(BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body().replace("STATIC_HEADER", "OAUTH")))
                .andExpect(status().isNotImplemented());
    }

    @Test
    @DisplayName("启停/删除路由接通服务层;服务 404 透传")
    void lifecycleRoutes() throws Exception {
        when(appServerService.setEnabled(1L, 9L, true)).thenReturn(config(9L));
        when(appServerService.setEnabled(1L, 9L, false)).thenReturn(config(9L));
        Mockito.doThrow(new BusinessException(404, "三方 MCP 服务不存在"))
                .when(appServerService).delete(1L, 404L);

        mockMvc.perform(post(BASE + "/9/enable").header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());
        mockMvc.perform(post(BASE + "/9/disable").header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());
        mockMvc.perform(delete(BASE + "/404").header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
        Mockito.verify(appServerService).delete(eq(1L), eq(404L));
    }

    @Test
    @DisplayName("更新:200 返回打码体")
    void updateRoute() throws Exception {
        when(appServerService.update(eq(1L), eq(9L),
                any(McpThirdPartyServerSupport.Upsert.class))).thenReturn(config(9L));
        mockMvc.perform(put(BASE + "/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.endpointUrl").value("https://crm.example.com/mcp"))
                .andExpect(jsonPath("$.data.credentialsMasked").value("se***"));
    }
}
