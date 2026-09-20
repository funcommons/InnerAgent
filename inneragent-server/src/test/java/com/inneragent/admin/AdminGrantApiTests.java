package com.inneragent.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.ToolGrant;
import com.inneragent.platform.toolhub.ToolGrantService;
import com.inneragent.server.admin.AdminGrantController;
import com.inneragent.server.admin.AdminTokenFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 工具授权 admin API 切片测试(P1-T2a):授予/撤销/列表过滤与鉴权。
 */
class AdminGrantApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private ToolGrantService grantService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        grantService = Mockito.mock(ToolGrantService.class);
        AdminGrantController controller = new AdminGrantController(grantService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
    }

    private static ToolGrant grant(long id) {
        ToolGrant row = new ToolGrant();
        row.setId(id);
        row.setUserId(12993L);
        row.setToolFqn("mcp__crm__list_users");
        row.setScope("permanent");
        row.setRiskAtGrant("medium");
        row.setSource("admin");
        return row;
    }

    @Test
    @DisplayName("授予:200;conversation 缺会话 ID 400")
    void grantTool() throws Exception {
        when(grantService.grant(eq(12993L), eq("list_users"), eq("permanent"),
                org.mockito.ArgumentMatchers.isNull(), eq("白名单")))
                .thenReturn(grant(5L));

        mockMvc.perform(post("/ia/api/v1/admin/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("""
                                {"userId":12993,"toolName":"list_users","scope":"permanent",
                                 "decisionNote":"白名单"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.toolFqn").value("mcp__crm__list_users"))
                .andExpect(jsonPath("$.data.scope").value("permanent"));

        doThrow(new BusinessException(400, "conversation 授权必须携带会话 ID"))
                .when(grantService).grant(eq(12993L), eq("list_users"), eq("conversation"),
                        org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull());

        mockMvc.perform(post("/ia/api/v1/admin/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("""
                                {"userId":12993,"toolName":"list_users","scope":"conversation"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("列表:activeOnly 默认 true,过滤参数透传")
    void listGrants() throws Exception {
        when(grantService.list(12993L, "list_users", "permanent", true))
                .thenReturn(List.of(grant(5L)));

        mockMvc.perform(get("/ia/api/v1/admin/grants")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("userId", "12993")
                        .param("toolName", "list_users")
                        .param("scope", "permanent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(5));
    }

    @Test
    @DisplayName("撤销:DELETE 路由透传决策记录;404 透传")
    void revokeGrant() throws Exception {
        mockMvc.perform(delete("/ia/api/v1/admin/grants/5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("{\"decisionNote\":\"用户撤销\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        verify(grantService).revoke(eq(5L), eq("用户撤销"));

        doThrow(new BusinessException(404, "授权不存在: 99"))
                .when(grantService).revoke(eq(99L), any());
        mockMvc.perform(delete("/ia/api/v1/admin/grants/99")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
    }
}
