package com.inneragent.integration;

import com.inneragent.agent.feedback.AgentFeedbackService;
import com.inneragent.agent.entity.AgentFeedback;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.common.PageResult;
import com.inneragent.platform.usage.UsageQueryService;
import com.inneragent.platform.usage.UsageQueryService.NorthStarSummary;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用户反馈全链 IT(W15;PRD M2 用户反馈 👍/👎,03-开发计划 §7.3 验收 6):
 * 真实 PostgreSQL(Testcontainers + Flyway 全链,部分唯一索引生效),覆盖:
 * <ol>
 *   <li>upsert 幂等:同消息/同 run 重复反馈 = 覆盖,不产生重复行;
 *       消息级与 run 级并存(不同幂等键);</li>
 *   <li>锚点契约:无锚(runId 与 conversationId+messageId 双缺)与
 *       消息级缺 conversationId 均拒绝;</li>
 *   <li>越权:用户 B 查询/分页不可见用户 A 的反馈(行级 userId 隔离);</li>
 *   <li>北极星出数:好评率 👍÷(👍+👎);带反馈完成率代理 =
 *       COMPLETED÷(COMPLETED+FAILED)(CANCELLED 单列,子运行不计)。</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AgentFeedbackIT {

    private static final long USER_A = 10001L;
    private static final long USER_B = 20002L;

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
    private AgentFeedbackService feedbackService;

    @Autowired
    private UsageQueryService usageQueryService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    @DisplayName("upsert 幂等:同消息重复反馈覆盖不重复行;跨用户各自成行")
    void submitUpsertsMessageLevelFeedbackIdempotently() {
        AgentFeedback first = feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-1", null, "42", "up", " 很棒 "));
        AgentFeedback again = feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-1", null, "42", "DOWN", "其实不对"));
        AgentFeedback otherUser = feedbackService.submit(1L, USER_B, new AgentFeedbackService.Submit(
                "conv-1", null, "42", "UP", null));

        assertThat(again.getId()).isEqualTo(first.getId());
        assertThat(again.getRating()).isEqualTo("DOWN");
        assertThat(again.getComment()).isEqualTo("其实不对");
        assertThat(otherUser.getId()).isNotEqualTo(first.getId());

        Long rows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ia_feedback WHERE conversation_id = 'conv-1' "
                        + "AND message_id = '42'",
                Long.class);
        assertThat(rows).isEqualTo(2L);
    }

    @Test
    @DisplayName("run 级反馈:同 run 覆盖;消息级+run 级并存;无锚/缺 conversationId 拒绝")
    void runLevelFeedbackCoexistsAndAnchorsAreEnforced() {
        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                null, "run-9", null, "UP", null));
        AgentFeedback covered = feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                null, "run-9", null, "DOWN", "整体不行"));
        assertThat(covered.getRating()).isEqualTo("DOWN");

        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-9", "run-9", "7", "UP", null));
        Long rows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ia_feedback WHERE run_id = 'run-9'", Long.class);
        // 消息级(带 run 上下文)与 run 级是两个幂等键 → 两行
        assertThat(rows).isEqualTo(2L);

        assertThatThrownBy(() -> feedbackService.submit(1L, USER_A,
                new AgentFeedbackService.Submit(null, null, null, "UP", null)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> feedbackService.submit(1L, USER_A,
                new AgentFeedbackService.Submit(null, null, "7", "UP", null)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> feedbackService.submit(1L, USER_A,
                new AgentFeedbackService.Submit("conv-9", null, "7", "SIDE", null)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> feedbackService.submit(1L, USER_A,
                new AgentFeedbackService.Submit("conv-9", null, "7", "UP", "x".repeat(2001))))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("越权:用户 B 查不到用户 A 的反馈;admin 分页契约与 rating 过滤")
    void listIsolationAndAdminPageContract() {
        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-iso", null, "1", "UP", "A 的反馈"));
        feedbackService.submit(1L, USER_B, new AgentFeedbackService.Submit(
                "conv-iso", null, "2", "DOWN", null));

        List<AgentFeedback> mineA = feedbackService.listMine(1L, USER_A, "conv-iso", null);
        assertThat(mineA).hasSize(1);
        assertThat(mineA.getFirst().getUserId()).isEqualTo(USER_A);

        List<AgentFeedback> mineB = feedbackService.listMine(1L, USER_B, "conv-iso", null);
        assertThat(mineB).hasSize(1);
        assertThat(mineB.getFirst().getMessageId()).isEqualTo("2");

        PageResult<AgentFeedback> downs = feedbackService.page(
                new AgentFeedbackService.AdminFilter(
                        1L, null, "conv-iso", null, "DOWN", null, null, 1, 10));
        assertThat(downs.getTotal()).isEqualTo(1L);
        assertThat(downs.getPageNo()).isEqualTo(1);
        assertThat(downs.getPageSize()).isEqualTo(10);
        assertThat(downs.getList().getFirst().getUserId()).isEqualTo(USER_B);

        assertThatThrownBy(() -> feedbackService.page(new AgentFeedbackService.AdminFilter(
                        1L, null, null, null, "MIDDLE", null, null, 1, 10)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("北极星出数:好评率与带反馈完成率代理(根运行,CANCELLED 单列)")
    void northStarComputesRatesFromFeedbackAndRuns() {
        // 收口:前面用例的反馈共享 create_time≈now 窗口,先清场保证比率封闭
        jdbcTemplate.update("DELETE FROM ia_feedback");
        jdbcTemplate.update("DELETE FROM ia_agent_run WHERE run_id LIKE 'run-ns-%'");
        // 根运行:conv-ns-c(COMPLETED)/ conv-ns-f(FAILED)/ conv-ns-x(CANCELLED)
        insertRun("run-ns-c", "conv-ns-c", 701L, "COMPLETED", null);
        insertRun("run-ns-f", "conv-ns-f", 701L, "FAILED", null);
        insertRun("run-ns-x", "conv-ns-x", 701L, "CANCELLED", null);
        // 子运行:不计入完成率代理(B4 口径=用户可见任务)
        insertRun("run-ns-sub", "conv-ns-c", 701L, "COMPLETED", "call-1");

        // 反馈:消息级 ×3(COMPLETED 会话 👍、FAILED 会话 👎、CANCELLED 会话 👍)
        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-ns-c", null, "100", "UP", null));
        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-ns-f", null, "101", "DOWN", null));
        feedbackService.submit(1L, USER_A, new AgentFeedbackService.Submit(
                "conv-ns-x", null, "102", "UP", null));
        // run 级 👎(直连 run-ns-c,同样计入带反馈集合)
        feedbackService.submit(1L, USER_B, new AgentFeedbackService.Submit(
                null, "run-ns-c", null, "DOWN", null));

        NorthStarSummary summary = usageQueryService.northStar(
                new UsageQueryService.NorthStarFilter(
                        1L, LocalDateTime.now().minusDays(1), LocalDateTime.now().plusDays(1)));

        // 好评率 = 👍 ÷ (👍+👎) = 2/4
        assertThat(summary.thumbsUp()).isEqualTo(2L);
        assertThat(summary.thumbsDown()).isEqualTo(2L);
        assertThat(summary.positiveRate()).isEqualTo(0.5d);

        // 带反馈根运行:COMPLETED 2(conv-ns-c 消息级 + run-ns-c run 级)、
        // FAILED 1、CANCELLED 1;子运行 run-ns-sub 不计
        assertThat(summary.feedbackLinkedCompletedRuns()).isEqualTo(2L);
        assertThat(summary.feedbackLinkedFailedRuns()).isEqualTo(1L);
        assertThat(summary.feedbackLinkedCancelledRuns()).isEqualTo(1L);
        assertThat(summary.feedbackLinkedCompletionRate())
                .isEqualTo((double) 2 / (2 + 1));

        // 空窗口:比率 null(不出数,不虚报)
        NorthStarSummary empty = usageQueryService.northStar(
                new UsageQueryService.NorthStarFilter(
                        1L, LocalDateTime.now().plusDays(5), LocalDateTime.now().plusDays(6)));
        assertThat(empty.positiveRate()).isNull();
        assertThat(empty.feedbackLinkedCompletionRate()).isNull();
    }

    private void insertRun(
            String runId, String conversationId, long userId, String status,
            String parentToolCallId) {
        jdbcTemplate.update("""
                INSERT INTO ia_agent_run (app_id, tenant_id, run_id, conversation_id, user_id,
                        kernel_fingerprint, agent_definition_snapshot_json, agent_state_session_id,
                        status, parent_run_id, parent_tool_call_id, agent_name,
                        deadline_at, started_at)
                VALUES (1, 0, ?, ?, ?, 'fp-w15', '{}', ?, ?, ?, ?, ?, ?, ?)
                """,
                runId, conversationId, userId, "session-" + runId, status,
                parentToolCallId == null ? null : "parent-" + runId,
                parentToolCallId, parentToolCallId == null ? null : "sub-agent",
                LocalDateTime.of(2026, 9, 20, 8, 0), LocalDateTime.of(2026, 9, 20, 7, 0));
    }
}
