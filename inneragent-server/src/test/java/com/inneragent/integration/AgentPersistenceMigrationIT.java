package com.inneragent.integration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 InnerAgent PostgreSQL 迁移线(db/migration,V1-V3)的关键结构、
 * 幂等约束与检查约束。
 *
 * <p>[adapt] 源测试分两段迁移(先 target 1.0.6.1.4,种入乱序消息,再补
 * V1.0.6.1.5 消息重排);目标迁移链 V1 已直接包含消息顺序约束,无历史
 * 中间版本,故不再做分版本迁移与乱序消息重排断言(该行为由
 * AgentRunStartIT 的消息顺序断言覆盖)。</p>
 */
@Testcontainers(disabledWithoutDocker = false)
class AgentPersistenceMigrationIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void migrateSchema() {
        DataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @Test
    void createsRunEventUsageAndOrderingConstraints() {
        assertThat(tableCount(
                "ia_agent_workspace_config",
                "ia_agent_workspace_entry",
                "ia_agent_workspace_migration",
                "ia_agent_workspace_migration_item",
                "ia_agent_mcp_server"))
                .isEqualTo(5);
        assertThat(jdbc.queryForObject(
                "SELECT backend_type FROM ia_agent_workspace_config WHERE id = 1",
                String.class))
                .isEqualTo("database");
        assertThat(tableCount(
                "ia_agent_run", "ia_agent_event", "ia_agent_model_call_usage"))
                .isEqualTo(3);
        assertThat(indexColumns("ia_agent_message", "uk_ia_agent_message_conv_order"))
                .containsExactly("conversation_id", "message_order");
        assertThat(indexColumns("ia_agent_message", "uk_ia_agent_message_projection_key"))
                .containsExactly("projection_key");
        assertThat(indexColumns("ia_agent_message", "idx_ia_agent_message_conv_run_order"))
                .containsExactly("conversation_id", "run_id", "message_order");
        assertThat(columnType("ia_agent_message", "message_order")).isEqualTo("bigint");
        assertThat(columnDefault("ia_agent_conversation", "next_message_order")).isEqualTo("1");
        assertThat(isNullable("ia_agent_conversation", "next_message_order")).isFalse();
        assertThat(columns("ia_agent_run"))
                .contains(
                        "parent_run_id",
                        "parent_tool_call_id",
                        "agent_name",
                        "deadline_at",
                        "projected_through_sequence",
                        "projection_completed_at");
        assertThat(isNullable("ia_agent_run", "deadline_at")).isFalse();
        assertThat(indexColumns("ia_agent_run", "uk_ia_agent_run_parent_tool"))
                .containsExactly("parent_run_id", "parent_tool_call_id");
        assertThat(indexColumns("ia_agent_run", "idx_ia_agent_run_parent_status"))
                .containsExactly("parent_run_id", "status", "id");
        assertThat(indexColumns("ia_agent_run", "idx_ia_agent_run_status_deadline"))
                .containsExactly("status", "deadline_at", "id");
        assertThat(indexColumns("ia_agent_run", "uk_ia_agent_run_active"))
                .containsExactly("active_conversation_id");
        assertThat(indexColumns("ia_agent_run", "idx_ia_agent_run_lease"))
                .containsExactly("status", "lease_until");
        assertThat(indexColumns("ia_agent_run", "idx_ia_agent_run_cancel"))
                .containsExactly("status", "cancel_next_attempt_at");
        assertThat(generationExpression("ia_agent_run", "active_conversation_id"))
                .contains("parent_run_id")
                .contains("conversation_id");
        assertThat(columns("ia_agent_event"))
                .contains(
                        "publish_required",
                        "publish_status",
                        "publish_claim_owner",
                        "publish_claim_until",
                        "next_publish_attempt_at");
        assertThat(indexColumns("ia_agent_event", "uk_ia_agent_event_sequence"))
                .containsExactly("run_id", "sequence_no");
        assertThat(indexColumns("ia_agent_event", "idx_ia_agent_event_publish"))
                .containsExactly("publish_status", "next_publish_attempt_at", "id");
        assertThat(columns("ia_agent_model_call_usage"))
                .contains(
                        "settlement_status",
                        "settlement_attempts",
                        "settlement_claim_owner",
                        "settlement_claim_until",
                        "downstream_settlement_id");
        assertThat(indexColumns("ia_agent_model_call_usage", "uk_ia_agent_usage_call"))
                .containsExactly("run_id", "model_call_id");
        assertThat(indexColumns("ia_agent_model_call_usage", "idx_ia_agent_usage_settlement"))
                .containsExactly("settlement_status", "next_settlement_attempt_at", "id");
        // [adapt] 源 DDL 显式 COLLATE "C";目标 V1 未固定列级 collation(取库默认),
        // 大小写敏感唯一性改由 assertRootAndChildAdmissionConstraints 的 'TOOL-1'/'tool-1'
        // 行为断言覆盖,不再断言 collation_name。

        assertMessageOrderUniquenessIsEnforced();
        assertRootAndChildAdmissionConstraints();
        assertEventAndUsageIdempotencyConstraints();
        assertCheckConstraintsAreEnforced();
    }

