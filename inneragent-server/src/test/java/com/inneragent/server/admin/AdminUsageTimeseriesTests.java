package com.inneragent.server.admin;

import com.inneragent.agent.mapper.AgentFeedbackMapper;
import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.platform.usage.UsageQueryService;
import com.inneragent.platform.usage.UsageTimeseriesQuery;
import com.inneragent.platform.usage.UsageTimeseriesRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用量时序 admin API 切片测试(GET /ia/api/v1/admin/usage/timeseries):
 * day 出数与参数透传、校验 400(from/to/granularity/行数上限)、CommonResult
 * 包装与行字段快照;形态对齐 AdminUsageAndFeedbackControllerTests(IAE → 400)。
 */
class AdminUsageTimeseriesTests {

    private static final LocalDateTime FROM = LocalDateTime.of(2026, 9, 10, 0, 0);
    private static final LocalDateTime TO = LocalDateTime.of(2026, 9, 12, 0, 0);

    private UsageQueryService usageQueryService;
    private UsageQueryService realService;
    private AgentModelCallUsageMapper usageMapper;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        usageQueryService = mock(UsageQueryService.class);
        usageMapper = mock(AgentModelCallUsageMapper.class);
        realService = new UsageQueryService(usageMapper, mock(AgentFeedbackMapper.class));
        mvc = MockMvcBuilders.standaloneSetup(new AdminUsageController(usageQueryService))
                .setControllerAdvice(new Advice())
                .build();
    }

    @Test
    @DisplayName("端点:granularity=day 出数,from/to/granularity/provider/modelCode 透传")
    void dayGranularityPassesFilterThrough() throws Exception {
        when(usageQueryService.timeseries(any())).thenAnswer(invocation -> {
            UsageQueryService.TimeseriesFilter filter = invocation.getArgument(0);
            assertThat(filter).extracting(UsageQueryService.TimeseriesFilter::from,
                    UsageQueryService.TimeseriesFilter::to,
                    UsageQueryService.TimeseriesFilter::granularity,
                    UsageQueryService.TimeseriesFilter::provider,
                    UsageQueryService.TimeseriesFilter::modelCode)
                    .containsExactly(FROM, TO, "day", "openai", "deepseek-v4-flash");
            return List.of(row("2026-09-10", 3, 2, 1, 0, 150, 30, 4, 6),
                    row("2026-09-11", 2, 1, 0, 1, 37, 8, 1, 2));
        });
        mvc.perform(get("/ia/api/v1/admin/usage/timeseries")
                        .param("from", "2026-09-10T00:00:00")
                        .param("to", "2026-09-12T00:00:00")
                        .param("granularity", "day")
                        .param("provider", "openai")
                        .param("modelCode", "deepseek-v4-flash"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    @DisplayName("服务层:day 大小写不敏感收敛为 to_char 格式 YYYY-MM-DD,查询参数透传")
    void serviceMapsDayGranularityToFormat() {
        UsageTimeseriesRow expected = row("2026-09-10", 1, 1, 0, 0, 10, 1, 0, 0);
        when(usageMapper.selectUsageTimeseries(any())).thenReturn(List.of(expected));
        assertThat(realService.timeseries(
                new UsageQueryService.TimeseriesFilter(FROM, TO, "day", "openai", null)))
                .containsExactly(expected);

        ArgumentCaptor<UsageTimeseriesQuery> captor =
                ArgumentCaptor.forClass(UsageTimeseriesQuery.class);
        verify(usageMapper).selectUsageTimeseries(captor.capture());
        UsageTimeseriesQuery query = captor.getValue();
        assertThat(query.from()).isEqualTo(FROM);
        assertThat(query.to()).isEqualTo(TO);
        assertThat(query.granularityFormat()).isEqualTo("YYYY-MM-DD");
        assertThat(query.provider()).isEqualTo("openai");
        assertThat(query.modelCode()).isNull();
    }

    @Test
    @DisplayName("服务层:from≥to / 缺 from/to / 非法 granularity / 超宽窗口超行数上限 → 400 语义且不落查询")
    void serviceRejectsInvalidWindowsGranularityAndOverwideWindows() {
        List<UsageQueryService.TimeseriesFilter> invalid = List.of(
                new UsageQueryService.TimeseriesFilter(TO, FROM, "DAY", null, null),
                new UsageQueryService.TimeseriesFilter(FROM, FROM, "DAY", null, null),
                new UsageQueryService.TimeseriesFilter(null, TO, "DAY", null, null),
                new UsageQueryService.TimeseriesFilter(FROM, null, "DAY", null, null),
                new UsageQueryService.TimeseriesFilter(FROM, TO, "WEEK", null, null),
                new UsageQueryService.TimeseriesFilter(LocalDateTime.of(2026, 1, 1, 0, 0),
                        LocalDateTime.of(2126, 1, 1, 0, 0), "DAY", null, null));
        assertThat(invalid).allSatisfy(filter -> assertThatThrownBy(
                        () -> realService.timeseries(filter))
                .isInstanceOf(IllegalArgumentException.class));
        verifyNoInteractions(usageMapper);
    }

    @Test
    @DisplayName("端点:缺 from / 缺 to → 400(必填参数)")
    void endpointRequiresFromAndTo() throws Exception {
        mvc.perform(get("/ia/api/v1/admin/usage/timeseries").param("to", "2026-09-12T00:00:00"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/ia/api/v1/admin/usage/timeseries").param("from", "2026-09-10T00:00:00"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(usageQueryService);
    }

    @Test
    @DisplayName("端点:非法 granularity → 400 语义")
    void endpointMapsIllegalGranularityTo400() throws Exception {
        when(usageQueryService.timeseries(any())).thenThrow(
                new IllegalArgumentException("granularity 仅支持 DAY / MONTH: WEEK"));

        mvc.perform(get("/ia/api/v1/admin/usage/timeseries")
                        .param("from", "2026-09-10T00:00:00").param("to", "2026-09-12T00:00:00")
                        .param("granularity", "WEEK"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    @DisplayName("端点契约:CommonResult 包装 + 行字段快照(计数×4 + token SUM×4)")
    void endpointWrapsCommonResultWithRowShape() throws Exception {
        when(usageQueryService.timeseries(any()))
                .thenReturn(List.of(row("2026-09-10", 3, 2, 1, 0, 150, 30, 4, 6)));

        mvc.perform(get("/ia/api/v1/admin/usage/timeseries")
                        .param("from", "2026-09-10T00:00:00").param("to", "2026-09-12T00:00:00"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.msg").value("success"))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].statDate").value("2026-09-10"))
                .andExpect(jsonPath("$.data[0].calls").value(3))
                .andExpect(jsonPath("$.data[0].completedCalls").value(2))
                .andExpect(jsonPath("$.data[0].failedCalls").value(1))
                .andExpect(jsonPath("$.data[0].cancelledCalls").value(0))
                .andExpect(jsonPath("$.data[0].inputTokens").value(150))
                .andExpect(jsonPath("$.data[0].outputTokens").value(30))
                .andExpect(jsonPath("$.data[0].reasoningTokens").value(4))
                .andExpect(jsonPath("$.data[0].cacheTokens").value(6));
    }

    private static UsageTimeseriesRow row(String statDate, long calls, long completed, long failed,
            long cancelled, long input, long output, long reasoning, long cache) {
        return new UsageTimeseriesRow(statDate, calls, completed, failed, cancelled,
                input, output, reasoning, cache);
    }
    /** 测试态异常映射:IllegalArgumentException → 400(同 GlobalExceptionHandler)。 */
    @org.springframework.web.bind.annotation.RestControllerAdvice
    static class Advice {
        @org.springframework.web.bind.annotation.ExceptionHandler(IllegalArgumentException.class)
        org.springframework.http.ResponseEntity<Object> onIllegalArgument(IllegalArgumentException e) {
            return org.springframework.http.ResponseEntity.status(400)
                    .body(com.inneragent.platform.common.CommonResult.error(400, e.getMessage()));
        }
    }
}
