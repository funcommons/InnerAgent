package com.inneragent.db;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.core.toolkit.GlobalConfigUtils;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.inneragent.agent.entity.AgentConversation;
import com.inneragent.agent.mapper.AgentConversationMapper;
import com.inneragent.platform.config.AppTenantLineInnerInterceptor;
import com.inneragent.platform.config.MybatisPlusMetaHandler;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.tenant.TenantContext;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * app_id + tenant_id 双列行级拦截器行为测试(P1-T1,FlywayMigrationSmokeIT 同风格:
 * Testcontainers PostgreSQL,编程式装配 MyBatis-Plus,不启动 Spring)。
 *
 * <p>断言矩阵:
 * <ul>
 *   <li>INSERT 无上下文:回填 app_id=1(单应用默认),tenant 不注入(落 DDL 默认 0);</li>
 *   <li>INSERT 带 AppContext(3)+TenantContext(7):回填 app_id=3、tenant_id=7;</li>
 *   <li>SELECT 系统模式(无上下文):不拼租户条件,仍按 app_id=1 过滤;</li>
 *   <li>SELECT 带双层上下文:app_id=3 AND tenant_id=7 双条件过滤。</li>
 * </ul>
 * 由 maven-failsafe-plugin 执行(类名 *IT 结尾)。
 */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AppTenantLineInterceptorIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("postgres:17-alpine"))
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    private static SqlSessionFactory sqlSessionFactory;

    @BeforeAll
    static void bootstrapMybatisPlus() throws Exception {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        DataSource dataSource = new UnpooledDataSource(
                POSTGRES.getDriverClassName(), POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(), POSTGRES.getPassword());
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setEnvironment(new Environment(
                "test", new JdbcTransactionFactory(), dataSource));
        configuration.setMapUnderscoreToCamelCase(true);
        GlobalConfig globalConfig = new GlobalConfig();
        globalConfig.setBanner(false);
        GlobalConfig.DbConfig dbConfig = new GlobalConfig.DbConfig();
        // 与 application.yml 一致:逻辑删除取值 true/false(PG BOOLEAN 列)
        dbConfig.setLogicDeleteValue("true");
        dbConfig.setLogicNotDeleteValue("false");
        globalConfig.setDbConfig(dbConfig);
        // createTime/updateTime 自动填充,与 MybatisPlusMetaHandler 一致
        globalConfig.setMetaObjectHandler(new MybatisPlusMetaHandler());
        GlobalConfigUtils.setGlobalConfig(configuration, globalConfig);

        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 与 MybatisPlusConfig 装配一致:双列行级拦截在最前
        interceptor.addInnerInterceptor(new AppTenantLineInnerInterceptor());
        configuration.addInterceptor(interceptor);

        // 编程式装配下手动注册 mapper(触发 TableInfo 初始化)
        configuration.addMapper(AgentConversationMapper.class);
        sqlSessionFactory = new com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder()
                .build(configuration);
    }

    @AfterEach
    void clearContexts() {
        TenantContext.clear();
        AppContext.clear();
    }

    @Test
    @Order(1)
    @DisplayName("INSERT 无上下文:回填 app_id=1,tenant 落 DDL 默认 0")
    void insertWithoutContextFallsBackToDefaultApp() throws SQLException {
        try (SqlSession session = sqlSessionFactory.openSession(true)) {
            AgentConversationMapper mapper = session.getMapper(AgentConversationMapper.class);
            mapper.insert(conversation("conv-no-context", 100L));
        }

        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id, tenant_id FROM ia_agent_conversation "
                             + "WHERE conversation_id = 'conv-no-context'");
             ResultSet resultSet = statement.executeQuery()) {
            assertThat(resultSet.next()).isTrue();
            assertThat(resultSet.getLong("app_id")).isEqualTo(1L);
            assertThat(resultSet.getLong("tenant_id")).isZero();
        }
    }

    @Test
    @Order(2)
    @DisplayName("INSERT 带双层上下文:回填 app_id=3、tenant_id=7")
    void insertWithContextWritesBothColumns() throws SQLException {
        TenantContext.runInTenant(7L, () -> AppContext.runInApp(3L, () -> {
            try (SqlSession session = sqlSessionFactory.openSession(true)) {
                AgentConversationMapper mapper = session.getMapper(AgentConversationMapper.class);
                mapper.insert(conversation("conv-with-context", 200L));
            }
        }));

        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id, tenant_id FROM ia_agent_conversation "
                             + "WHERE conversation_id = 'conv-with-context'");
             ResultSet resultSet = statement.executeQuery()) {
            assertThat(resultSet.next()).isTrue();
            assertThat(resultSet.getLong("app_id")).isEqualTo(3L);
            assertThat(resultSet.getLong("tenant_id")).isEqualTo(7L);
        }
    }

    @Test
    @Order(3)
    @DisplayName("SELECT 系统模式(无上下文):不拼租户条件,仍按 app_id=1 过滤")
    void systemSelectAppliesDefaultAppAndSkipsTenant() {
        try (SqlSession session = sqlSessionFactory.openSession(true)) {
            AgentConversationMapper mapper = session.getMapper(AgentConversationMapper.class);
            List<AgentConversation> visible = mapper.selectList(
                    new LambdaQueryWrapper<AgentConversation>()
                            .eq(AgentConversation::getConversationId, "conv-no-context"));
            List<AgentConversation> hidden = mapper.selectList(
                    new LambdaQueryWrapper<AgentConversation>()
                            .eq(AgentConversation::getConversationId, "conv-with-context"));
            assertThat(visible).hasSize(1);
            // app-3 行在缺省 app_id=1 过滤下不可见(隔离不因系统模式弱化)
            assertThat(hidden).isEmpty();
        }
    }

    @Test
    @Order(4)
    @DisplayName("SELECT 带双层上下文:app_id=3 AND tenant_id=7 双条件过滤")
    void selectWithContextFiltersBothColumns() {
        TenantContext.runInTenant(7L, () -> AppContext.runInApp(3L, () -> {
            try (SqlSession session = sqlSessionFactory.openSession(true)) {
                AgentConversationMapper mapper = session.getMapper(AgentConversationMapper.class);
                List<AgentConversation> visible = mapper.selectList(
                        new LambdaQueryWrapper<AgentConversation>()
                                .eq(AgentConversation::getConversationId, "conv-with-context"));
                List<AgentConversation> hidden = mapper.selectList(
                        new LambdaQueryWrapper<AgentConversation>()
                                .eq(AgentConversation::getConversationId, "conv-no-context"));
                assertThat(visible).hasSize(1);
                assertThat(visible.getFirst().getTenantId()).isEqualTo(7L);
                // 租户条件生效:tenant-0 的缺省应用行在租户 7 下不可见
                assertThat(hidden).isEmpty();
            }
        }));
    }

    @Test
    @Order(5)
    @DisplayName("租户错配不可见:租户 8 查不到租户 7 的行")
    void wrongTenantSeesNothing() {
        TenantContext.runInTenant(8L, () -> AppContext.runInApp(3L, () -> {
            try (SqlSession session = sqlSessionFactory.openSession(true)) {
                AgentConversationMapper mapper = session.getMapper(AgentConversationMapper.class);
                List<AgentConversation> rows = mapper.selectList(
                        new LambdaQueryWrapper<AgentConversation>()
                                .eq(AgentConversation::getConversationId, "conv-with-context"));
                assertThat(rows).isEmpty();
            }
        }));
    }

    private static AgentConversation conversation(String conversationId, long userId) {
        return AgentConversation.builder()
                .conversationId(conversationId)
                .userId(userId)
                .title("拦截器 IT")
                .status("running")
                .messageCount(0)
                .nextMessageOrder(1L)
                .build();
    }

    private static Connection openConnection() throws SQLException {
        return java.sql.DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }
}
