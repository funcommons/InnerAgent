package com.inneragent.admin;

import com.inneragent.model.config.ApiConfigService;
import com.inneragent.model.entity.ApiConfig;
import com.inneragent.model.provider.AiProviderService;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.server.admin.AdminModelConfigController;
import com.inneragent.server.admin.AdminModelConfigService;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.controller.vo.RemoteModelVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 模型接入配置 admin API 测试(P2-srv 收口):
 * X-IA-Admin-Key 守卫矩阵 + 响应密钥掩码(绝不回明文)+ 契约形状
 * (GET/POST /model-configs、PUT/DELETE /{id}、POST /{id}/test,对齐 web/ 脚手架)。
 * MockMvc standalone(不启 Spring 容器),服务依赖 mock 注入。
 */
class AdminModelConfigApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private ApiConfigService apiConfigService;
    private AiProviderService aiProviderService;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        apiConfigService = Mockito.mock(ApiConfigService.class);
        aiProviderService = Mockito.mock(AiProviderService.class);
        AdminModelConfigController controller =
                new AdminModelConfigController(
                        new AdminModelConfigService(apiConfigService, aiProviderService));
        // 有密钥实例:管理面启用(Advice 映射 BusinessException.code → HTTP 状态,
        // 与 AdminAppApiTests.BusinessExceptionAdvice 同模式)
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        // 未配置密钥实例:缺省封闭(全部 403)
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
        when(apiConfigService.getPage(any(), any(), any(), eq(1), eq(10)))
                .thenReturn(new PageResult<>(
                        List.of(config(11L, "sk-prod-1234567890abcdef")), 1L));
        when(apiConfigService.getById(11L)).thenReturn(config(11L, "sk-prod-1234567890abcdef"));
    }

    /** 测试态异常映射:BusinessException.code → HTTP 状态 + CommonResult 体 */
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

    private static ApiConfig config(Long id, String apiKey) {
        ApiConfig config = new ApiConfig();
        config.setId(id);
        config.setName("生产接入");
        config.setPlatform("openai_compatible");
        config.setTextProtocol("openai_chat");
        config.setApiUrl("https://api.example.com");
        config.setAutoAppendV1Path(true);
        config.setProxyUsername("proxy-user");
        config.setApiKey(apiKey);
        config.setPlatformAppId("app-1");
        config.setAppSecret("app-secret-value");
        config.setProxyPassword("proxy-pass-value");
        config.setStatus(1);
        config.setRemark("备注");
        return config;
    }

    @Test
    @DisplayName("守卫矩阵:未配置 IA_ADMIN_KEY 全部 403(缺省封闭)")
    void rejectsAllEndpointsWhenAdminKeyNotConfigured() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/model-configs"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/model-configs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("sk-new-key-123456")))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(put("/ia/api/v1/admin/model-configs/11")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(null)))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(delete("/ia/api/v1/admin/model-configs/11"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/model-configs/11/test"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("守卫矩阵:密钥缺失/错误 403,正确密钥 200")
    void guardMatrixRejectsMissingOrWrongKeyAndAcceptsValidKey() throws Exception {
        mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs"))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs")
                        .header(AdminTokenFilter.HEADER, "wrong-key"))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1));
        mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs/11")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("响应密钥掩码:apiKeyMasked 形如 sk-1••••cdef,明文字段绝不出现")
    void responsesMaskSecretsAndNeverCarryPlaintext() throws Exception {
        String body = mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.list[0].apiKeyMasked").value("sk-p••••cdef"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        // 明文密钥与写-only 秘密字段不得出现在响应任何位置
        assertThat(body).doesNotContain("sk-prod-1234567890abcdef");
        assertThat(body).doesNotContain("app-secret-value");
        assertThat(body).doesNotContain("proxy-pass-value");
        assertThat(body).contains("\"apiKeyMasked\"");
        assertThat(body).doesNotContain("\"apiKey\"");
        assertThat(body).doesNotContain("\"appSecret\"");
        assertThat(body).doesNotContain("\"proxyPassword\"");
    }

    @Test
    @DisplayName("POST 创建:透传明文密钥落库,响应只回掩码")
    void createPassesPlaintextKeyToServiceAndReturnsMaskOnly() throws Exception {
        when(apiConfigService.createApiConfig(any(ApiConfig.class))).thenAnswer(invocation -> {
            invocation.getArgument(0, ApiConfig.class).setId(12L);
            return 12L;
        });
        when(apiConfigService.getById(12L)).thenReturn(config(12L, "sk-new-key-123456"));

        String body = mockMvcWithKey.perform(post("/ia/api/v1/admin/model-configs")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("sk-new-key-123456")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(12))
                .andExpect(jsonPath("$.data.apiKeyMasked").value("sk-n••••3456"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(body).doesNotContain("sk-new-key-123456");

        org.mockito.ArgumentCaptor<ApiConfig> saved =
                org.mockito.ArgumentCaptor.forClass(ApiConfig.class);
        Mockito.verify(apiConfigService).createApiConfig(saved.capture());
        assertThat(saved.getValue().getApiKey()).isEqualTo("sk-new-key-123456");
    }

    @Test
    @DisplayName("PUT 更新:apiKey 空/缺省 = 不修改密钥(服务收到 null)")
    void updateWithBlankOrAbsentApiKeyKeepsExistingSecret() throws Exception {
        when(apiConfigService.getById(11L)).thenReturn(config(11L, "sk-prod-1234567890abcdef"));

        mockMvcWithKey.perform(put("/ia/api/v1/admin/model-configs/11")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.apiKeyMasked").value("sk-p••••cdef"));

        org.mockito.ArgumentCaptor<String> apiKey =
                org.mockito.ArgumentCaptor.forClass(String.class);
        Mockito.verify(apiConfigService).updateApiConfig(
                eq(11L), eq("生产接入"), eq("openai_compatible"), any(), any(), any(),
                any(), any(), any(), any(), any(),
                apiKey.capture(), any(), any(), any(), eq(1), any());
        assertThat(apiKey.getValue()).isNull();

        // 空串同语义:不修改
        org.mockito.Mockito.reset(apiConfigService);
        when(apiConfigService.getById(11L)).thenReturn(config(11L, "sk-prod-1234567890abcdef"));
        mockMvcWithKey.perform(put("/ia/api/v1/admin/model-configs/11")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("  ")))
                .andExpect(status().isOk());
        Mockito.verify(apiConfigService).updateApiConfig(
                eq(11L), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(),
                isNull(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("DELETE:存在 → 200 true;不存在 → 404")
    void deleteReturnsTrueOr404() throws Exception {
        mockMvcWithKey.perform(delete("/ia/api/v1/admin/model-configs/11")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        Mockito.verify(apiConfigService).deleteApiConfig(11L);

        when(apiConfigService.getById(99L)).thenReturn(null);
        mockMvcWithKey.perform(delete("/ia/api/v1/admin/model-configs/99")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("POST /{id}/test:连通成功 ok=true;失败 ok=false(均 200,错误为数据非异常)")
    void testEndpointReportsConnectivityResult() throws Exception {
        when(aiProviderService.listRemoteModels(11L)).thenReturn(List.of(
                new RemoteModelVO(), new RemoteModelVO(), new RemoteModelVO()));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/model-configs/11/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.configId").value(11))
                .andExpect(jsonPath("$.data.ok").value(true))
                .andExpect(jsonPath("$.data.responseText").value(
                        org.hamcrest.Matchers.containsString("3")));
        assertThat(mockMvcWithKey.perform(post("/ia/api/v1/admin/model-configs/11/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andReturn().getResponse().getContentAsString())
                .contains("\"durationMs\"");

        // 重打桩经 doThrow:when() 形式会先执行上一轮的抛出桩
        org.mockito.Mockito.doThrow(new BusinessException(502, "上游不可达"))
                .when(aiProviderService).listRemoteModels(11L);
        mockMvcWithKey.perform(post("/ia/api/v1/admin/model-configs/11/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andExpect(jsonPath("$.data.responseText")
                        .value(org.hamcrest.Matchers.containsString("上游不可达")));

        // 链路级 Error(依赖冲突 NoSuchMethodError)同样回 ok=false,不 500
        org.mockito.Mockito.doThrow(new NoSuchMethodError("okio.Okio.socket"))
                .when(aiProviderService).listRemoteModels(11L);
        mockMvcWithKey.perform(post("/ia/api/v1/admin/model-configs/11/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andExpect(jsonPath("$.data.responseText")
                        .value(org.hamcrest.Matchers.containsString("okio")));
    }

    @Test
    @DisplayName("GET 不存在 id → 404")
    void getMissingIdReturns404() throws Exception {
        when(apiConfigService.getById(99L)).thenReturn(null);
        mockMvcWithKey.perform(get("/ia/api/v1/admin/model-configs/99")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
    }

    private static String createBody(String apiKey) {
        String keyField = apiKey == null ? "" : "\"apiKey\": \"" + apiKey + "\",";
        return """
                {
                  %s"name": "生产接入",
                  "platform": "openai_compatible",
                  "textProtocol": "openai_chat",
                  "apiUrl": "https://api.example.com",
                  "autoAppendV1Path": true,
                  "status": 1,
                  "remark": "备注"
                }
                """.formatted(keyField.isBlank() ? "" : keyField);
    }
}
