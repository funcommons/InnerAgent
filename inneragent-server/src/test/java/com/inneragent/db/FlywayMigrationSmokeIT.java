package com.inneragent.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Flyway 迁移链冒烟测试(P0-T4 建立;P1 台账④随 V5__storage_config.sql、
 * P1-T2a 随 V6 工具中枢增补、P1-T3b 随 V7__agent_attachment.sql 对话附件增补、
 * P2-srv U1 随 V8 decision_source 注释刷新、P2-key 随 V9__app_sign_key_rotation_grace.sql
 * 签名公钥轮换双 key 列增补、P2-obs 随 V11__webhook_delivery.sql 终态 Webhook 投递增补、
 * R1 修复随 V13__tool_grant_active_unique_index.sql 授权活跃行部分唯一索引增补、
 * 优化建议 #2 随 V14__circuit_breaker_and_webhook_config.sql 熔断/Webhook 订阅配置增补、
 * R3 修复随 V15__ia_app_circuit_limits_text.sql 熔断上限列 JSONB → TEXT 增补、
 * P2-W5 随 V16__audit_admin_plane_codes.sql 审计管理面码值注释刷新、
 * P2-safety 批次②随 V17__tool_registry_health_check.sql 工具体检位增补(合并时自 V16 顺延))。
 *
 * <p>纯 JDBC + Flyway 编程式 API,不启动 Spring:在真实 PostgreSQL 17(Testcontainers)
 * 上执行 classpath:db/migration 全链迁移,断言 26 张 ia_ 业务表全部建成、种子数据落库,
 * 并重复执行 migrate 验证幂等。由 maven-failsafe-plugin 执行(类名 *IT 结尾)。</p>
 */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class FlywayMigrationSmokeIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("postgres:17-alpine"))
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    /** ia_ 业务表全集:技术方案 §5.1 的 19 张 + V5 存储配置 + V6 schema 历史 + V7 附件 + V10 管理站认证 + V11 终态 Webhook 投递 + V14 熔断事件流水(字典序,26 张)。 */
    private static final List<String> EXPECTED_IA_TABLES = List.of(
            // V10:管理站账号认证(18a;ia_adm 字典序居 ia_agent_* 之前)
            "ia_admin_account",
            "ia_admin_login_log",
            // V7:对话附件
            "ia_agent_attachment",
            // V1:Agent 核心
            "ia_agent_conversation",
            "ia_agent_definition",
            "ia_agent_event",
            "ia_agent_mcp_server",
            "ia_agent_message",
            "ia_agent_model_call_usage",
            "ia_agent_run",
            // V3:状态/工作区(MCP 服务表亦以 ia_agent_ 开头)
            "ia_agent_state",
            "ia_agent_state_cleanup_policy",
            "ia_agent_workspace_config",
            "ia_agent_workspace_entry",
            "ia_agent_workspace_migration",
            "ia_agent_workspace_migration_item",
            // V2:应用与工具;V6:schema 历史
            "ia_ai_model",
            "ia_app",
            "ia_audit_log",
            // V14:熔断事件流水(优化建议 #2 服务端半)
            "ia_circuit_event",
            "ia_model_api_config",
            // V5:工作区/媒体对象存储配置
            "ia_storage_config",
            "ia_tool_grant",
            "ia_tool_registry",
            "ia_tool_schema_history",
            // V11:终态 Webhook 投递记录(任务 #18b)
            "ia_webhook_delivery");

    private static Flyway flyway() {
        return Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
    }

    private static Connection openConnection() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    @Test
    @Order(1)
    void migrateCreatesAllIaTablesAndSeeds() throws SQLException {
        MigrateResult result = flyway().migrate();

        assertEquals(17, result.migrationsExecuted, "应依次执行 V1-V17 十七个迁移(V14 熔断/Webhook 订阅配置;V15 熔断上限列 JSONB→TEXT;V16 审计管理面码值注释刷新;V17 工具体检位)");

        List<String> actualTables = listIaTables();
        assertEquals(EXPECTED_IA_TABLES, actualTables, "information_schema 中应恰好存在 26 张 ia_ 表(V14 增熔断事件流水)");

        // flyway_schema_history:十六条记录且全部 success
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT COUNT(*) FROM flyway_schema_history WHERE success = TRUE");
             ResultSet resultSet = statement.executeQuery()) {
            assertTrue(resultSet.next());
            assertEquals(17, resultSet.getInt(1), "flyway_schema_history 应有 17 条成功记录(V14 熔断/Webhook 配置 + V15 熔断上限列 TEXT + V16 审计码值注释刷新 + V17 工具体检位)");
        }

        // V6 分诊/生命周期列就位(活刷新分诊 V14 + 授权自动失效 V18)
        assertTrue(columnExists("ia_tool_registry", "revalidate_required"),
                "ia_tool_registry.revalidate_required 应存在(V14 分诊标记)");
        assertTrue(columnExists("ia_tool_registry", "pending_schema"),
                "ia_tool_registry.pending_schema 应存在(BREAKING 暂存)");

        // V16:工具体检 v1 三列(结论/时间/明细;明细为 TEXT 存 JSON,R3 DEF-08 教训)
        assertEquals("character varying", columnType("ia_tool_registry", "health_status"),
                "ia_tool_registry.health_status 应为 VARCHAR(16)(V17 体检结论)");
        assertEquals(16, columnCharLength("ia_tool_registry", "health_status"),
                "ia_tool_registry.health_status 列宽应为 16(ok/degraded/unreachable,V16)");
        assertEquals("timestamp without time zone", columnType("ia_tool_registry", "last_checked_at"),
                "ia_tool_registry.last_checked_at 应为 TIMESTAMP(V17 体检时间)");
        assertEquals("text", columnType("ia_tool_registry", "health_detail_json"),
                "ia_tool_registry.health_detail_json 应为 TEXT(V16;不用 JSONB——R3 DEF-08 教训)");
        assertTrue(columnExists("ia_tool_grant", "invalidated"),
                "ia_tool_grant.invalidated 应存在(自动失效,V18)");
        assertEquals("character varying", columnType("ia_tool_grant", "conversation_id"),
                "ia_tool_grant.conversation_id 应为 VARCHAR(会话 UUID 语义)");

        // V13:授权唯一约束改为「仅活跃行」部分唯一索引(DEF-04 撤销后重授 500 修复)
        assertFalse(constraintExists("ia_tool_grant", "uk_ia_tool_grant"),
                "uk_ia_tool_grant 表级约束(含逻辑删行)应已删除(V13)");
        assertTrue(indexExists("uk_ia_tool_grant_active"),
                "uk_ia_tool_grant_active 部分唯一索引应存在(V13)");
        String indexDef = indexDef("uk_ia_tool_grant_active");
        assertTrue(indexDef.startsWith("CREATE UNIQUE INDEX"),
                "uk_ia_tool_grant_active 应为唯一索引:" + indexDef);
        assertTrue(indexDef.contains("NULLS NOT DISTINCT"),
                "uk_ia_tool_grant_active 应保持 NULLS NOT DISTINCT(永久授权 NULL 会话也参与唯一):" + indexDef);
        assertTrue(indexDef.toLowerCase().contains("where")
                        && indexDef.toLowerCase().contains("deleted"),
                "uk_ia_tool_grant_active 应带 deleted = FALSE 部分谓词(撤销/失效行不占键):" + indexDef);

        // V12:审计裁决列宽 32——schema_revalidated(18)曾超 VARCHAR(16) 致
        // BREAKING 确认端点在审计 fail-closed 下 500,放宽杜绝「枚举超列宽」
        assertEquals(32, columnCharLength("ia_audit_log", "decision"),
                "ia_audit_log.decision 应为 VARCHAR(32)(V12 放宽,容纳分诊/生命周期枚举)");
        assertEquals(24, columnCharLength("ia_audit_log", "decision_source"),
                "ia_audit_log.decision_source 应保持 VARCHAR(24)");

        // V9:签名公钥轮换双 key 列就位(P2-key;存量/种子行保持 NULL = 未轮换语义)
        assertTrue(columnExists("ia_app", "previous_sign_public_key"),
                "ia_app.previous_sign_public_key 应存在(V9 轮换宽限期)");
        assertTrue(columnExists("ia_app", "sign_key_rotated_at"),
                "ia_app.sign_key_rotated_at 应存在(V9 宽限期起点)");
        assertEquals("timestamp without time zone", columnType("ia_app", "sign_key_rotated_at"),
                "ia_app.sign_key_rotated_at 应为 TIMESTAMP(无时区,V9)");

        // V10:管理站账号认证两表(P2-admin 18a;Argon2 参数封存于迁移注释)
        assertEquals("character varying", columnType("ia_admin_account", "password_hash"),
                "ia_admin_account.password_hash 应为 VARCHAR(Argon2 编码串,$argon2id$ 前缀)");
        assertTrue(columnExists("ia_admin_account", "locked_until"),
                "ia_admin_account.locked_until 应存在(失败锁定,V10)");
        assertTrue(columnExists("ia_admin_account", "failed_attempts"),
                "ia_admin_account.failed_attempts 应存在(失败计数,V10)");
        assertTrue(columnExists("ia_admin_login_log", "success"),
                "ia_admin_login_log.success 应存在(登录审计,V10)");
        assertEquals("boolean", columnType("ia_admin_login_log", "success"),
                "ia_admin_login_log.success 应为 BOOLEAN(V10)");
        assertTrue(columnExists("ia_audit_log", "decision_source"),
                "ia_audit_log.decision_source 应存在(V2;V10 增补其检索索引)");
        assertTrue(indexExists("idx_ia_audit_log_app_source_time"),
                "ia_audit_log (app_id, decision_source, create_time) 检索索引应存在(V10)");
        assertTrue(indexExists("idx_ia_audit_log_app_tool"),
                "ia_audit_log (app_id, tool_fqn) 检索索引应存在(V10)");
        try (Connection connection = openConnection();
             PreparedStatement appStatement = connection.prepareStatement(
                     "SELECT app_key, previous_sign_public_key, sign_key_rotated_at FROM ia_app WHERE id = 1");
             ResultSet appResultSet = appStatement.executeQuery()) {
            assertTrue(appResultSet.next(), "应预置 id=1 的默认应用(app_id 列 DEFAULT 1 指向它)");
            assertEquals("default", appResultSet.getString(1));
            assertTrue(appResultSet.getObject(2) == null && appResultSet.getObject(3) == null,
                    "种子默认应用未轮换:previous_sign_public_key/sign_key_rotated_at 应为 NULL(V9)");
        }
        try (Connection connection = openConnection();
             PreparedStatement policyStatement = connection.prepareStatement(
                     "SELECT cleanup_interval_days, retention_days FROM ia_agent_state_cleanup_policy WHERE id = 1");
             ResultSet policyResultSet = policyStatement.executeQuery()) {
            assertTrue(policyResultSet.next(), "应预置 id=1 的状态清理策略单例");
            assertEquals(1, policyResultSet.getInt(1));
            assertEquals(30, policyResultSet.getInt(2));
        }
        try (Connection connection = openConnection();
             PreparedStatement workspaceStatement = connection.prepareStatement(
                     "SELECT backend_type, migration_status FROM ia_agent_workspace_config WHERE id = 1");
             ResultSet workspaceResultSet = workspaceStatement.executeQuery()) {
            assertTrue(workspaceResultSet.next(), "应预置 id=1 的工作空间配置单例");
            assertEquals("database", workspaceResultSet.getString(1));
            assertEquals("idle", workspaceResultSet.getString(2));
        }

        // V7:附件表关键列就位 + 演示 mock 模型补多模态能力(P1-T3b 附件上传可演示)
        assertTrue(columnExists("ia_agent_attachment", "content_ref"),
                "ia_agent_attachment.content_ref 应存在(V7)");
        assertTrue(columnExists("ia_agent_attachment", "content_sha256"),
                "ia_agent_attachment.content_sha256 应存在(V7)");
        try (Connection connection = openConnection();
             PreparedStatement modelStatement = connection.prepareStatement(
                     "SELECT multimodal_input_types::text FROM ia_ai_model WHERE code = 'mock-text'");
             ResultSet modelResultSet = modelStatement.executeQuery()) {
            assertTrue(modelResultSet.next(), "应预置 code=mock-text 的演示模型");
            assertEquals("[\"image\", \"file\"]", modelResultSet.getString(1),
                    "V7 应为演示模型补 image/file 多模态输入类型");
        }

        // V14:熔断与 Webhook 订阅配置(优化建议 #2 服务端半)
        // ia_app 熔断列:总开关缺省未停用;limits 默认 JSON 含 §4.7 核心护栏(8 并发/20 QPS)
        assertTrue(columnExists("ia_app", "circuit_limits_json"),
                "ia_app.circuit_limits_json 应存在(V14)");
        // V15(DEF-08):JSONB → TEXT——共享实体 ia_app 整行 UPDATE 携该列,
        // JSONB+MySQL 形 typeHandler 在运行态连接串(无 stringtype=unspecified)下全写路径 500
        assertEquals("text", columnType("ia_app", "circuit_limits_json"),
                "ia_app.circuit_limits_json 应为 TEXT(V15,DEF-08 修复:实体纯 String,序列化在服务层)");
        assertEquals("boolean", columnType("ia_app", "circuit_stopped"),
                "ia_app.circuit_stopped 应为 BOOLEAN(V14 应用级紧急停用总开关)");
        assertTrue(columnExists("ia_app", "circuit_stopped_at"),
                "ia_app.circuit_stopped_at 应存在(V14)");
        assertTrue(columnExists("ia_app", "circuit_stop_reason"),
                "ia_app.circuit_stop_reason 应存在(V14)");
        assertTrue(columnExists("ia_app", "webhook_enabled"),
                "ia_app.webhook_enabled 应存在(V14 Webhook 总开关)");
        assertTrue(columnExists("ia_app", "webhook_events"),
                "ia_app.webhook_events 应存在(V14 Webhook 订阅事件)");
        try (Connection connection = openConnection();
             PreparedStatement app14 = connection.prepareStatement(
                     "SELECT circuit_stopped, circuit_limits_json::text, webhook_enabled, webhook_events "
                             + "FROM ia_app WHERE id = 1");
             ResultSet app14Set = app14.executeQuery()) {
            assertTrue(app14Set.next(), "应预置 id=1 的默认应用");
            assertFalse(app14Set.getBoolean(1), "默认应用缺省未紧急停用(V14)");
            // V15 起列值为文本(V14 种子行经 jsonb→text 转换含空格),归一化后断言关键护栏值
            String limitsJson = app14Set.getString(2).replaceAll("\\s", "");
            assertTrue(limitsJson.contains("\"mcpConcurrency\":8")
                            && limitsJson.contains("\"mcpQps\":20"),
                    "limits 默认值应含 §4.7 核心护栏(并发 8/QPS 20):" + limitsJson);
            assertTrue(limitsJson.contains("\"confirmTimeoutHours\":24"),
                    "limits 默认值应含确认超时 24h:" + limitsJson);
            assertTrue(app14Set.getBoolean(3), "Webhook 总开关缺省开启(V14)");
            assertEquals("run.finished,run.failed,run.cancelled",
                    app14Set.getString(4), "Webhook 订阅缺省终态三事件(V14)");
        }
        // ia_circuit_event 流水表(仅追加;mock 契约 CircuitBreakerEvent 数据源)
        assertTrue(columnExists("ia_circuit_event", "type"),
                "ia_circuit_event.type 应存在(V14)");
        assertTrue(columnExists("ia_circuit_event", "run_id"),
                "ia_circuit_event.run_id 应存在(V14)");
        assertTrue(columnExists("ia_circuit_event", "operator"),
                "ia_circuit_event.operator 应存在(V14)");
        assertTrue(indexExists("idx_ia_circuit_event_app_time"),
                "ia_circuit_event (app_id, create_time DESC) 检索索引应存在(V14)");
    }

    @Test
    @Order(2)
    void repeatedMigrateIsIdempotent() throws SQLException {
        MigrateResult result = flyway().migrate();

        assertEquals(0, result.migrationsExecuted, "重复 migrate 不应再执行任何迁移");
        assertEquals(EXPECTED_IA_TABLES, listIaTables(), "幂等校验后 ia_ 表集合不变");
    }

    /**
     * V13 行为校验(DEF-04):撤销(逻辑删)行不占唯一键——同键重授可插入;
     * 活跃行之间仍互斥(重复授权被约束拒绝)。
     */
    @Test
    @Order(3)
    void revokedGrantRowDoesNotBlockReGrantWhileActiveRowsStayUnique() throws SQLException {
        long userId = 999001;
        String fqn = "mcp__it__v13_probe";
        try {
            try (Connection connection = openConnection();
                 PreparedStatement insert = connection.prepareStatement(
                         "INSERT INTO ia_tool_grant (user_id, tool_fqn, scope, conversation_id, deleted) "
                                 + "VALUES (?, ?, 'permanent', NULL, FALSE)")) {
                insert.setLong(1, userId);
                insert.setString(2, fqn);
                assertEquals(1, insert.executeUpdate(), "首笔活跃授权应插入成功");
            }
            // 活跃行互斥:同键第二笔活跃授权必须被部分唯一索引拒绝
            try (Connection connection = openConnection();
                 PreparedStatement insert = connection.prepareStatement(
                         "INSERT INTO ia_tool_grant (user_id, tool_fqn, scope, conversation_id, deleted) "
                                 + "VALUES (?, ?, 'permanent', NULL, FALSE)")) {
                insert.setLong(1, userId);
                insert.setString(2, fqn);
                assertThrows(SQLException.class, insert::executeUpdate,
                        "同键重复活跃授权应违反 uk_ia_tool_grant_active");
            }
            // 撤销(逻辑删)后:同键重授必须成功(DEF-04 核心口径)
            try (Connection connection = openConnection();
                 PreparedStatement revoke = connection.prepareStatement(
                         "UPDATE ia_tool_grant SET deleted = TRUE WHERE user_id = ? AND tool_fqn = ?");
                 PreparedStatement reGrant = connection.prepareStatement(
                         "INSERT INTO ia_tool_grant (user_id, tool_fqn, scope, conversation_id, deleted) "
                                 + "VALUES (?, ?, 'permanent', NULL, FALSE)")) {
                revoke.setLong(1, userId);
                revoke.setString(2, fqn);
                assertEquals(1, revoke.executeUpdate(), "撤销应逻辑删原授权行");
                reGrant.setLong(1, userId);
                reGrant.setString(2, fqn);
                assertEquals(1, reGrant.executeUpdate(), "撤销后同键重授应插入成功(逻辑删行不占键)");
            }
        } finally {
            try (Connection connection = openConnection();
                 PreparedStatement cleanup = connection.prepareStatement(
                         "DELETE FROM ia_tool_grant WHERE user_id = ? AND tool_fqn = ?")) {
                cleanup.setLong(1, userId);
                cleanup.setString(2, fqn);
                cleanup.executeUpdate();
            }
        }
    }

    private static List<String> listIaTables() throws SQLException {
        List<String> tables = new ArrayList<>();
        // LIKE 'ia\_%':反斜杠转义下划线,避免把 iaXx 之类误匹配进来
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT table_name FROM information_schema.tables "
                             + "WHERE table_schema = ? AND table_name LIKE 'ia\\_%' "
                             + "ORDER BY table_name")) {
            statement.setString(1, "public");
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    tables.add(resultSet.getString(1));
                }
            }
        }
        return tables;
    }

    private static boolean columnExists(String table, String column) throws SQLException {
        return columnType(table, column) != null;
    }

    private static boolean indexExists(String indexName) throws SQLException {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?")) {
            statement.setString(1, indexName);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        }
    }

    private static String indexDef(String indexName) throws SQLException {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?")) {
            statement.setString(1, indexName);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getString(1) : "";
            }
        }
    }

    private static boolean constraintExists(String table, String constraintName) throws SQLException {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT 1 FROM information_schema.table_constraints "
                             + "WHERE table_schema = 'public' AND table_name = ? AND constraint_name = ?")) {
            statement.setString(1, table);
            statement.setString(2, constraintName);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        }
    }

    private static String columnType(String table, String column) throws SQLException {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT data_type FROM information_schema.columns "
                             + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?")) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getString(1) : null;
            }
        }
    }

    private static int columnCharLength(String table, String column) throws SQLException {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT character_maximum_length FROM information_schema.columns "
                             + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?")) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return -1;
                }
                int length = resultSet.getInt(1);
                return resultSet.wasNull() ? -1 : length;
            }
        }
    }
}
