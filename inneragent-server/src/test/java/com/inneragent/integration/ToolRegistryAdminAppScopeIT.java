package com.inneragent.integration;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.toolhub.ToolRegistryEntry;
import com.inneragent.platform.toolhub.ToolRegistryService;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AppRegistration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 工具注册管理面显式 appId 作用域守卫 IT(2026-09-23 fix regression)。
 *
 * <p>回归缺陷:管理面 {@code POST /ia/api/v1/admin/tools} 走
 * {@link AppContext#currentOrDefault()},无 AppContext 线程下回填 app_id=1;
 * 行级拦截器叠加 {@code app_id=1 AND app_id=N} 恒空——{@code acme-demo}
 * 视角下 {@code McpToolCatalog.load(appId=34)} 查不到条目,ticket-assistant
 * 工具面静默空,确认卡永不出现,agent MCP 指纹 e3b0c44…b855(空串 SHA-256)。
 *
 * <p>修复后行为:
 * <ul>
 *   <li>管理面 {@code ?appId=N} 显式传入:行落 app_id=N;N 不存在→{@code 422};
 *       既有活跃行 appId≠N→{@code 422}(防串台);</li>
 *   <li>不传 {@code appId}:维持原 {@link AppContext#currentOrDefault()}
 *       兜底(单应用部署=1)向后兼容;</li>
 *   <li>provision 路径走完后,{@code GET /admin/tools?serverKey=acme-demo}
 *       不为空且全部条目 appId=34。</li>
 * </ul>
 *
 * <p>由 maven-failsafe-plugin 执行(类名 *IT 结尾)。MockMvc + Spring Boot
 * 全栈(Testcontainers PG + Flyway + MyBatis-Plus)覆盖 controller+service
 * 整链。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = false)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ToolRegistryAdminAppScopeIT {

    private static final long TARGET_APP = 34L;
    private static final long DEFAULT_APP = 1L;
    private static final String ACME_SERVER_KEY = "acme-demo";
    private static final String ADMIN_KEY = "test-admin-key";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("IA_ADMIN_KEY", () -> ADMIN_KEY);
        // 与 ToolHealthPersistenceIT 同款:state IN_MEMORY,执行 instance-id 隔离
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id",
                () -> "tool-registry-appid-fix");
    }

    @Autowired
    private ToolRegistryService registryService;

    @Autowired
    private AdminAppService adminAppService;

    @Autowired
    private MockMvc mockMvc;

    /**
     * 每个 test 跑前清空 ia_tool_registry(server_key=acme-demo),保证状态独立;
     * 同步确保 acme-demo 应用(id=34)已就位——{@code requireEntity422(34)} 入口校验依赖。
     */
    @BeforeEach
    void resetState() throws Exception {
        AppContext.clear();
        try (Connection connection = openConnection()) {
            // 清空 acme-demo 名下所有工具(逻辑删一并清,避免复活路径误触)
            try (PreparedStatement clearTool = connection.prepareStatement(
                    "DELETE FROM ia_tool_schema_history WHERE fqn LIKE ?")) {
                clearTool.setString(1, "mcp__acme-demo__%");
                clearTool.executeUpdate();
            }
            try (PreparedStatement clearTool = connection.prepareStatement(
                    "DELETE FROM ia_tool_registry WHERE server_key = ?")) {
                clearTool.setString(1, ACME_SERVER_KEY);
                clearTool.executeUpdate();
            }
            ensureAcmeAppExists(connection);
        }
    }

    /**
     * 直接 SQL 落 acme-demo 应用 id=34(及 default id=1):
     * 显式 id 在 MyBatis-Plus @TableId(AUTO) 下会被忽略,必须绕过 mapper
     * 才能稳定产出固定 id;Flyway 已有 id=1 default 应用,这里只补 id=34。
     */
    private static void ensureAcmeAppExists(Connection connection) throws java.sql.SQLException {
        try (PreparedStatement exists = connection.prepareStatement(
                "SELECT COUNT(*) FROM ia_app WHERE id = ?")) {
            exists.setLong(1, TARGET_APP);
            try (ResultSet rs = exists.executeQuery()) {
                rs.next();
                if (rs.getLong(1) > 0) {
                    return;
                }
            }
        }
        try (PreparedStatement insert = connection.prepareStatement(
                "INSERT INTO ia_app (id, app_key, name, sign_public_key, status,"
                        + " conversation_retention_days, deleted, create_time, update_time)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            insert.setLong(1, TARGET_APP);
            insert.setString(2, ACME_SERVER_KEY);
            insert.setString(3, "ACME 演示宿主");
            insert.setString(4, "-----BEGIN PUBLIC KEY-----\n"
                    + "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n"
                    + "-----END PUBLIC KEY-----");
            insert.setInt(5, 1);
            insert.setInt(6, 180);
            insert.setBoolean(7, false);
            insert.setObject(8, java.sql.Timestamp.valueOf(LocalDateTime.now()));
            insert.setObject(9, java.sql.Timestamp.valueOf(LocalDateTime.now()));
            insert.executeUpdate();
        }
    }

    @Test
    @Order(1)
    @DisplayName("显式 appId=34 注册:行落 app_id=34(根因 fix 的核心断言)")
    void registerWithExplicitAppIdLandsOnTargetApp() {
        ToolRegistryEntry entry = registryService.register(command(
                "create_ticket", ACME_SERVER_KEY, "在 ACME 宿主系统中创建一张工单",
                TARGET_APP));

        assertThat(entry.getAppId()).isEqualTo(TARGET_APP);
        assertThat(entry.getFqn()).isEqualTo("mcp__acme-demo__create_ticket");

        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id FROM ia_tool_registry WHERE fqn = ?")) {
            statement.setString(1, "mcp__acme-demo__create_ticket");
            try (ResultSet resultSet = statement.executeQuery()) {
                assertThat(resultSet.next()).isTrue();
                assertThat(resultSet.getLong("app_id")).isEqualTo(TARGET_APP);
            }
        } catch (java.sql.SQLException sqlFailure) {
            throw new IllegalStateException(sqlFailure);
        }
    }

    @Test
    @Order(2)
    @DisplayName("管理面 POST ?appId=999(不存在):422 + 应用不存在 msg")
    void registerWithNonExistentAppIdRejectedByController() throws Exception {
        String body = """
                {
                  "serverKey": "acme-demo",
                  "toolName": "list_tickets",
                  "description": "列出 ACME 工单",
                  "source": "host_app",
                  "endpointUrl": "http://localhost:9300/ia-mcp"
                }
                """;
        mockMvc.perform(post("/ia/api/v1/admin/tools")
                        .param("appId", "999")
                        .contentType("application/json")
                        .header("X-IA-Admin-Key", ADMIN_KEY)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value(422))
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("应用不存在")));
    }

    @Test
    @Order(3)
    @DisplayName("不传 appId:行落 app_id=1(AppContext 缺省;向后兼容)")
    void registerWithoutAppIdFallsBackToDefaultApp() {
        ToolRegistryEntry entry = registryService.register(command(
                "unscoped_tool", "unscoped", "无显式 appId 的旧调用方",
                null));

        assertThat(entry.getAppId()).isEqualTo(DEFAULT_APP);
    }

    @Test
    @Order(4)
    @DisplayName("既有活跃行 appId=34,显式注册 appId=1:422(防串台,根因 fix 的核心断言)")
    void registerWithMismatchedAppIdReturns422() {
        // @Order(1) 注册了 create_ticket(appId=34);@BeforeEach 已清空,
        // 这里先注册建立活跃行,再以不同 appId 触发 422
        registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "基线:先以 appId=34 注册活跃行",
                TARGET_APP));

        assertThatThrownBy(() -> registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "尝试以 appId=1 串写——应被 422 拦下",
                1L)))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getCode()).isEqualTo(422);
                    assertThat(be.getMessage())
                            .contains("工具已注册到其他应用")
                            .contains("existingAppId=34")
                            .contains("requestedAppId=1");
                });
    }

    @Test
    @Order(5)
    @DisplayName("既有活跃行 appId=34,显式注册同 appId=34:409 幂等跳过(原行为保持)")
    void registerWithMatchingAppIdReturns409Idempotent() {
        registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "基线:appId=34 注册活跃行", TARGET_APP));

        assertThatThrownBy(() -> registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "重复注册同 appId——应被 409 幂等跳过",
                TARGET_APP)))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getCode()).isEqualTo(409);
                    assertThat(be.getMessage()).contains("工具已注册");
                });
    }

    @Test
    @Order(6)
    @DisplayName("不传 appId 注册既有行:409(向后兼容,旧调用方语义不变)")
    void registerWithoutAppIdOnExistingToolReturns409() {
        registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "基线:appId=34 注册活跃行", TARGET_APP));

        assertThatThrownBy(() -> registryService.register(command(
                "create_ticket", ACME_SERVER_KEY,
                "旧调用方无 appId 注册既有行——应 409",
                null)))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getCode()).isEqualTo(409);
                });
    }

    @Test
    @Order(7)
    @DisplayName("provision 路径:批量注册 4 工具全部落到 appId=34;"
            + " ToolRegistryService.list(serverKey=acme-demo) 全 appId=34 一致")
    void provisionPathLandsAllOnTargetApp() {
        String[] tools = {"create_ticket", "list_tickets", "resolve_scope", "query_sales"};
        for (String tool : tools) {
            registryService.register(command(
                    tool, ACME_SERVER_KEY,
                    "ACME 演示工具:" + tool,
                    TARGET_APP));
        }

        // 验证 list 行为:AppContext=34 行级拦截器叠加显式 appId 条件,
        // 命中 4 条
        List<ToolRegistryEntry> listed =
                AppContext.runInApp(TARGET_APP, () ->
                        registryService.list(ACME_SERVER_KEY, null));
        assertThat(listed).as("acme-demo 视角下应 4 条工具").hasSize(4);
        assertThat(listed)
                .extracting(ToolRegistryEntry::getAppId)
                .as("list 条目 appId 必须全部 =34")
                .containsOnly(TARGET_APP);
        assertThat(listed)
                .extracting(ToolRegistryEntry::getToolName)
                .as("覆盖 4 个宿主桥工具")
                .containsExactlyInAnyOrder(
                        "create_ticket", "list_tickets", "resolve_scope", "query_sales");

        // 直查 DB 验证整链:不依赖拦截器,直接 SELECT app_id
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id, server_key FROM ia_tool_registry "
                             + "WHERE server_key = ? AND deleted = FALSE")) {
            statement.setString(1, ACME_SERVER_KEY);
            try (ResultSet resultSet = statement.executeQuery()) {
                int rows = 0;
                while (resultSet.next()) {
                    rows++;
                    assertThat(resultSet.getLong("app_id"))
                            .as("server_key=acme-demo 行必须 app_id=34")
                            .isEqualTo(TARGET_APP);
                }
                assertThat(rows).as("acme-demo 应正好 4 行").isEqualTo(4);
            }
        } catch (java.sql.SQLException sqlFailure) {
            throw new IllegalStateException(sqlFailure);
        }
    }

    @Test
    @Order(8)
    @DisplayName("provision 路径:管理面 POST ?appId=34 端到端走通 4 工具注册")
    void provisionPathThroughAdminEndpoint() throws Exception {
        String[] tools = {"create_ticket", "list_tickets", "resolve_scope", "query_sales"};
        String endpoint = "http://localhost:9300/ia-mcp";
        for (String tool : tools) {
            String body = String.format("""
                    {
                      "serverKey": "acme-demo",
                      "toolName": "%s",
                      "description": "ACME 演示工具:%s",
                      "riskLevel": "low",
                      "source": "host_app",
                      "endpointUrl": "%s",
                      "parametersSchema": "{\\"type\\":\\"object\\"}"
                    }
                    """, tool, tool, endpoint);
            mockMvc.perform(post("/ia/api/v1/admin/tools")
                            .param("appId", String.valueOf(TARGET_APP))
                            .contentType("application/json")
                            .header("X-IA-Admin-Key", ADMIN_KEY)
                            .content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.appId").value(TARGET_APP))
                    .andExpect(jsonPath("$.data.fqn")
                            .value("mcp__acme-demo__" + tool));
        }
    }

    @Test
    @Order(9)
    @DisplayName("adminAppService.requireEntity422 契约:不存在 422 / 存在不抛")
    void appIdValidationHelperContract() {
        assertThatThrownBy(() -> adminAppService.requireEntity422(999L))
                .isInstanceOf(BusinessException.class)
                .satisfies(ex -> {
                    BusinessException be = (BusinessException) ex;
                    assertThat(be.getCode()).isEqualTo(422);
                });
        AppRegistration acme = adminAppService.requireEntity422(TARGET_APP);
        assertThat(acme.getAppKey()).isEqualTo(ACME_SERVER_KEY);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private static ToolRegistryService.RegisterCommand command(
            String toolName, String serverKey, String description, Long appId) {
        return new ToolRegistryService.RegisterCommand(
                serverKey, toolName, description,
                "{\"type\":\"object\"}",
                "{\"readOnlyHint\":true}",
                null, null, null, null,
                ToolRegistryService.SOURCE_HOST_APP,
                "http://localhost:9300/ia-mcp",
                "v1", true, appId);
    }

    private static Connection openConnection() throws java.sql.SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }
}