    /** 目标 V1 已直接内置 (conversation_id, message_order) 唯一约束,验证其生效。 */
    private static void assertMessageOrderUniquenessIsEnforced() {
        jdbc.update("""
                INSERT INTO ia_agent_conversation(
                    conversation_id, user_id, title, message_count, deleted)
                VALUES ('ordering-check', 42, 'Ordering check', 0, FALSE)
                """);
        jdbc.update("""
                INSERT INTO ia_agent_message(
                    conversation_id, role, content, message_order, deleted)
                VALUES ('ordering-check', 'user', 'first', 1, FALSE)
                """);
        assertThatThrownBy(() -> jdbc.update("""
                        INSERT INTO ia_agent_message(
                            conversation_id, role, content, message_order, deleted)
                        VALUES ('ordering-check', 'user', 'duplicate-order', 1, FALSE)
                        """))
                .isInstanceOf(DuplicateKeyException.class);
    }

    private static void assertRootAndChildAdmissionConstraints() {
        insertRunningRoot("legacy-ordering", "root-1");
        assertThatCode(() -> insertRunningChild(
                        "legacy-ordering", "root-1", "tool-1", "child-a"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> insertRunningChild(
                        "legacy-ordering", "root-1", "tool-1", "child-b"))
                .isInstanceOf(DuplicateKeyException.class);
        assertThatCode(() -> insertRunningChild(
                        "legacy-ordering", "root-1", "TOOL-1", "child-case-sensitive"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> insertRunningRoot("legacy-ordering", "root-2"))
                .isInstanceOf(DuplicateKeyException.class);
        assertThat(jdbc.update("""
                UPDATE ia_agent_run
                SET status = 'COMPLETED', finished_at = CURRENT_TIMESTAMP(3)
                WHERE run_id = 'root-1'
                """)).isEqualTo(1);
        assertThatCode(() -> insertRunningRoot("legacy-ordering", "root-2"))
                .doesNotThrowAnyException();
    }

    private static void assertEventAndUsageIdempotencyConstraints() {
        insertEvent("root-1", 1);
        assertThatThrownBy(() -> insertEvent("root-1", 1))
                .isInstanceOf(DuplicateKeyException.class);
        insertUsage("root-1", "model-call-1");
        assertThatThrownBy(() -> insertUsage("root-1", "model-call-1"))
                .isInstanceOf(DuplicateKeyException.class);
    }

    private static void assertCheckConstraintsAreEnforced() {
        assertCheckViolation(() -> jdbc.update("""
                        INSERT INTO ia_agent_event(
                            run_id, sequence_no, raw_event_type, payload_json,
                            publish_required, publish_status)
                        VALUES ('root-1', 2, 'TEXT_BLOCK_DELTA', '{}', FALSE, 'PENDING')
                        """), "chk_ia_agent_event_publish_state");
        assertCheckViolation(() -> jdbc.update("""
                        INSERT INTO ia_agent_event(
                            run_id, sequence_no, raw_event_type, payload_json,
                            publish_required, publish_status)
                        VALUES ('root-1', 2, 'TEXT_BLOCK_DELTA', '{}', TRUE, 'NOT_REQUIRED')
                        """), "chk_ia_agent_event_publish_state");
        assertCheckViolation(() -> jdbc.update("""
                        INSERT INTO ia_agent_run(
                            run_id, conversation_id, user_id, kernel_fingerprint,
                            agent_definition_snapshot_json, agent_state_session_id,
                            status, deadline_at, started_at)
                        VALUES (
                            'invalid-status', 'other-conversation', 42, repeat('f', 64),
                            '{}', 'invalid-status-session', 'UNKNOWN',
                            CURRENT_TIMESTAMP(3) + interval '10 minutes',
                            CURRENT_TIMESTAMP(3))
                        """), "chk_ia_agent_run_status");
    }

    private static void assertCheckViolation(
            org.assertj.core.api.ThrowableAssert.ThrowingCallable operation,
            String constraintName) {
        assertThatThrownBy(operation)
                .isInstanceOf(DataAccessException.class)
                .satisfies(failure -> {
                    DataAccessException dataFailure = (DataAccessException) failure;
                    assertThat(dataFailure.getMostSpecificCause())
                            .isInstanceOf(java.sql.SQLException.class);
                    java.sql.SQLException sqlFailure =
                            (java.sql.SQLException) dataFailure.getMostSpecificCause();
                    assertThat(sqlFailure.getSQLState()).isEqualTo("23514");
                    assertThat(sqlFailure.getMessage()).contains(constraintName);
                });
    }

    private static void insertRunningRoot(String conversationId, String runId) {
        jdbc.update("""
                INSERT INTO ia_agent_run(
                    run_id, conversation_id, user_id, kernel_fingerprint,
                    agent_definition_snapshot_json, agent_state_session_id,
                    status, owner_instance_id, owner_epoch, lease_until,
                    deadline_at, started_at)
                VALUES (?, ?, 42, repeat('a', 64), '{}', ?, 'RUNNING',
                    'instance-a', 1,
                    CURRENT_TIMESTAMP(3) + interval '20 seconds',
                    CURRENT_TIMESTAMP(3) + interval '10 minutes',
                    CURRENT_TIMESTAMP(3))
                """, runId, conversationId, runId + "-session");
    }

    private static void insertRunningChild(
            String conversationId,
            String parentRunId,
            String parentToolCallId,
            String childRunId) {
        jdbc.update("""
                INSERT INTO ia_agent_run(
                    run_id, conversation_id, user_id,
                    parent_run_id, parent_tool_call_id, agent_name,
                    kernel_fingerprint, agent_definition_snapshot_json,
                    agent_state_session_id, status, owner_instance_id,
                    owner_epoch, lease_until, deadline_at, started_at)
                VALUES (?, ?, 42, ?, ?, 'asset_image_gen', repeat('b', 64), '{}', ?,
                    'RUNNING', 'instance-a', 1,
                    CURRENT_TIMESTAMP(3) + interval '20 seconds',
                    CURRENT_TIMESTAMP(3) + interval '10 minutes',
                    CURRENT_TIMESTAMP(3))
                """,
                childRunId,
                conversationId,
                parentRunId,
                parentToolCallId,
                childRunId + "-session");
    }

    private static void insertEvent(String runId, long sequence) {
        jdbc.update("""
                INSERT INTO ia_agent_event(
                    run_id, sequence_no, raw_event_type, payload_json,
                    publish_required, publish_status)
                VALUES (?, ?, 'TEXT_BLOCK_DELTA', '{}', TRUE, 'PENDING')
                """, runId, sequence);
    }

    private static void insertUsage(String runId, String modelCallId) {
        jdbc.update("""
                INSERT INTO ia_agent_model_call_usage(
                    run_id, model_call_id, provider, model_code, status,
                    settlement_status, started_at)
                VALUES (?, ?, 'openai', 'gpt-test', 'STARTED', 'PENDING', CURRENT_TIMESTAMP(3))
                """, runId, modelCallId);
    }

    private static int tableCount(String... tableNames) {
        String placeholders = String.join(",", java.util.Collections.nCopies(tableNames.length, "?"));
        Integer count = jdbc.queryForObject("""
                        SELECT COUNT(*)
                        FROM information_schema.tables
                        WHERE table_schema = current_schema()
                          AND table_name IN (""" + placeholders + ")",
                Integer.class,
                (Object[]) tableNames);
        return count == null ? 0 : count;
    }

    private static List<String> columns(String tableName) {
        return jdbc.queryForList("""
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = ?
                        ORDER BY ordinal_position
                        """, String.class, tableName);
    }

    private static String columnType(String tableName, String columnName) {
        return jdbc.queryForObject("""
                        SELECT data_type
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = ? AND column_name = ?
                        """, String.class, tableName, columnName);
    }

    private static String columnDefault(String tableName, String columnName) {
        String defaultValue = jdbc.queryForObject("""
                        SELECT column_default
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = ? AND column_name = ?
                        """, String.class, tableName, columnName);
        // PG 将 nextval 序列之外的数值默认值原样存储；对齐 MySQL 语义断言
        return defaultValue == null ? null : defaultValue.replaceAll("'", "");
    }

    private static String generationExpression(String tableName, String columnName) {
        return jdbc.queryForObject("""
                        SELECT generation_expression
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = ? AND column_name = ?
                        """, String.class, tableName, columnName);
    }

    private static boolean isNullable(String tableName, String columnName) {
        return "YES".equals(jdbc.queryForObject("""
                        SELECT is_nullable
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = ? AND column_name = ?
                        """, String.class, tableName, columnName));
    }

    private static List<String> indexColumns(String tableName, String indexName) {
        return jdbc.queryForList("""
                        SELECT a.attname
                        FROM pg_index i
                        JOIN pg_class idx ON idx.oid = i.indexrelid
                        JOIN pg_class tbl ON tbl.oid = i.indrelid
                        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                        JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
                        JOIN pg_attribute a
                          ON a.attrelid = tbl.oid AND a.attnum = k.attnum
                        WHERE ns.nspname = current_schema()
                          AND tbl.relname = ?
                          AND idx.relname = ?
                        ORDER BY k.ord
                        """, String.class, tableName, indexName);
    }

}
