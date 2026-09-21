package com.inneragent.admin;

import com.inneragent.platform.common.GlobalExceptionHandler;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.AdminWebhookConfigController;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.admin.WebhookConfigAdminService;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import org.junit.jupiter.api.BeforeAll;
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

    @BeforeAll
    static void initLambdaColumnCache() {
        // 定向 UPDATE 的 sqlSet 片段断言需 MP 列缓存(Spring 装配下由 mapper
        // 初始化,切片测试手动补 TableInfo,口径同 CircuitBreakerAdminServiceTests)
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(
                        new com.baomidou.mybatisplus.core.MybatisConfiguration(), ""),
                AppRegistration.class);
    }

    @BeforeEach
    void setUp() {
        appMapper = mock(AppRegistrationMapper.class);
        // 定向 UPDATE 缺省命中 1 行(0 行→404 语义在 save 内,单测不模拟并发删除)
        when(appMapper.update(org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.any())).thenReturn(1);
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
    @DisplayName("PUT 保存:定向 SET(url/enabled/events 落列);secret 空白不进 SET;"
            + "响应回读掩码")
    void savePersistsAndMasksSecret() throws Exception {
        AppRegistration saved = app();
        saved.setWebhookUrl("https://new.example/cb");
        saved.setWebhookEnabled(false);
        saved.setWebhookEvents("run.finished,run.failed");
        when(appMapper.selectById(1L)).thenReturn(app(), saved);

        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"https://new.example/cb\",\"secret\":\"\","
                                + "\"enabled\":false,\"events\":[\"run.finished\",\"run.failed\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value("https://new.example/cb"))
                .andExpect(jsonPath("$.data.enabled").value(false))
                .andExpect(jsonPath("$.data.events.length()").value(2));

        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.Wrapper<AppRegistration>> captor =
                ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.Wrapper.class);
        verify(appMapper).update(org.mockito.ArgumentMatchers.isNull(), captor.capture());
        @SuppressWarnings("unchecked")
        com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration> wrapper =
                (com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration>)
                        captor.getValue();
        String sqlSet = wrapper.getSqlSet();
        assertThat(sqlSet).contains("webhook_url").contains("webhook_enabled")
                .contains("webhook_events").contains("update_time")
                .doesNotContain("webhook_secret");

        // secret 非空 = 重置(进 SET)
        Mockito.clearInvocations(appMapper);
        when(appMapper.selectById(1L)).thenReturn(app(), saved);
        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"secret\":\"whsec-new\"}"))
                .andExpect(status().isOk());
        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.Wrapper<AppRegistration>> rotate =
                ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.Wrapper.class);
        verify(appMapper).update(org.mockito.ArgumentMatchers.isNull(), rotate.capture());
        @SuppressWarnings("unchecked")
        com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration> rotateWrapper =
                (com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration>)
                        rotate.getValue();
        assertThat(rotateWrapper.getSqlSet()).contains("webhook_secret");
    }

    @Test
    @DisplayName("PUT 保存:空串 url 显式 SET webhook_url=NULL(OBS-R4-1 清空语义落库)")
    void saveClearsUrlWithExplicitSetNull() throws Exception {
        AppRegistration cleared = app();
        cleared.setWebhookUrl(null);
        when(appMapper.selectById(1L)).thenReturn(app(), cleared);

        mockMvcWithKey.perform(put("/ia/api/v1/admin/webhooks/config")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url")
                        .value(org.hamcrest.Matchers.nullValue()));

        ArgumentCaptor<com.baomidou.mybatisplus.core.conditions.Wrapper<AppRegistration>> captor =
                ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.Wrapper.class);
        verify(appMapper).update(org.mockito.ArgumentMatchers.isNull(), captor.capture());
        @SuppressWarnings("unchecked")
        com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration> wrapper =
                (com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AppRegistration>)
                        captor.getValue();
        // sqlSegment 断言:webhook_url 在 SET 子句且绑定值为 null(显式 SET NULL)
        assertThat(wrapper.getSqlSet()).contains("webhook_url");
        assertThat(wrapper.getParamNameValuePairs()).containsValue(null);
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

        // 预留值域 run.resource-limit 可订阅(响应回读库行,与定向 SET 后状态一致)
        Mockito.clearInvocations(appMapper);
        AppRegistration subscribed = app();
        subscribed.setWebhookEvents("run.resource-limit");
        when(appMapper.selectById(1L)).thenReturn(app(), subscribed);
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
