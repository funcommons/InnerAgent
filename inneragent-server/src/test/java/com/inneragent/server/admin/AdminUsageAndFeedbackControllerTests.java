package com.inneragent.server.admin;

import com.inneragent.agent.feedback.AgentFeedbackService;
import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.usage.UsageQueryService;
import com.inneragent.platform.usage.UsageSummaryRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 管理面用量/反馈 API 切片测试(W15):分页契约(PageResult=list+total+
 * pageNo+pageSize)、过滤参数透传、granularity 值域 400、北极星出数形。
 */
class AdminUsageAndFeedbackControllerTests {

    private UsageQueryService usageQueryService;
    private AgentFeedbackService feedbackService;
    private MockMvc usageMvc;
    private MockMvc feedbackMvc;

    @BeforeEach
    void setUp() {
        usageQueryService = Mockito.mock(UsageQueryService.class);
        feedbackService = Mockito.mock(AgentFeedbackService.class);
        usageMvc = MockMvcBuilders.standaloneSetup(new AdminUsageController(usageQueryService))
                .setControllerAdvice(new AdminUsageAndFeedbackControllerTests.Advice())
                .build();
        feedbackMvc = MockMvcBuilders.standaloneSetup(
                        new AdminFeedbackController(feedbackService))
                .setControllerAdvice(new AdminUsageAndFeedbackControllerTests.Advice())
                .build();
    }

    @Test
    @DisplayName("usage summary:分页契约 + 过滤透传 + granularity 非法 400")
    void usageSummaryPageContract() throws Exception {
        when(usageQueryService.page(any())).thenAnswer(invocation -> {
            UsageQueryService.UsageSummaryFilter filter = invocation.getArgument(0);
            // 服务层粒度值域校验的真实路径(mock 复现)
            UsageQueryService.normalizeGranularity(filter.granularity());
            assertThat(filter.userId()).isEqualTo(42L);
            return new PageResult<>(
                    List.of(new UsageSummaryRow(1L, 42L, "2026-09-21", "openai",
                            "deepseek-v4-flash", 3L, 120L, 45L, 8L, 0L)),
                    1L, 1, 10);
        });

        usageMvc.perform(get("/ia/api/v1/admin/usage/summary")
                        .param("userId", "42")
                        .param("granularity", "DAY")
                        .param("pageNo", "1")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.pageNo").value(1))
                .andExpect(jsonPath("$.data.pageSize").value(10))
                .andExpect(jsonPath("$.data.list[0].modelCode").value("deepseek-v4-flash"))
                .andExpect(jsonPath("$.data.list[0].inputTokens").value(120));

        usageMvc.perform(get("/ia/api/v1/admin/usage/summary")
                        .param("granularity", "WEEK"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("north-star:好评率与带反馈完成率代理出数形")
    void northStarShape() throws Exception {
        when(usageQueryService.northStar(any())).thenReturn(
                new UsageQueryService.NorthStarSummary(
                        null, null, 7L, 3L, 0.7d, 5L, 2L, 1L, 5d / 7));

        usageMvc.perform(get("/ia/api/v1/admin/usage/north-star"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.thumbsUp").value(7))
                .andExpect(jsonPath("$.data.thumbsDown").value(3))
                .andExpect(jsonPath("$.data.positiveRate").value(0.7))
                .andExpect(jsonPath("$.data.feedbackLinkedCompletionRate").value(5d / 7));
    }

    @Test
    @DisplayName("feedbacks 分页:过滤透传与 rating 过滤;非法 rating 400")
    void feedbackPageContract() throws Exception {
        when(feedbackService.page(any())).thenReturn(new PageResult<>(
                List.of(new AgentFeedback()), 0L, 1, 10));

        feedbackMvc.perform(get("/ia/api/v1/admin/feedbacks")
                        .param("rating", "DOWN")
                        .param("userId", "42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pageNo").value(1));

        when(feedbackService.page(any())).thenThrow(
                new BusinessException(400, "rating 仅支持 UP / DOWN"));
        feedbackMvc.perform(get("/ia/api/v1/admin/feedbacks")
                        .param("rating", "SIDE"))
                .andExpect(status().isBadRequest());

        // 无过滤参数(全默认值)同样 200 形(doReturn 重打桩:when 形会先
        // 触发上一条 thenThrow 桩)
        org.mockito.Mockito.doReturn(new PageResult<>(List.of(), 0L, 1, 10))
                .when(feedbackService).page(any());
        feedbackMvc.perform(get("/ia/api/v1/admin/feedbacks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
        verify(feedbackService, Mockito.times(3)).page(any());
    }

    /** 测试态异常映射:BusinessException/IllegalArgumentException → 400 语义。 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class Advice {

        @org.springframework.web.bind.annotation.ExceptionHandler(BusinessException.class)
        org.springframework.http.ResponseEntity<Object> onBusinessException(BusinessException e) {
            return org.springframework.http.ResponseEntity
                    .status(e.getCode() == null ? 500 : e.getCode())
                    .body(com.inneragent.platform.common.CommonResult.error(
                            e.getCode() == null ? 500 : e.getCode(), e.getMessage()));
        }

        @org.springframework.web.bind.annotation.ExceptionHandler(
                IllegalArgumentException.class)
        org.springframework.http.ResponseEntity<Object> onIllegalArgument(
                IllegalArgumentException e) {
            return org.springframework.http.ResponseEntity
                    .status(400)
                    .body(com.inneragent.platform.common.CommonResult.error(400, e.getMessage()));
        }
    }
}
