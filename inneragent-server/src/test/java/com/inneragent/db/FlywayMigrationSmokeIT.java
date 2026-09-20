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
 * Flyway 迁移链冒烟测试(P0-T4)。
 *
 * <p>纯 JDBC + Flyway 编程式 API,不启动 Spring:在真实 PostgreSQL 17(Testcontainers)
 * 上执行 classpath:db/migration 全链迁移,断言 19 张 ia_ 业务表全部建成、种子数据落库,
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

    /** 技术方案 §5.1 规定的 19 张 ia_ 业务表(按表名字典序,与 SQL ORDER BY 对齐)。 */
    private static final List<String> EXPECTED_IA_TABLES = List.of(
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
            // V2:应用与工具
            "ia_ai_model",
            "ia_app",
            "ia_audit_log",
            "ia_model_api_config",
            "ia_tool_grant",
            "ia_tool_registry");

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
    void migrateCreatesAllNineteenIaTablesAndSeeds() throws SQLException {
        MigrateResult result = flyway().migrate();

        assertEquals(3, result.migrationsExecuted, "应依次执行 V1/V2/V3 三个迁移");

        List<String> actualTables = listIaTables();
        assertEquals(EXPECTED_IA_TABLES, actualTables, "information_schema 中应恰好存在 19 张 ia_ 表");

        // flyway_schema_history:三条记录且全部 success
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT COUNT(*) FROM flyway_schema_history WHERE success = TRUE");
             ResultSet resultSet = statement.executeQuery()) {
            assertTrue(resultSet.next());
            assertEquals(3, resultSet.getInt(1), "flyway_schema_history 应有 3 条成功记录");
        }

        // 种子数据:默认应用 / 状态清理策略单例 / 工作区配置单例
        try (Connection connection = openConnection();
             PreparedStatement appStatement = connection.prepareStatement(
                     "SELECT app_key FROM ia_app WHERE id = 1");
             ResultSet appResultSet = appStatement.executeQuery()) {
            assertTrue(appResultSet.next(), "应预置 id=1 的默认应用(app_id 列 DEFAULT 1 指向它)");
            assertEquals("default", appResultSet.getString(1));
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
}
