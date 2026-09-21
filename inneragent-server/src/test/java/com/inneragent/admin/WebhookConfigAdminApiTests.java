package com.inneragent.admin;

import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AdminWebhookConfigController;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.admin.WebhookConfigAdminService;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Webhook 配置 admin API 切片测试(优化建议 #2 服务端半):mock 契约形状
 * (WebhookConfig/SaveReq/test 响应)、secret write-only 掩码、订阅事件值域
 * 校验、连通性测试真实外呼语义(替身发送端)。mapper/发送端 mock。
 */
class WebhookConfigAdminApiTests {

    private static final String ADMIN_KEY = "test-admin-key";
    private static final String SECRET = "whsec-demo-secret-9f2e";

    private AppRegistrationMapper appMapper;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;
    private WebhookConfigAdminService service;
    private RecordingSender sender;

    @BeforeEach
    void setUp() {
        appMapper = mock(AppRegistrationMapper.class);
        service = new WebhookConfigAdminService(appMapper, new com.inneragent.platform.webhook.WebhookDeliveryProperties());
        sender = new RecordingSender();
        service.setSenderForTest(sender);
        AdminWebhookConfigController controller = new AdminWebhookConfigController(service);
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new AdminTokenFilter(""))
                .build();
    }

    private static AppRegistration app() {
        AppRegistration app = new AppRegistration();
        app.setId(1L);
        app.setAppKey("default");
        app.setName("默认应用");
        app.setWebhookUrl("https://host.example/hook");
        app.setWebhookSecret(SECRET);
        app.setWebhookEnabled(true);
        app.setWebhookEvents("run.finished,run.failed,run.cancelled");
        return app;
    }

    @Test
    @DisplayName("守卫矩阵:无 key/错误 key 403(双轨守卫与既有 admin 端点一致)")
    void guardMatrixPreserved() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/webhooks/config"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(post("/ia/api/v1/admin/webhooks/config/test"))
                .andExpect(status().isForbidden());
        mockMvcWithKey.perform(get("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("GET 配置:mock 契约 WebhookConfig 形,secret 仅掩码")
    void getConfigContractShape() throws Exception {
        when(appMapper.selectById(1L)).thenReturn(app());

        mockMvcWithKey.perform(get("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.appId").value(1))
                .andExpect(jsonPath("$.data.url").value("https://host.example/hook"))
                .andExpect(jsonPath("$.data.secretMasked").isNotEmpty())
                .andExpect(jsonPath("$.data.secretMasked").value(
                        org.hamcrest.Matchers.not(SECRET)))
                .andExpect(jsonPath("$.data.enabled").value(true))
                .andExpect(jsonPath("$.data.events.length()").value(3))
                .andExpect(jsonPath("$.data.events[0]").value("run.finished"));
    }

    @Test
    @DisplayName("PUT 保存:url/启用/事件落库;secret 非空重置、空白不改;响应掩码")
    void savePersistsAndMasksSecret() throws Exception {
        when(appMapper.selectById(1L)).thenReturn(app());

        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"https://new.example/cb\",\"secret\":\"\","
                                + "\"enabled\":false,\"events\":[\"run.finished\",\"run.failed\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value("https://new.example/cb"))
                .andExpect(jsonPath("$.data.enabled").value(false))
                .andExpect(jsonPath("$.data.events.length()").value(2));

        ArgumentCaptor<AppRegistration> captor = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(captor.capture());
        AppRegistration saved = captor.getValue();
        assertThat(saved.getWebhookUrl()).isEqualTo("https://new.example/cb");
        // secret 空白 = 不修改(write-only 铁律)
        assertThat(saved.getWebhookSecret()).isEqualTo(SECRET);
        assertThat(saved.getWebhookEnabled()).isFalse();
        assertThat(saved.getWebhookEvents()).isEqualTo("run.finished,run.failed");

        // secret 非空 = 重置
        Mockito.clearInvocations(appMapper);
        when(appMapper.selectById(1L)).thenReturn(app());
        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"secret\":\"whsec-new\"}"))
                .andExpect(status().isOk());
        ArgumentCaptor<AppRegistration> rotate = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(rotate.capture());
        assertThat(rotate.getValue().getWebhookSecret()).isEqualTo("whsec-new");
    }

    @Test
    @DisplayName("PUT 保存:非法订阅事件 400(值域 run.finished/failed/cancelled/resource-limit)")
    void saveRejectsUnknownEvent() throws Exception {
        when(appMapper.selectById(1L)).thenReturn(app());

        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"events\":[\"run.exploded\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("run.exploded")));

        // 预留值域 run.resource-limit 可订阅
        Mockito.clearInvocations(appMapper);
        when(appMapper.selectById(1L)).thenReturn(app());
        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"events\":[\"run.resource-limit\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.events[0]").value("run.resource-limit"));
    }

    @Test
    @DisplayName("测试:未配置 url 400;2xx → ok+signatureValid;非 2xx → ok=false 携状态码")
    void testEndpointSemantics() throws Exception {
        when(appMapper.selectById(1L)).thenReturn(app());
        sender.next = new WebhookConfigAdminService.WebhookHttpSender.Result(200, "OK");

        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhooks/config/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(true))
                .andExpect(jsonPath("$.data.signatureValid").value(true))
                .andExpect(jsonPath("$.data.httpStatus").value(200));

        // 宿主 5xx:ok=false + httpStatus 透出(mock 契约的 {ok, signatureValid} + 扩展)
        sender.next = new WebhookConfigAdminService.WebhookHttpSender.Result(503, "unavailable");
        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhooks/config/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andExpect(jsonPath("$.data.httpStatus").value(503));
    }

    @Test
    @DisplayName("测试:无 secret → signatureValid=false 且不携带签名头;传输失败 → ok=false+error")
    void testEndpointWithoutSecretAndOnTransportFailure() throws Exception {
        AppRegistration noSecret = app();
        noSecret.setWebhookSecret(null);
        when(appMapper.selectById(1L)).thenReturn(noSecret);
        sender.next = new WebhookConfigAdminService.WebhookHttpSender.Result(200, "OK");

        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhooks/config/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(true))
                .andExpect(jsonPath("$.data.signatureValid").value(false));
        assertThat(sender.lastHeaders).doesNotContainKey("X-IA-Signature");

        sender.failure = new IllegalStateException("connect refused");
        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhooks/config/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andExpect(jsonPath("$.data.error").value(
                        org.hamcrest.Matchers.containsString("connect refused")));
    }

    @Test
    @DisplayName("测试:url 未配置 → 400 使用指引文案")
    void testRequiresConfiguredUrl() throws Exception {
        AppRegistration noUrl = app();
        noUrl.setWebhookUrl(null);
        when(appMapper.selectById(1L)).thenReturn(noUrl);

        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhooks/config/test")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("尚未配置 Webhook 回调地址")));
    }

    /** 记录型替身发送端:返回预设结果或抛预设异常,捕获请求头供断言。 */
    private static final class RecordingSender implements WebhookConfigAdminService.WebhookHttpSender {
        Result next;
        RuntimeException failure;
        HttpHeaders lastHeaders;

        @Override
        public Result send(String url, HttpHeaders headers, String body) {
            this.lastHeaders = headers;
            if (failure != null) {
                throw failure;
            }
            return next;
        }
    }
}
