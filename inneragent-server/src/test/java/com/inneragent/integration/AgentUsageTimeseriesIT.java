package com.inneragent.integration;

import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.platform.usage.UsageTimeseriesQuery;
import com.inneragent.platform.usage.UsageTimeseriesRow;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用量时序聚合 IT(真实 PostgreSQL,形态对齐 AgentUsageStatisticsIT):底层
 * {@code selectUsageTimeseries}。归桶同 to_char(started_at) 惯例(不做时区
 * 换算);边界同 selectUsageSummary(from 含/to 不含);各用例落不同月份,互不污染。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AgentUsageTimeseriesIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine").withDatabaseName("inneragent")
            .withUsername("inneragent").withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private AgentModelCallUsageMapper usageMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private static final LocalDateTime TS_BASE = LocalDateTime.of(2026, 9, 10, 8, 0);

    @Test
    @DisplayName("多天 → 每天一桶:计数与 token SUM 正确;STARTED 行不计")
    void bucketsByDayWithCountsAndTokenSums() {
        insertRun("run-ts-1", 601L);
        insertRun("run-ts-2", 602L);
        // 9-10:两条 COMPLETED(含 23:59:59 仍在当日桶)+ 一条 FAILED
        insertUsage("run-ts-1", "c-ts-1", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 9, 10, 8, 0), 100L, 20L, 0L, 0L);
        insertUsage("run-ts-1", "c-ts-2", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 9, 10, 23, 59, 59), 50L, 10L, 4L, 6L);
        insertUsage("run-ts-1", "c-ts-3", "openai", "deepseek-v4-flash", "FAILED",
                LocalDateTime.of(2026, 9, 10, 12, 0), null, null, null, null);
        // 9-11:00:00:01 已是次日桶;CANCELLED 计次计 token;STARTED 不计
        insertUsage("run-ts-2", "c-ts-4", "qwen", "qwen3.7-plus", "COMPLETED",
                LocalDateTime.of(2026, 9, 11, 0, 0, 1), 7L, 3L, 1L, 2L);
        insertUsage("run-ts-2", "c-ts-5", "openai", "deepseek-v4-flash", "CANCELLED",
                LocalDateTime.of(2026, 9, 11, 15, 0), 30L, 5L, null, null);
        insertUsage("run-ts-2", "c-ts-6", "openai", "deepseek-v4-flash", "STARTED",
                LocalDateTime.of(2026, 9, 11, 16, 0), null, null, null, null);
        Map<String, UsageTimeseriesRow> buckets = byDay(query(
                LocalDateTime.of(2026, 9, 10, 0, 0), LocalDateTime.of(2026, 9, 12, 0, 0),
                null, null));
        assertThat(buckets.keySet()).containsExactlyInAnyOrder("2026-09-10", "2026-09-11");
        assertThat(buckets.get("2026-09-10")).extracting(
                UsageTimeseriesRow::getCalls, UsageTimeseriesRow::getCompletedCalls,
                UsageTimeseriesRow::getFailedCalls, UsageTimeseriesRow::getCancelledCalls,
                UsageTimeseriesRow::getInputTokens, UsageTimeseriesRow::getOutputTokens,
                UsageTimeseriesRow::getReasoningTokens, UsageTimeseriesRow::getCacheTokens)
                .containsExactly(3L, 2L, 1L, 0L, 150L, 30L, 4L, 6L);
        assertThat(buckets.get("2026-09-11")).extracting(
                UsageTimeseriesRow::getCalls, UsageTimeseriesRow::getCompletedCalls,
                UsageTimeseriesRow::getFailedCalls, UsageTimeseriesRow::getCancelledCalls,
                UsageTimeseriesRow::getInputTokens, UsageTimeseriesRow::getOutputTokens,
                UsageTimeseriesRow::getReasoningTokens, UsageTimeseriesRow::getCacheTokens)
                .containsExactly(2L, 1L, 0L, 1L, 37L, 8L, 1L, 2L);
    }

    @Test
    @DisplayName("provider/modelCode 过滤生效;无过滤出全量")
    void providerAndModelCodeFilters() {
        insertRun("run-ts-f1", 611L);
        insertUsage("run-ts-f1", "c-tsf-1", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 10, 5, 9, 0), 10L, 1L, null, null);
        insertUsage("run-ts-f1", "c-tsf-2", "qwen", "qwen3.7-plus", "COMPLETED",
                LocalDateTime.of(2026, 10, 5, 10, 0), 20L, 2L, null, null);
        insertUsage("run-ts-f1", "c-tsf-3", "openai", "deepseek-v4-flash", "FAILED",
                LocalDateTime.of(2026, 10, 6, 9, 0), null, null, null, null);

        LocalDateTime from = LocalDateTime.of(2026, 10, 5, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 10, 7, 0, 0);
        assertThat(byDay(query(from, to, null, null)).values())
                .extracting(UsageTimeseriesRow::getCalls).containsExactlyInAnyOrder(2L, 1L);
        Map<String, UsageTimeseriesRow> openai = byDay(query(from, to, "openai", null));
        assertThat(openai.get("2026-10-05").getCalls()).isEqualTo(1L);
        assertThat(openai.get("2026-10-05").getInputTokens()).isEqualTo(10L);
        assertThat(openai.get("2026-10-06").getCalls()).isEqualTo(1L);
        Map<String, UsageTimeseriesRow> qwen = byDay(query(from, to, null, "qwen3.7-plus"));
        assertThat(qwen.get("2026-10-05").getCalls()).isEqualTo(1L);
    }

    @Test
    @DisplayName("边界口径同 selectUsageSummary:from 含(等值命中),to 不含(等值排除)")
    void windowBoundariesMatchSummarySemantics() {
        insertRun("run-ts-b1", 621L);
        insertUsage("run-ts-b1", "c-tsb-1", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 11, 5, 8, 0), 5L, 1L, null, null);
        insertUsage("run-ts-b1", "c-tsb-2", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 11, 6, 8, 0), 6L, 2L, null, null);
        // to 等值(11-07 00:00):必须排除
        insertUsage("run-ts-b1", "c-tsb-4", "openai", "deepseek-v4-flash", "COMPLETED",
                LocalDateTime.of(2026, 11, 7, 0, 0), 8L, 4L, null, null);

        Map<String, UsageTimeseriesRow> buckets = byDay(query(
                LocalDateTime.of(2026, 11, 5, 8, 0), LocalDateTime.of(2026, 11, 7, 0, 0),
                null, null));
        assertThat(buckets.keySet()).containsExactlyInAnyOrder("2026-11-05", "2026-11-06");
        assertThat(buckets.get("2026-11-05").getCalls()).isEqualTo(1L);
        assertThat(buckets.get("2026-11-06").getCalls()).isEqualTo(1L);
    }

    @Test
    @DisplayName("空窗口(无任何台账行)→ 空列表")
    void emptyWindowReturnsEmptyList() {
        assertThat(query(LocalDateTime.of(2020, 1, 1, 0, 0),
                LocalDateTime.of(2020, 1, 2, 0, 0), null, null)).isEmpty();
    }

    private List<UsageTimeseriesRow> query(LocalDateTime from, LocalDateTime to,
            String provider, String modelCode) {
        return usageMapper.selectUsageTimeseries(new UsageTimeseriesQuery(
                from, to, "YYYY-MM-DD", provider, modelCode));
    }

    private Map<String, UsageTimeseriesRow> byDay(List<UsageTimeseriesRow> rows) {
        return rows.stream().collect(Collectors.toMap(
                UsageTimeseriesRow::getStatDate, Function.identity()));
    }

    private void insertRun(String runId, long userId) {
        jdbcTemplate.update("""
                INSERT INTO ia_agent_run (app_id, tenant_id, run_id, conversation_id, user_id,
                        kernel_fingerprint, agent_definition_snapshot_json, agent_state_session_id,
                        status, deadline_at, started_at) VALUES (1, 0, ?, ?, ?, 'fp-ts', '{}', ?,
                        'COMPLETED', ?, ?)
                """,
                runId, "conv-" + runId, userId, "session-" + runId,
                TS_BASE.plusHours(2), TS_BASE);
    }

    private void insertUsage(String runId, String callId, String provider, String modelCode,
            String status, LocalDateTime startedAt, Long inputTokens, Long outputTokens,
            Long reasoningTokens, Long cacheTokens) {
        jdbcTemplate.update("""
                INSERT INTO ia_agent_model_call_usage (app_id, tenant_id, run_id, model_call_id,
                        provider, model_code, status, input_tokens, output_tokens, reasoning_tokens,
                        cache_tokens, settlement_status, started_at, finished_at)
                VALUES (1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                """,
                runId, callId, provider, modelCode, status, inputTokens, outputTokens,
                reasoningTokens, cacheTokens, startedAt, startedAt.plusSeconds(3));
    }
}
