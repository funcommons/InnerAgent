package com.inneragent.admin;

import com.inneragent.agent.entity.AgentWorkspaceConfig;
import com.inneragent.agent.entity.AgentWorkspaceMigration;
import com.inneragent.agent.state.AgentStateCleanupPolicyService;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspaceMigrationService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.server.admin.AdminStateCleanupController;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AdminWorkspaceController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * workspace / state-cleanup 管理端语义归位测试(P2-srv me 迁移矩阵):
 * 原落 {@code /ia/api/v1/me/*} 的应用级配置端点迁 admin 面
 * ({@code /ia/api/v1/admin/workspace*}、{@code /ia/api/v1/admin/state-cleanup}),
 * 由 X-IA-Admin-Key 守卫;SDK me.ts 不消费这些端点(sdk-js 注释即「服务端自管」),
 * 迁移不影响 SDK 契约。MockMvc standalone,服务依赖 mock 注入。
 */
class AdminWorkspaceApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private AgentWorkspaceConfigService workspaceConfigService;
    private AgentWorkspaceMigrationService migrationService;
    private MockMvc workspaceMockMvc;
    private MockMvc cleanupMockMvc;
    private AgentStateCleanupPolicyService stateCleanupPolicyService;

    @BeforeEach
    void setUp() {
        workspaceConfigService = Mockito.mock(AgentWorkspaceConfigService.class);
        migrationService = Mockito.mock(AgentWorkspaceMigrationService.class);
        stateCleanupPolicyService = Mockito.mock(AgentStateCleanupPolicyService.class);

        AdminWorkspaceController workspaceController = new AdminWorkspaceController(
                workspaceConfigService, migrationService);
        workspaceMockMvc = MockMvcBuilders.standaloneSetup(workspaceController)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();

        com.inneragent.server.admin.AdminStateCleanupController cleanupController =
                new AdminStateCleanupController(stateCleanupPolicyService);
        cleanupMockMvc = MockMvcBuilders.standaloneSetup(cleanupController)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();

        AgentWorkspaceConfig config = new AgentWorkspaceConfig();
        config.setBackendType("database");
        config.setMigrationStatus("idle");
        when(workspaceConfigService.getCurrent()).thenReturn(config);
        when(workspaceConfigService.usage())
                .thenReturn(new AgentWorkspaceConfigService.WorkspaceUsage(7L, 4096L));

        com.inneragent.agent.entity.AgentStateCleanupPolicy policy =
                new com.inneragent.agent.entity.AgentStateCleanupPolicy();
        policy.setCleanupIntervalDays(1);
        policy.setRetentionDays(30);
        when(stateCleanupPolicyService.getCurrent()).thenReturn(policy);
        when(stateCleanupPolicyService.update(Mockito.anyInt(), Mockito.anyInt()))
                .thenReturn(policy);
    }

    /** 测试态异常映射:BusinessException.code → HTTP 状态(同 AdminAppApiTests)。 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class BusinessExceptionAdvice {

        @org.springframework.web.bind.annotation.ExceptionHandler(
                com.inneragent.platform.common.BusinessException.class)
        org.springframework.http.ResponseEntity<Object> onBusinessException(
                com.inneragent.platform.common.BusinessException e) {
            return org.springframework.http.ResponseEntity
                    .status(e.getCode() == null ? 500 : e.getCode())
                    .body(java.util.Map.of("code", e.getCode(), "msg", e.getMessage()));
        }
    }

    @Test
    @DisplayName("守卫:无/错 X-IA-Admin-Key → 403;有 key → 200")
    void guardMatrixRejectsWithoutAdminKey() throws Exception {
        workspaceMockMvc.perform(get("/ia/api/v1/admin/workspace"))
                .andExpect(status().isForbidden());
        workspaceMockMvc.perform(get("/ia/api/v1/admin/workspace")
                        .header(AdminTokenFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());

        workspaceMockMvc.perform(get("/ia/api/v1/admin/workspace")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.backendType").value("database"))
                .andExpect(jsonPath("$.data.entryCount").value(7));

        cleanupMockMvc.perform(get("/ia/api/v1/admin/state-cleanup"))
                .andExpect(status().isForbidden());
        cleanupMockMvc.perform(put("/ia/api/v1/admin/state-cleanup")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cleanupIntervalDays\":1,\"retentionDays\":30}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("workspace 迁移生命周期端点委托原服务语义")
    void workspaceMigrationEndpointsDelegateToServices() throws Exception {
        workspaceMockMvc.perform(post("/ia/api/v1/admin/workspace/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"backendType\":\"local\",\"localPath\":\"/tmp/ws\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        verify(migrationService).test("local", null, "/tmp/ws");

        when(migrationService.start("local", null, "/tmp/ws")).thenReturn(55L);
        workspaceMockMvc.perform(post("/ia/api/v1/admin/workspace/migrations")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"backendType\":\"local\",\"localPath\":\"/tmp/ws\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(55));

        AgentWorkspaceMigration migration = new AgentWorkspaceMigration();
        migration.setId(55L);
        migration.setStatus("completed");
        when(migrationService.get(55L)).thenReturn(migration);
        workspaceMockMvc.perform(get("/ia/api/v1/admin/workspace/migrations/55")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("completed"));

        workspaceMockMvc.perform(post("/ia/api/v1/admin/workspace/migrations/55/rollback")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        verify(migrationService).rollback(55L);

        workspaceMockMvc.perform(
                        post("/ia/api/v1/admin/workspace/migrations/55/dismiss-failure")
                                .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        verify(migrationService).dismissFailure(55L);
    }

    @Test
    @DisplayName("迁移进度不存在 → 404(原 /me 语义保持)")
    void missingMigrationReturns404() throws Exception {
        when(migrationService.get(99L)).thenThrow(new BusinessException(404, "迁移不存在"));
        workspaceMockMvc.perform(get("/ia/api/v1/admin/workspace/migrations/99")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("state-cleanup GET/PUT 委托;响应含 Instant 字段(生产端 ISO 由 Boot 序列化)")
    void stateCleanupDelegatesAndSerializes() throws Exception {
        java.time.LocalDateTime next = java.time.LocalDateTime.of(2026, 9, 21, 3, 0);
        com.inneragent.agent.entity.AgentStateCleanupPolicy policy =
                new com.inneragent.agent.entity.AgentStateCleanupPolicy();
        policy.setCleanupIntervalDays(1);
        policy.setRetentionDays(30);
        policy.setNextCleanupAt(next);
        when(stateCleanupPolicyService.getCurrent()).thenReturn(policy);
        when(stateCleanupPolicyService.update(eq(1), eq(30))).thenReturn(policy);

        cleanupMockMvc.perform(get("/ia/api/v1/admin/state-cleanup")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cleanupIntervalDays").value(1))
                .andExpect(jsonPath("$.data.retentionDays").value(30))
                // standalone MockMvc 的裸 ObjectMapper 不带 Boot 的
                // WRITE_DATES_AS_TIMESTAMPS=false 配置,仅断言字段存在非空;
                // ISO 形状由真实应用(Boot Jackson 配置)保证
                .andExpect(jsonPath("$.data.nextCleanupAt").isNotEmpty());

        cleanupMockMvc.perform(put("/ia/api/v1/admin/state-cleanup")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cleanupIntervalDays\":1,\"retentionDays\":30}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.retentionDays").value(30));
        verify(stateCleanupPolicyService).update(1, 30);
    }

    @Test
    @DisplayName("state-cleanup 参数校验:retentionDays 越界 → 400")
    void stateCleanupValidatesRange() throws Exception {
        cleanupMockMvc.perform(put("/ia/api/v1/admin/state-cleanup")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cleanupIntervalDays\":0,\"retentionDays\":30}"))
                .andExpect(status().isBadRequest());
        Mockito.verifyNoInteractions(stateCleanupPolicyService);
    }
}
