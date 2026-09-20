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
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.security.MessageDigest;
import java.security.KeyPair;
import java.util.HexFormat;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 应用注册 admin API 切片测试(P1-T1 + P2-key):
 * X-IA-Admin-Key 鉴权 + 注册落库语义 + <strong>webhookSecret 脱敏铁律</strong>
 * (响应全文无明文 secret,write-only 与 apiKey 同款)+ 公钥轮换
 * (previous/rotated_at 迁移 + signKeyFingerprint 回显)。
 * MockMvc standalone(不启 Spring 容器),mapper 以 mock 注入。
 */
class AdminAppApiTests {

    private static final String ADMIN_KEY = "test-admin-key";
    private static final String WEBHOOK_SECRET = "whsec-super-secret-123456";

    private AppRegistrationMapper appMapper;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    /** 旧公钥(模拟已在 ia_app 的当前值)与轮换新公钥(互不相同的 keypair) */
    private static final String OLD_KEY_PEM = EmbedTokenTestSupport.publicKeyPem();
    private static final String NEW_KEY_PEM =
            EmbedTokenTestSupport.toPem(EmbedTokenTestSupport.generateKeyPair().getPublic());

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

    private static String registerBody(String webhookSecret) {
        return """
                {
                  "appKey": "host-app",
                  "name": "宿主应用",
                  "signPublicKey": %s,
                  "webhookUrl": "https://host.example.com/webhook",
                  "webhookSecret": %s
                }
                """.formatted(jsonString(OLD_KEY_PEM), jsonString(webhookSecret));
    }

    private static AppRegistration persistedApp() {
        AppRegistration app = new AppRegistration();
        app.setId(9L);
        app.setAppKey("host-app");
        app.setName("宿主应用");
        app.setSignPublicKey(OLD_KEY_PEM);
        app.setWebhookUrl("https://host.example.com/webhook");
        app.setWebhookSecret(WEBHOOK_SECRET);
        app.setConversationRetentionDays(180);
        app.setStatus(1);
        return app;
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n") + "\"";
    }

