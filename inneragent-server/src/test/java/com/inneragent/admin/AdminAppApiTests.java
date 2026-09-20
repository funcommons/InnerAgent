package com.inneragent.admin;

import com.inneragent.auth.support.EmbedTokenTestSupport;
import com.inneragent.server.admin.AdminAppController;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 应用注册 admin API 切片测试(P1-T1):X-IA-Admin-Key 鉴权 + 注册落库语义。
 * MockMvc standalone(不启 Spring 容器),mapper 以 mock 注入。
 */
class AdminAppApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private AppRegistrationMapper appMapper;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        appMapper = Mockito.mock(AppRegistrationMapper.class);
        AdminAppController controller =
                new AdminAppController(new AdminAppService(appMapper));
        // 有密钥实例:管理面启用(Advice 映射 BusinessException.code → HTTP 状态,
        // 与 AiPipelineSseControllerTests.TestExceptionAdvice 同模式)
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        // 未配置密钥实例:缺省封闭(全部 403)
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
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

    private static String registerBody() {
        return """
                {
                  "appKey": "host-app",
                  "name": "宿主应用",
                  "signPublicKey": %s,
                  "webhookUrl": null,
                  "webhookSecret": null
                }
                """.formatted(jsonString(EmbedTokenTestSupport.publicKeyPem()));
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n") + "\"";
    }

    @Test
    @DisplayName("未配置 IA_ADMIN_KEY:admin API 全部 403(缺省封闭)")
    void rejectsWhenAdminKeyNotConfigured() throws Exception {
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("密钥缺失/错误:403")
    void rejectsMissingOrWrongKey() throws Exception {
        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody()))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, "wrong-key")
                        .content(registerBody()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("有密钥注册:200,appKey/公钥落库,返回 id")
    void registersAppWithValidKey() throws Exception {
        when(appMapper.insert(any(AppRegistration.class))).thenAnswer(invocation -> {
            AppRegistration app = invocation.getArgument(0);
            app.setId(9L);
            return 1;
        });

        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.appKey").value("host-app"))
                .andExpect(jsonPath("$.data.id").value(9));
    }

    @Test
    @DisplayName("appKey 重复:409")
    void duplicateAppKeyConflicts() throws Exception {
        when(appMapper.insert(any(AppRegistration.class)))
                .thenThrow(new DuplicateKeyException("uk_ia_app_key"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(409));
    }

    @Test
    @DisplayName("非法公钥 PEM:400,不落库")
    void invalidPublicKeyRejected() throws Exception {
        String body = """
                {
                  "appKey": "host-app",
                  "name": "宿主应用",
                  "signPublicKey": "not-a-valid-pem"
                }
                """;
        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body))
                .andExpect(status().isBadRequest());
        Mockito.verify(appMapper, Mockito.never()).insert(any(AppRegistration.class));
    }
}
