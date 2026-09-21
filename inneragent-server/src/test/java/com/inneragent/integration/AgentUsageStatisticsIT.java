package com.inneragent.integration;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.inneragent.agent.mapper.AgentModelCallUsageMapper;
import com.inneragent.agent.run.ModelCallUsageLedgerPort;
import com.inneragent.agent.run.model.NormalizedModelUsage;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.repository.ai.AgentModelCallUsageRepository;
import com.inneragent.platform.usage.UsageQueryService;
import com.inneragent.platform.usage.UsageSummaryRow;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用量统计全链 IT(W15;PRD M8「用量统计」P1,03-开发计划 §7.1):真实
 * PostgreSQL(Testcontainers + Flyway 全链),覆盖:
 * <ol>
 *   <li>写入链接线:ModelCallUsageLedgerPort → ia_agent_model_call_usage
 *       全生命周期(STARTED → COMPLETED 带 token / CANCELLED;run 不存在/
 *       非 RUNNING 的护栏);</li>
 *   <li>聚合查询:按 应用/用户/日 × 模型 group by,时间区间/用户过滤、
 *       MONTH 归并、分页 total、STARTED 行不计入。</li>
 * </ol>
 * 形态对齐 AgentModelCallUsageIT(真库,服务直调;用户面/管理面路由语义由
 * 切片测试覆盖)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AgentUsageStatisticsIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private ModelCallUsageLedgerPort ledgerPort;

    @Autowired
    private AgentModelCallUsageRepository usageRepository;

    @Autowired
    private AgentModelCallUsageMapper usageMapper;

    @Autowired
    private UsageQueryService usageQueryService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private static final LocalDateTime DAY_1 = LocalDateTime.of(2026, 9, 10, 8, 0);
    private static final LocalDateTime DAY_2 = LocalDateTime.of(2026, 9, 11, 9, 30);

    @Test
    @DisplayName("写入链:STARTED → COMPLETED 带 token;运行缺失/非 RUNNING 被拒")
    void ledgerPortWritesFullLifecycle() {
        insertRun("run-ledger-1", 501L, "RUNNING");
        ModelCallUsageLedgerPort.ModelCallRef ref = new ModelCallUsageLedgerPort.ModelCallRef(
                "run-ledger-1", "mc-a1", "openai", "deepseek-v4-flash");

        ledgerPort.start(ref);

        Map<String, Object> started = usageRow("run-ledger-1", "mc-a1");
        assertThat(started.get("status")).isEqualTo("STARTED");
        assertThat(started.get("settlement_status")).isEqualTo("PENDING");
        assertThat(started.get("app_id")).isEqualTo(1L);

        ledgerPort.complete(ref, new NormalizedModelUsage(120L, 45L, 8L, null, null));
        Map<String, Object> completed = usageRow("run-ledger-1", "mc-a1");
        assertThat(completed.get("status")).isEqualTo("COMPLETED");
        assertThat(completed.get("input_tokens")).isEqualTo(120L);
        assertThat(completed.get("output_tokens")).isEqualTo(45L);
        assertThat(completed.get("reasoning_tokens")).isEqualTo(8L);

        // 幂等:终态后重复 complete 无 STARTED 行可命中,静默不重复写
        ledgerPort.complete(ref, NormalizedModelUsage.tokens(999L, 999L));
        assertThat(usageRow("run-ledger-1", "mc-a1").get("input_tokens")).isEqualTo(120L);

        // 取消路径:新调用 start 后 fail(CANCELLED)
        ModelCallUsageLedgerPort.ModelCallRef cancelled = new ModelCallUsageLedgerPort.ModelCallRef(
                "run-ledger-1", "mc-a2", "openai", "deepseek-v4-flash");
        ledgerPort.start(cancelled);
        ledgerPort.fail(cancelled, com.inneragent.platform.enums.ai.AgentModelCallStatus.CANCELLED);
        assertThat(usageRow("run-ledger-1", "mc-a2").get("status")).isEqualTo("CANCELLED");

        // 护栏:run 不存在 → 拒绝;终态 run 不再接受新模型调用
        assertThatThrownBy(() -> ledgerPort.start(new ModelCallUsageLedgerPort.ModelCallRef(
                        "run-missing", "mc-x", "openai", "deepseek-v4-flash")))
                .isInstanceOf(IllegalArgumentException.class);
        jdbcTemplate.execute("UPDATE ia_agent_run SET status = 'COMPLETED' "
                + "WHERE run_id = 'run-ledger-1'");
        assertThatThrownBy(() -> ledgerPort.start(new ModelCallUsageLedgerPort.ModelCallRef(
                        "run-ledger-1", "mc-a3", "openai", "deepseek-v4-flash")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("聚合:按 应用/用户/日 × 模型 出数;过滤/归并/分页;STARTED 不计")
    void summaryAggregatesByAppUserDayAndModel() {
        insertRun("run-sum-1", 601L, "COMPLETED");
        insertRun("run-sum-2", 602L, "COMPLETED");
        insertUsage("run-sum-1", "s1", "deepseek-v4-flash", "COMPLETED",
                DAY_1, 100L, 20L, null, null);
        insertUsage("run-sum-1", "s2", "qwen3.7-plus", "COMPLETED",
                DAY_2, 50L, 10L, 4L, 6L);
        insertUsage("run-sum-2", "s3", "deepseek-v4-flash", "COMPLETED",
                DAY_1, 70L, 30L, null, null);
        insertUsage("run-sum-2", "s4", "deepseek-v4-flash", "FAILED",
                DAY_2, null, null, null, null);
        // STARTED 未终态:不计入调用次数/聚合
        insertUsage("run-sum-2", "s5", "deepseek-v4-flash", "STARTED",
                DAY_2, null, null, null, null);

        // 全量:601 → (9-10,deepseek)+(9-11,qwen);602 → (9-10,deepseek)+
        // (9-11,deepseek,仅 FAILED 行计次不计 token);STARTED 行不计 → 4 组
        IPage<UsageSummaryRow> all = usageMapper.selectUsageSummary(
                new Page<>(1, 50), new com.inneragent.platform.usage.UsageSummaryQuery(
                        null, null, null, null, "YYYY-MM-DD"));
        assertThat(all.getTotal()).isEqualTo(4);
        assertThat(all.getRecords()).allSatisfy(row -> assertThat(row.getAppId()).isEqualTo(1L));

        UsageSummaryRow day1Deepseek = all.getRecords().stream()
                .filter(row -> "2026-09-10".equals(row.getStatDate())
                        && "deepseek-v4-flash".equals(row.getModelCode())
                        && row.getUserId().equals(601L))
                .findFirst().orElseThrow();
        assertThat(day1Deepseek.getCalls()).isEqualTo(1L);
        assertThat(day1Deepseek.getInputTokens()).isEqualTo(100L);
        assertThat(day1Deepseek.getOutputTokens()).isEqualTo(20L);
        assertThat(day1Deepseek.getReasoningTokens()).isEqualTo(0L);

        UsageSummaryRow failedGroup = all.getRecords().stream()
                .filter(row -> row.getUserId().equals(602L)
                        && "2026-09-11".equals(row.getStatDate()))
                .findFirst().orElseThrow();
        // FAILED 行计入调用次数,token 列合计为 0;STARTED 行不出现
        assertThat(failedGroup.getCalls()).isEqualTo(1L);
        assertThat(failedGroup.getInputTokens()).isEqualTo(0L);

        // 用户过滤:601 只有 2 组
        PageResult<UsageSummaryRow> rowsFor601 = page(new UsageQueryService.UsageSummaryFilter(
                null, 601L, null, null, "DAY", 1, 50));
        assertThat(rowsFor601.getTotal()).isEqualTo(2L);

        // 时间区间:仅 9-10 当天
        PageResult<UsageSummaryRow> day1Only = page(new UsageQueryService.UsageSummaryFilter(
                null, null,
                LocalDateTime.of(2026, 9, 10, 0, 0),
                LocalDateTime.of(2026, 9, 11, 0, 0),
                "DAY", 1, 50));
        assertThat(day1Only.getTotal()).isEqualTo(2L);
        assertThat(day1Only.getList())
                .allSatisfy(row -> assertThat(row.getStatDate()).isEqualTo("2026-09-10"));

        // MONTH 归并:两日并一月,每用户×模型 3 组(601 两模型 + 602 一模型)
        PageResult<UsageSummaryRow> monthly = page(new UsageQueryService.UsageSummaryFilter(
                null, null, null, null, "MONTH", 1, 50));
        assertThat(monthly.getTotal()).isEqualTo(3L);
        assertThat(monthly.getList())
                .allSatisfy(row -> assertThat(row.getStatDate()).isEqualTo("2026-09"));

        // 分页:total 与窗口无关
        PageResult<UsageSummaryRow> firstPage = page(new UsageQueryService.UsageSummaryFilter(
                null, null, null, null, "DAY", 1, 1));
        assertThat(firstPage.getTotal()).isEqualTo(4L);
        assertThat(firstPage.getList()).hasSize(1);
    }

    @Test
    @DisplayName("粒度契约:granularity 仅 DAY/MONTH,其他值 400 语义")
    void summaryRejectsInvalidGranularity() {
        assertThatThrownBy(() -> usageQueryService.page(
                new UsageQueryService.UsageSummaryFilter(
                        null, null, null, null, "WEEK", 1, 10)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private PageResult<UsageSummaryRow> page(UsageQueryService.UsageSummaryFilter filter) {
        return com.inneragent.platform.common.PageResult.of(
                usageMapper.selectUsageSummary(
                        new Page<>(filter.pageNo(), filter.pageSize()),
                        new com.inneragent.platform.usage.UsageSummaryQuery(
                                filter.appId(), filter.userId(), filter.from(), filter.to(),
                                "MONTH".equals(UsageQueryService.normalizeGranularity(
                                        filter.granularity())) ? "YYYY-MM" : "YYYY-MM-DD")));
    }

    private void insertRun(String runId, long userId, String status) {
        jdbcTemplate.update("""
                INSERT INTO ia_agent_run (app_id, tenant_id, run_id, conversation_id, user_id,
                        kernel_fingerprint, agent_definition_snapshot_json, agent_state_session_id,
                        status, deadline_at, started_at)
                VALUES (1, 0, ?, ?, ?, 'fp-w15', '{}', ?, ?, ?, ?)
                """,
                runId, "conv-" + runId, userId, "session-" + runId,
                status, DAY_1.plusHours(2), DAY_1);
    }

    private void insertUsage(
            String runId,
            String callId,
            String modelCode,
            String status,
            LocalDateTime startedAt,
            Long inputTokens,
            Long outputTokens,
            Long reasoningTokens,
            Long cacheTokens) {
        jdbcTemplate.update("""
                INSERT INTO ia_agent_model_call_usage (app_id, tenant_id, run_id, model_call_id,
                        provider, model_code, status, input_tokens, output_tokens,
                        reasoning_tokens, cache_tokens, settlement_status, started_at, finished_at)
                VALUES (1, 0, ?, ?, 'openai', ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                """,
                runId, callId, modelCode, status, inputTokens, outputTokens,
                reasoningTokens, cacheTokens, startedAt, startedAt.plusSeconds(3));
    }

    private Map<String, Object> usageRow(String runId, String callId) {
        return jdbcTemplate.queryForMap(
                "SELECT * FROM ia_agent_model_call_usage "
                        + "WHERE run_id = ? AND model_call_id = ?",
                runId, callId);
    }
}