    /** 与服务端同口径指纹:DER 编码 SHA-256 摘要十六进制前 16 位 */
    private static String expectedFingerprint(String pem) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(AdminAppService.parseRsaPublicKey(pem).getEncoded());
        return HexFormat.of().formatHex(digest).substring(0, 16);
    }

    @Test
    @DisplayName("未配置 IA_ADMIN_KEY:admin API 全部 403(缺省封闭)")
    void rejectsWhenAdminKeyNotConfigured() throws Exception {
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody(WEBHOOK_SECRET)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("密钥缺失/错误:403")
    void rejectsMissingOrWrongKey() throws Exception {
        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(WEBHOOK_SECRET)))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, "wrong-key")
                        .content(registerBody(WEBHOOK_SECRET)))
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
                        .content(registerBody(WEBHOOK_SECRET)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.appKey").value("host-app"))
                .andExpect(jsonPath("$.data.id").value(9))
                .andExpect(jsonPath("$.data.webhookUrl")
                        .value("https://host.example.com/webhook"));
    }

    @Test
    @DisplayName("webhookSecret 脱敏铁律:注册/列表/详情响应全文无明文 secret,仅掩码")
    void responsesNeverCarryPlaintextWebhookSecret() throws Exception {
        when(appMapper.insert(any(AppRegistration.class))).thenAnswer(invocation -> {
            AppRegistration app = invocation.getArgument(0);
            app.setId(9L);
            return 1;
        });
        when(appMapper.selectList(any())).thenReturn(List.of(persistedApp()));
        when(appMapper.selectById(9L)).thenReturn(persistedApp());

        // 注册响应
        String registerResponse = mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody(WEBHOOK_SECRET)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.webhookSecretMasked").value("whse••••3456"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(registerResponse).doesNotContain(WEBHOOK_SECRET);
        assertThat(registerResponse).doesNotContain("\"webhookSecret\"");

        // 列表与详情响应
        for (String response : List.of(
                mockMvcWithKey.perform(get("/ia/api/v1/admin/apps")
                                .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8),
                mockMvcWithKey.perform(get("/ia/api/v1/admin/apps/9")
                                .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.webhookSecretMasked").value("whse••••3456"))
                        .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))) {
            assertThat(response).doesNotContain(WEBHOOK_SECRET);
            assertThat(response).doesNotContain("\"webhookSecret\"");
        }
    }

    @Test
    @DisplayName("PUT 轮换公钥:响应含 signKeyFingerprint(16 hex)与 signKeyRotatedAt,"
            + "旧值移入 previous、rotated_at=now")
    void updateRotatesSignKeyAndReturnsFingerprint() throws Exception {
        when(appMapper.selectById(9L)).thenReturn(persistedApp());

        String body = """
                { "signPublicKey": %s }
                """.formatted(jsonString(NEW_KEY_PEM));
        String response = mockMvcWithKey.perform(put("/ia/api/v1/admin/apps/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.signKeyFingerprint")
                        .value(expectedFingerprint(NEW_KEY_PEM)))
                .andExpect(jsonPath("$.data.signKeyRotatedAt").isNotEmpty())
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(response).doesNotContain(expectedFingerprint(OLD_KEY_PEM));

        ArgumentCaptor<AppRegistration> saved = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(saved.capture());
        AppRegistration app = saved.getValue();
        assertThat(app.getSignPublicKey()).isEqualTo(NEW_KEY_PEM);
        // 旧值移入 previous,轮换时刻落库(再次轮换时覆盖 previous)
        assertThat(app.getPreviousSignPublicKey()).isEqualTo(OLD_KEY_PEM);
        assertThat(app.getSignKeyRotatedAt()).isNotNull();
    }

    @Test
    @DisplayName("PUT 同值公钥:不算轮换(previous/rotated_at 不动)")
    void updateWithSameSignKeyDoesNotRotate() throws Exception {
        // 从未轮换的应用(current=OLD,previous/rotated_at 均 NULL)重复 PUT 同值公钥
        when(appMapper.selectById(9L)).thenReturn(persistedApp());

        String body = """
                { "signPublicKey": %s }
                """.formatted(jsonString(OLD_KEY_PEM));
        mockMvcWithKey.perform(put("/ia/api/v1/admin/apps/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(body))
                .andExpect(status().isOk());

        ArgumentCaptor<AppRegistration> saved = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(saved.capture());
        assertThat(saved.getValue().getSignPublicKey()).isEqualTo(OLD_KEY_PEM);
        assertThat(saved.getValue().getPreviousSignPublicKey()).isNull();
        assertThat(saved.getValue().getSignKeyRotatedAt()).isNull();
    }

    @Test
    @DisplayName("PUT webhookSecret write-only:非空覆写、空/缺省不修改;响应不回明文")
    void updateWebhookSecretIsWriteOnly() throws Exception {
        // 非空 → 覆写,响应只回掩码
        when(appMapper.selectById(9L)).thenReturn(persistedApp());
        String newSecret = "whsec-brand-new-654321";
        String response = mockMvcWithKey.perform(put("/ia/api/v1/admin/apps/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("""
                                { "webhookSecret": "%s" }
                                """.formatted(newSecret)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.webhookSecretMasked").value("whse••••4321"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(response).doesNotContain(newSecret);
        ArgumentCaptor<AppRegistration> overwritten = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(overwritten.capture());
        assertThat(overwritten.getValue().getWebhookSecret()).isEqualTo(newSecret);

        // 空/缺省 → 不修改(与 apiKey write-only 同款)
        Mockito.reset(appMapper);
        when(appMapper.selectById(9L)).thenReturn(persistedApp());
        mockMvcWithKey.perform(put("/ia/api/v1/admin/apps/9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content("{ \"name\": \"改名后的应用\" }"))
                .andExpect(status().isOk());
        ArgumentCaptor<AppRegistration> kept = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(kept.capture());
        assertThat(kept.getValue().getWebhookSecret()).isEqualTo(WEBHOOK_SECRET);
        assertThat(kept.getValue().getName()).isEqualTo("改名后的应用");
    }

    @Test
    @DisplayName("appKey 重复:409")
    void duplicateAppKeyConflicts() throws Exception {
        when(appMapper.insert(any(AppRegistration.class)))
                .thenThrow(new DuplicateKeyException("uk_ia_app_key"));

        mockMvcWithKey.perform(post("/ia/api/v1/admin/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .content(registerBody(WEBHOOK_SECRET)))
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

    @Test
    @DisplayName("未注册公钥的应用指纹为 null(signPublicKey 为空时)")
    void fingerprintNullWhenNoKey() {
        AppRegistration app = persistedApp();
        app.setSignPublicKey(null);
        assertThat(AdminAppService.toView(app).signKeyFingerprint()).isNull();
        assertThat(AdminAppService.toView(app).signKeyRotatedAt()).isNull();
    }
}
