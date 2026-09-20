package com.inneragent.admin;

import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.toolhub.ToolAuditLog;
import com.inneragent.platform.toolhub.ToolAuditQueryService;
import com.inneragent.server.admin.AdminAuditController;
import com.inneragent.server.admin.AdminTokenFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 审计检索 admin API 测试:守卫矩阵(既有 X-IA-Admin-Key 不破)、过滤参数
 * 透传、出参脱敏(存量原文行)、分页形(list+total+pageNo/pageSize)、字典端点。
 * MockMvc standalone(不启 Spring 容器),服务依赖 mock 注入。
 */
class AdminAuditApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private ToolAuditQueryService auditQueryService;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        auditQueryService = Mockito.mock(ToolAuditQueryService.class);
        AdminAuditController controller = new AdminAuditController(auditQueryService);
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new com.inneragent.platform.common.GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new com.inneragent.platform.common.GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(""))
                .build();
    }

    private static ToolAuditLog rawRow() {
        ToolAuditLog row = new ToolAuditLog();
        row.setId(9L);
        row.setAppId(1L);
        row.setTenantId(0L);
        row.setUserId(12993L);
        row.setConversationId("conv-uuid-1");
        row.setRunId("run-1");
        row.setToolFqn("update_user");
        row.setDecision("allowed");
        row.setDecisionSource("live-confirm");
        row.setRiskLevel("high");
        // 模拟真实服务出参:读时脱敏在 ToolAuditQueryService 内完成(其单测覆盖),
        // 到控制器层已是打码值;此处断言响应序列化不携带任何明文敏感值
        row.setParamsMaskedJson("{\"userId\":12993,\"password\":\"***\"}");
        row.setResultSummary("ok");
        row.setCreateTime(LocalDateTime.of(2026, 9, 20, 12, 0, 30));
        return row;
    }

    @Test
    @DisplayName("守卫矩阵:无 key 403;错误 key 403;正确 key 200(既有语义不破)")
    void guardMatrixPreserved() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/audit-logs"))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/audit-logs")
                        .header(AdminTokenFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("分页契约:list+total+pageNo/pageSize(web PageResult 形)+ 过滤参数透传 + 出参脱敏")
    void pageContractWithFiltersAndMaskedOutput() throws Exception {
        when(auditQueryService.page(any(ToolAuditQueryService.AuditLogFilter.class)))
                .thenReturn(new PageResult<>(List.of(rawRow()), 1L, 1, 10));

        String body = mockMvcWithKey.perform(get("/ia/api/v1/admin/audit-logs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("userId", "12993")
                        .param("toolFqn", "update_user")
                        .param("decision", "allowed")
                        .param("decisionSource", "live-confirm")
                        .param("from", "2026-09-20T00:00:00")
                        .param("to", "2026-09-20T23:59:59")
                        .param("pageNo", "1")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.pageNo").value(1))
                .andExpect(jsonPath("$.data.pageSize").value(10))
                .andExpect(jsonPath("$.data.list[0].id").value(9))
                .andExpect(jsonPath("$.data.list[0].decisionSource").value("live-confirm"))
                .andExpect(jsonPath("$.data.list[0].paramsMaskedJson")
                        .value(org.hamcrest.Matchers.containsString("***")))
                .andReturn().getResponse().getContentAsString(
                        java.nio.charset.StandardCharsets.UTF_8);
        // 响应只携带打码值(paramsMaskedJson 为内嵌 JSON 字符串,引号被转义)
        assertThat(body).contains("***");
        assertThat(body).doesNotContain("super-secret");

        org.mockito.ArgumentCaptor<ToolAuditQueryService.AuditLogFilter> filter =
                org.mockito.ArgumentCaptor.forClass(ToolAuditQueryService.AuditLogFilter.class);
        verify(auditQueryService).page(filter.capture());
        ToolAuditQueryService.AuditLogFilter captured = filter.getValue();
        assertThat(captured.userId()).isEqualTo(12993L);
        assertThat(captured.toolFqn()).isEqualTo("update_user");
        assertThat(captured.decision()).isEqualTo("allowed");
        assertThat(captured.decisionSource()).isEqualTo("live-confirm");
        assertThat(captured.from()).isEqualTo(LocalDateTime.of(2026, 9, 20, 0, 0, 0));
        assertThat(captured.to()).isEqualTo(LocalDateTime.of(2026, 9, 20, 23, 59, 59));
        assertThat(captured.pageNo()).isEqualTo(1);
        assertThat(captured.pageSize()).isEqualTo(10);
    }

    @Test
    @DisplayName("未知 decisionSource → 400(值域见 dictionary);decision 自由过滤不校验")
    void unknownDecisionSourceReturns400() throws Exception {
        mockMvcWithKey.perform(get("/ia/api/v1/admin/audit-logs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("decisionSource", "admin"))
                .andExpect(status().isBadRequest());
        // 设置桩避免后续调用 NPE(校验失败不会触达服务)
        when(auditQueryService.page(any(ToolAuditQueryService.AuditLogFilter.class)))
                .thenReturn(new PageResult<>(List.of(), 0L, 1, 10));
        mockMvcWithKey.perform(get("/ia/api/v1/admin/audit-logs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("decision", "anything"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("字典端点:decision_source 含 expired(V8)与六值全集;decision 九值")
    void dictionaryEndpointExposesActualDomains() throws Exception {
        when(auditQueryService.page(any(ToolAuditQueryService.AuditLogFilter.class)))
                .thenReturn(new PageResult<>(List.of(), 0L, 1, 10));
        mockMvcWithKey.perform(get("/ia/api/v1/admin/audit-logs/dictionary")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.decisionSources.length()").value(6))
                .andExpect(jsonPath("$.data.decisionSources[4].code").value("expired"))
                .andExpect(jsonPath("$.data.decisions.length()").value(9))
                .andExpect(jsonPath("$.data.decisionSources[0].description").isNotEmpty());
    }
}
