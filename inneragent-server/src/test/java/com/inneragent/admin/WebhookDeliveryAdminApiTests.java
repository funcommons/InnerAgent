package com.inneragent.admin;

import com.inneragent.platform.webhook.WebhookDelivery;
import com.inneragent.platform.mapper.WebhookDeliveryMapper;
import com.inneragent.platform.webhook.WebhookDeliveryService;
import com.inneragent.server.admin.AdminTokenFilter;
import com.inneragent.server.admin.WebhookDeliveryAdminController;
import com.inneragent.server.admin.WebhookDeliveryAdminService;
import com.inneragent.server.admin.WebhookDeliveryAdminService.DeliveryView;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 终态 Webhook 投递记录 admin API 切片测试(任务 #18b):
 * X-IA-Admin-Key 鉴权 + 分页过滤契约(对齐 web 契约 deliveries 形)+
 * redeliver 语义(404/409/PENDING 重置)。MockMvc standalone,mapper mock。
 */
class WebhookDeliveryAdminApiTests {

    private static final String ADMIN_KEY = "test-admin-key";

    private WebhookDeliveryMapper deliveryMapper;
    private WebhookDeliveryService deliveryService;
    private MockMvc mockMvcWithKey;
    private MockMvc mockMvcWithoutKey;

    @BeforeEach
    void setUp() {
        deliveryMapper = Mockito.mock(WebhookDeliveryMapper.class);
        deliveryService = Mockito.mock(WebhookDeliveryService.class);
        WebhookDeliveryAdminController controller =
                new WebhookDeliveryAdminController(
                        new WebhookDeliveryAdminService(deliveryMapper, deliveryService));
        mockMvcWithKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(ADMIN_KEY))
                .build();
        mockMvcWithoutKey = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new BusinessExceptionAdvice())
                .addFilters(new AdminTokenFilter(""))
                .build();
    }

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

    private static WebhookDelivery delivery(long id, String status) {
        WebhookDelivery delivery = new WebhookDelivery();
        delivery.setId(id);
        delivery.setAppId(1L);
        delivery.setEventType("run.finished");
        delivery.setRunId("run-" + id);
        delivery.setUrl("https://host.example/hook");
        delivery.setPayloadJson("{\"event\":\"run.finished\",\"runId\":\"run-" + id + "\"}");
        delivery.setSignature("a".repeat(64));
        delivery.setStatus(status);
        delivery.setAttemptCount(WebhookDelivery.STATUS_PENDING.equals(status) ? 0 : 2);
        delivery.setMaxAttempts(5);
        delivery.setLastHttpStatus(status.equals("SUCCESS") ? 200 : 503);
        delivery.setLastResponse(status.equals("SUCCESS") ? null : "upstream error");
        delivery.setNextRetryAt(status.equals("FAILED")
                ? LocalDateTime.of(2026, 9, 20, 12, 5, 0) : null);
        delivery.setDeliveredAt(status.equals("SUCCESS")
                ? LocalDateTime.of(2026, 9, 20, 12, 0, 0) : null);
        delivery.setCreateTime(LocalDateTime.of(2026, 9, 20, 11, 59, 0));
        return delivery;
    }

    @Test
    @DisplayName("未配置 IA_ADMIN_KEY:查询/重投全部 403(缺省封闭)")
    void rejectsWhenAdminKeyNotConfigured() throws Exception {
        mockMvcWithoutKey.perform(get("/ia/api/v1/admin/webhook-deliveries"))
                .andExpect(status().isForbidden());
        mockMvcWithoutKey.perform(
                        post("/ia/api/v1/admin/webhook-deliveries/1/redeliver"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("分页:响应载荷对齐 web 契约 deliveries 形(list/total)")
    void pageReturnsContractShape() throws Exception {
        when(deliveryMapper.selectPage(any(), any()))
                .thenAnswer(invocation -> {
                    com.baomidou.mybatisplus.extension.plugins.pagination.Page<WebhookDelivery>
                            page = new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(
                            1, 10, 1);
                    page.setRecords(List.of(delivery(11L, WebhookDelivery.STATUS_SUCCESS)));
                    return page;
                });

        mockMvcWithKey.perform(get("/ia/api/v1/admin/webhook-deliveries")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("appId", "1")
                        .param("status", "SUCCESS")
                        .param("pageNo", "1")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.list[0].id").value(11))
                .andExpect(jsonPath("$.data.list[0].event").value("run.finished"))
                .andExpect(jsonPath("$.data.list[0].runId").value("run-11"))
                .andExpect(jsonPath("$.data.list[0].url").value("https://host.example/hook"))
                .andExpect(jsonPath("$.data.list[0].success").value(true))
                .andExpect(jsonPath("$.data.list[0].status").value("SUCCESS"))
                .andExpect(jsonPath("$.data.list[0].attempt").value(2))
                .andExpect(jsonPath("$.data.list[0].maxAttempts").value(5))
                .andExpect(jsonPath("$.data.list[0].httpStatus").value(200))
                .andExpect(jsonPath("$.data.list[0].nextRetryAt").doesNotExist())
                .andExpect(jsonPath("$.data.list[0].deliveredAt").isNotEmpty());
    }

    @Test
    @DisplayName("redeliver:EXHAUSTED 可重置;PENDING 409;缺失 404")
    void redeliverGuardsStates() throws Exception {
        // 第一次查询=重投前(EXHAUSTED),重投后再查=PENDING(attempt 归零)
        when(deliveryMapper.selectById(7L))
                .thenReturn(delivery(7L, WebhookDelivery.STATUS_EXHAUSTED))
                .thenReturn(delivery(7L, WebhookDelivery.STATUS_PENDING));
        when(deliveryService.redeliver(7L)).thenReturn(true);

        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhook-deliveries/7/redeliver")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.attempt").value(0));
        verify(deliveryService).redeliver(7L);

        when(deliveryMapper.selectById(8L))
                .thenReturn(delivery(8L, WebhookDelivery.STATUS_PENDING));
        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhook-deliveries/8/redeliver")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isConflict());

        when(deliveryMapper.selectById(9L)).thenReturn(null);
        mockMvcWithKey.perform(post("/ia/api/v1/admin/webhook-deliveries/9/redeliver")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("非法 status 过滤值 → 400")
    void rejectsInvalidStatusFilter() throws Exception {
        mockMvcWithKey.perform(get("/ia/api/v1/admin/webhook-deliveries")
                        .header(AdminTokenFilter.HEADER, ADMIN_KEY)
                        .param("status", "WHATEVER"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("视图映射:FAILED 行 success=false 且 nextRetryAt 为纪元毫秒")
    void failedRowMapsSuccessFalse() {
        WebhookDeliveryAdminService service =
                new WebhookDeliveryAdminService(deliveryMapper, deliveryService);
        DeliveryView view = service.toView(delivery(3L, WebhookDelivery.STATUS_FAILED));

        org.assertj.core.api.Assertions.assertThat(view.success()).isFalse();
        org.assertj.core.api.Assertions.assertThat(view.nextRetryAt())
                .isEqualTo(LocalDateTime.of(2026, 9, 20, 12, 5, 0)
                        .toInstant(java.time.ZoneOffset.UTC).toEpochMilli());
        org.assertj.core.api.Assertions.assertThat(view.responseSummary())
                .isEqualTo("upstream error");
        org.assertj.core.api.Assertions.assertThat(view.status())
                .isEqualTo(WebhookDelivery.STATUS_FAILED);
    }
}
