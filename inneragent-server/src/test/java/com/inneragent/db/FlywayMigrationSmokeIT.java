package com.inneragent.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
 * 签名公钥轮换双 key 列增补)。
 *
 * <p>纯 JDBC + Flyway 编程式 API,不启动 Spring:在真实 PostgreSQL 17(Testcontainers)
 * 上执行 classpath:db/migration 全链迁移,断言 22 张 ia_ 业务表全部建成、种子数据落库,
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

    /** ia_ 业务表全集:技术方案 §5.1 的 19 张 + V5 存储配置 + V6 schema 历史 + V7 附件(字典序,22 张)。 */
    private static final List<String> EXPECTED_IA_TABLES = List.of(
            // V7:对话附件(字典序居 ia_agent_* 首位)
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
            "ia_model_api_config",
            // V5:工作区/媒体对象存储配置
            "ia_storage_config",
            "ia_tool_grant",
            "ia_tool_registry",
            "ia_tool_schema_history");

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

        assertEquals(9, result.migrationsExecuted, "应依次执行 V1-V9 九个迁移(V8 注释刷新;V9 为 ia_app 轮换双 key 列增补)");

        List<String> actualTables = listIaTables();
        assertEquals(EXPECTED_IA_TABLES, actualTables, "information_schema 中应恰好存在 22 张 ia_ 表");

        // flyway_schema_history:九条记录且全部 success
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT COUNT(*) FROM flyway_schema_history WHERE success = TRUE");
             ResultSet resultSet = statement.executeQuery()) {
            assertTrue(resultSet.next());
            assertEquals(9, resultSet.getInt(1), "flyway_schema_history 应有 9 条成功记录(V8 注释刷新 + V9 轮换双 key)");
        }

        // V6 分诊/生命周期列就位(活刷新分诊 V14 + 授权自动失效 V18)
        assertTrue(columnExists("ia_tool_registry", "revalidate_required"),
                "ia_tool_registry.revalidate_required 应存在(V14 分诊标记)");
        assertTrue(columnExists("ia_tool_registry", "pending_schema"),
                "ia_tool_registry.pending_schema 应存在(BREAKING 暂存)");
        assertTrue(columnExists("ia_tool_grant", "invalidated"),
                "ia_tool_grant.invalidated 应存在(自动失效,V18)");
        assertEquals("character varying", columnType("ia_tool_grant", "conversation_id"),
                "ia_tool_grant.conversation_id 应为 VARCHAR(会话 UUID 语义)");

        // V9:签名公钥轮换双 key 列就位(P2-key;存量/种子行保持 NULL = 未轮换语义)
        assertTrue(columnExists("ia_app", "previous_sign_public_key"),
                "ia_app.previous_sign_public_key 应存在(V9 轮换宽限期)");
        assertTrue(columnExists("ia_app", "sign_key_rotated_at"),
                "ia_app.sign_key_rotated_at 应存在(V9 宽限期起点)");
        assertEquals("timestamp without time zone", columnType("ia_app", "sign_key_rotated_at"),
                "ia_app.sign_key_rotated_at 应为 TIMESTAMP(无时区,V9)");
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
    }

    @Test
    @Order(2)
    void repeatedMigrateIsIdempotent() throws SQLException {
        MigrateResult result = flyway().migrate();

        assertEquals(0, result.migrationsExecuted, "重复 migrate 不应再执行任何迁移");
        assertEquals(EXPECTED_IA_TABLES, listIaTables(), "幂等校验后 ia_ 表集合不变");
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
}
