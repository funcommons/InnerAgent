package com.inneragent.admin;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.ToolHealthService;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.platform.toolhub.ToolSchemaHistory;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AdminToolController;
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
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 工具注册 admin API 切片测试(P1-T2a):X-IA-Admin-Key 鉴权 + 注册/分诊/
 * 停用/删除路由语义。MockMvc standalone,mapper/service 以 mock 注入。
 */
class AdminToolApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private ToolRegistryService registryService;
    private ToolHealthService healthService;
    private MockMvc mockMvc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registryService = Mockito.mock(ToolRegistryService.class);
        healthService = Mockito.mock(ToolHealthService.class);
        AdminToolController controller = new AdminToolController(registryService, healthService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
    }

    private static String registerBody() {
        return """
                {
                  "serverKey": "crm",
                  "toolName": "list_users",
                  "description": "查询客户列表",
                  "parametersSchema": "{\\"type\\":\\"object\\"}",
                  "annotationsJson": "{\\"readOnlyHint\\":true}",
                  "source": "host_app"
                }
                """;
    }

    private static ToolRegistryEntry entry(long id) {
        ToolRegistryEntry entry = new ToolRegistryEntry();
        entry.setId(id);
        entry.setServerKey("crm");
        entry.setToolName("list_users");
        entry.setFqn("mcp__crm__list_users");
        entry.setRiskLevel("low");
        entry.setSchemaSha256("a".repeat(64));
        entry.setEnabled(true);
        return entry;
    }

    @Test
    @DisplayName("无密钥:全部 403(复用 AdminTokenFilter 缺省封闭)")
    void requiresAdminKey() throws Exception {
        MockMvc closed = MockMvcBuilders.standaloneSetup(new AdminToolController(registryService, healthService))
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
        closed.perform(post("/ia/api/v1/admin/tools")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("注册:200 返回实体;服务层校验失败透传 400")
    void registerTools() throws Exception {
        when(registryService.register(any())).thenAnswer(invocation -> entry(9L));

        mockMvc.perform(post("/ia/api/v1/admin/tools")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.fqn").value("mcp__crm__list_users"));

        // 切片层:mock service 抛 400 模拟服务端校验失败(serverKey 规则由
        // ToolRegistryServiceTests.serverKeyWithUnderscoreRejected 覆盖)
        when(registryService.register(any()))
                .thenThrow(new BusinessException(400, "serverKey 仅允许字母/数字/连字符"));
        mockMvc.perform(post("/ia/api/v1/admin/tools")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody().replace("\"crm\"", "\"bad_key\"")))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("注册冲突:409")
    void duplicateRegistrationConflicts() throws Exception {
        when(registryService.register(any()))
                .thenThrow(new BusinessException(409, "工具已注册: mcp__crm__list_users"));

        mockMvc.perform(post("/ia/api/v1/admin/tools")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(409));
    }

    @Test
    @DisplayName("活刷新分诊:compatible 返回 verdict+reasons;breaking 携带 pending 标记")
    void refreshSchemaTriage() throws Exception {
        ToolRegistryEntry compatible = entry(9L);
        compatible.setSchemaSha256("b".repeat(64));
        when(registryService.refreshSchema(eq(9L), any(), any(), any()))
                .thenReturn(new ToolRegistryService.SchemaTriageResult(
                        compatible, "compatible", List.of("nested_schema_changed")));

        mockMvc.perform(post("/ia/api/v1/admin/tools/9/schema")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("{\"parametersSchema\":\"{}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.verdict").value("compatible"))
                .andExpect(jsonPath("$.data.reasons[0]").value("nested_schema_changed"));

        ToolRegistryEntry breaking = entry(9L);
        breaking.setRevalidateRequired(true);
        breaking.setPendingSchemaSha256("c".repeat(64));
        when(registryService.refreshSchema(eq(9L), any(), any(), any()))
                .thenReturn(new ToolRegistryService.SchemaTriageResult(
                        breaking, "breaking", List.of("required_added:reason")));

        mockMvc.perform(post("/ia/api/v1/admin/tools/9/schema")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("{\"parametersSchema\":\"{}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.verdict").value("breaking"))
                .andExpect(jsonPath("$.data.revalidateRequired").value(true))
                .andExpect(jsonPath("$.data.pendingSchemaSha256").value("c".repeat(64)));
    }

    @Test
    @DisplayName("schema/confirm 与 schema/reject 路由")
    void confirmAndRejectPending() throws Exception {
        when(registryService.confirmPendingSchema(9L)).thenReturn(entry(9L));
        when(registryService.rejectPendingSchema(9L)).thenReturn(entry(9L));

        mockMvc.perform(post("/ia/api/v1/admin/tools/9/schema/confirm")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(9));
        mockMvc.perform(post("/ia/api/v1/admin/tools/9/schema/reject")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("列表/详情/历史/停用/删除路由")
    void listGetDisableDelete() throws Exception {
        when(registryService.list(Mockito.isNull(), Mockito.isNull()))
                .thenReturn(List.of(entry(9L)));
        when(registryService.getRequired(9L)).thenReturn(entry(9L));
        ToolSchemaHistory history = new ToolSchemaHistory();
        history.setFqn("mcp__crm__list_users");
        history.setTriage("unchanged");
        history.setOutcome("silent_refresh");
        when(registryService.history(9L)).thenReturn(List.of(history));
        when(registryService.disable(9L)).thenReturn(entry(9L));

        mockMvc.perform(get("/ia/api/v1/admin/tools")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].toolName").value("list_users"));
        mockMvc.perform(get("/ia/api/v1/admin/tools/9")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.fqn").value("mcp__crm__list_users"));
        mockMvc.perform(get("/ia/api/v1/admin/tools/9/schema-history")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].triage").value("unchanged"));
        mockMvc.perform(post("/ia/api/v1/admin/tools/9/disable")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabled").value(true));
        mockMvc.perform(delete("/ia/api/v1/admin/tools/9")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        Mockito.verify(registryService).delete(9L);
    }

    @Test
    @DisplayName("更新:强制高危不可下调 400 透传")
    void updateRiskDowngradeRejected() throws Exception {
        when(registryService.update(eq(9L), any()))
                .thenThrow(new BusinessException(400, "删除/资金/凭据类工具强制高危,不可下调"));

        mockMvc.perform(put("/ia/api/v1/admin/tools/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("{\"riskLevel\":\"low\"}"))
                .andExpect(status().isBadRequest());
    }
}
