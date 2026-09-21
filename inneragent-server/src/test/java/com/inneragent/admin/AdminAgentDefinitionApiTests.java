package com.inneragent.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.admin.AdminAgentDefinitionController;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AgentDefinitionAdminService;
import com.inneragent.server.admin.AgentDefinitionAdminService.DefinitionView;
import com.inneragent.server.admin.AgentDefinitionBundle;
import com.inneragent.server.admin.AgentDefinitionBundle.ImportResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Agent 定义管理 admin API 切片测试(P2-W5):双轨守卫矩阵、分页列表
 * PageResult 形、详情形状(prompts/spec)、PUT prompt 契约、导出 bundle 形、
 * 导入请求契约(conflictPolicy/dryRun)与非法 conflictPolicy 400。
 * MockMvc standalone,服务 mock。
 */
class AdminAgentDefinitionApiTests {

    private static final String ADMIN_KEY = "test-admin-key";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AgentDefinitionAdminService definitionService;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        definitionService = Mockito.mock(AgentDefinitionAdminService.class);
        AdminAgentDefinitionController controller =
                new AdminAgentDefinitionController(definitionService);
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AdminAppApiTests.BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
    }

    private static DefinitionView view(long id, String agentType) {
        return new DefinitionView(id, 1L, agentType, "main", "名称", true,
                new DefinitionView.PromptsView("系统提示词", null, null),
                specNode(), null);
    }

    private static com.fasterxml.jackson.databind.JsonNode specNode() {
        try {
            return MAPPER.readTree("""
                    {"kind":"main","enabled":true,"modelId":null,
                     "toolWhitelist":["get_current_time"],
                     "subAgentTools":null,"contextTemplate":null}
                    """);
        } catch (Exception parseFailure) {
            throw new IllegalStateException(parseFailure);
        }
    }

    @Test
    @DisplayName("守卫矩阵:无 key 403(双轨守卫与既有 admin 端点一致)")
    void guardMatrix() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/definitions"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(put("/ia/api/v1/admin/definitions/1/prompt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"systemPrompt\",\"content\":\"x\"}"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/definitions/export"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/definitions/import")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("GET 列表:PageResult 形(list/total/pageNo/pageSize,同 audit-logs)")
    void listReturnsPageResultShape() throws Exception {
        PageResult<DefinitionView> page = new PageResult<>(List.of(view(7L, "demo")), 1L);
        page.setPageNo(1);
        page.setPageSize(10);
        when(definitionService.page(1L, 1, 10)).thenReturn(page);

        mockMvcWithKey.perform(get("/ia/api/v1/admin/definitions")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.pageNo").value(1))
                .andExpect(jsonPath("$.data.pageSize").value(10))
                .andExpect(jsonPath("$.data.list[0].agentType").value("demo"))
                .andExpect(jsonPath("$.data.list[0].prompts.systemPrompt").value("系统提示词"))
                .andExpect(jsonPath("$.data.list[0].spec.toolWhitelist[0]")
                        .value("get_current_time"));
    }

    @Test
    @DisplayName("GET 详情:id 定位,prompts 三槽 + spec 对象")
    void getDetailShape() throws Exception {
        when(definitionService.get(7L)).thenReturn(view(7L, "demo"));

        mockMvcWithKey.perform(get("/ia/api/v1/admin/definitions/7")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(7))
                .andExpect(jsonPath("$.data.kind").value("main"))
                .andExpect(jsonPath("$.data.prompts.systemPrompt").value("系统提示词"))
                .andExpect(jsonPath("$.data.prompts.instructionTemplate")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.spec.kind").value("main"));
    }

    @Test
    @DisplayName("PUT prompt:slot/content 透传;404 透出")
    void putPromptContract() throws Exception {
        when(definitionService.updatePrompt(7L, "systemPrompt", "新提示词"))
                .thenReturn(view(7L, "demo"));
        when(definitionService.updatePrompt(eq(404L), any(), any()))
                .thenThrow(new com.inneragent.platform.common.BusinessException(404, "Agent 定义不存在: 404"));

        mockMvcWithKey.perform(put("/ia/api/v1/admin/definitions/7/prompt")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"systemPrompt\",\"content\":\"新提示词\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.prompts.systemPrompt").value("系统提示词"));

        mockMvcWithKey.perform(put("/ia/api/v1/admin/definitions/404/prompt")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"systemPrompt\",\"content\":\"x\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("POST export:body 缺省=全量;ids 过滤透传;bundle 形(schemaVersion/exportedAt/definitions)")
    void exportContract() throws Exception {
        when(definitionService.export(1L, null)).thenReturn(new AgentDefinitionBundle.Bundle(
                AgentDefinitionBundle.SCHEMA_VERSION, "2026-09-21T00:00:00Z",
                List.of(new AgentDefinitionBundle.DefinitionEntry(7L, "demo", "名称",
                        specNode(), List.of(new AgentDefinitionBundle.PromptEntry(
                                "systemPrompt", "系统提示词"))))));
        when(definitionService.export(eq(1L), eq(List.of(7L, 9L))))
                .thenReturn(new AgentDefinitionBundle.Bundle(
                        AgentDefinitionBundle.SCHEMA_VERSION, "2026-09-21T00:00:00Z", List.of()));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/definitions/export")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.schemaVersion").value(1))
                .andExpect(jsonPath("$.data.exportedAt").isNotEmpty())
                .andExpect(jsonPath("$.data.definitions[0].definitionId").value(7))
                .andExpect(jsonPath("$.data.definitions[0].agentType").value("demo"))
                .andExpect(jsonPath("$.data.definitions[0].name").value("名称"))
                .andExpect(jsonPath("$.data.definitions[0].specJson.kind").value("main"))
                .andExpect(jsonPath("$.data.definitions[0].prompts[0].slot")
                        .value("systemPrompt"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/definitions/export")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[7,9]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.definitions.length()").value(0));

        verify(definitionService).export(1L, List.of(7L, 9L));
    }

    @Test
    @DisplayName("POST import:bundle/conflictPolicy/dryRun 透传;结果 {created,updated,skipped,errors[]};非法策略 400")
    void importContract() throws Exception {
        ImportResult result =
                new ImportResult(true, 2, 1, 1, List.of(
                        new AgentDefinitionBundle.ImportError("bad", "agentType 不能为空")));
        when(definitionService.importBundle(eq(1L), any(), eq("overwrite"), eq(true)))
                .thenReturn(result);
        when(definitionService.importBundle(eq(1L), any(), eq("upsert"), anyBoolean()))
                .thenThrow(new com.inneragent.platform.common.BusinessException(
                        400, "conflictPolicy 仅支持 skip/overwrite: upsert"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/definitions/import")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bundle": {"schemaVersion": 1, "definitions": []},
                                 "conflictPolicy": "overwrite", "dryRun": true}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.dryRun").value(true))
                .andExpect(jsonPath("$.data.created").value(2))
                .andExpect(jsonPath("$.data.updated").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].agentType").value("bad"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/definitions/import")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bundle": {"schemaVersion": 1, "definitions": []},
                                 "conflictPolicy": "upsert"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("conflictPolicy")));
    }

    @Test
    @DisplayName("导入缺 bundle 字段 → 400(缺参校验由服务层 bundle 级校验兜底)")
    void importMissingBundleIsBadRequest() throws Exception {
        when(definitionService.importBundle(eq(1L), isNull(), any(), anyBoolean()))
                .thenThrow(new com.inneragent.platform.common.BusinessException(400, "bundle 不能为空"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/definitions/import")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"conflictPolicy\":\"skip\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("bundle 不能为空")));
    }
}
