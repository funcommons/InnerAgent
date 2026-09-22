package com.inneragent.db;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.core.toolkit.GlobalConfigUtils;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.inneragent.platform.config.AppTenantLineInnerInterceptor;
import com.inneragent.platform.config.MybatisPlusMetaHandler;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.skillhub.AppSkillCatalogService;
import com.inneragent.platform.skillhub.SkillHubProperties;
import com.inneragent.platform.skillhub.mapper.IaSkillFileMapper;
import com.inneragent.platform.skillhub.mapper.IaSkillMapper;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
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
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Skill/KB 管理面显式 appId 作用域守卫 IT(2026-09-23 修复回归,真库:
 * Testcontainers + Flyway + 编程式 MyBatis-Plus,AppTenantLineInterceptorIT 同风格)。
 *
 * <p>回归缺陷:X-IA-Admin-Key 管理面请求无线程 AppContext,行级拦截器按
 * 缺省注入 {@code app_id=1};ia_skill 不在 IGNORED_TABLES,显式 appId≠1 的
 * 管理面读写被叠加成 {@code app_id=34 AND app_id=1} 恒空——provision 落
 * 缺省应用,embed 运行态按宿主应用解析,技能注入静默失效。修复后管理面
 * 方法以系统模式执行(跳过注入),显式 appId 条件独自生效:
 * <ul>
 *   <li>无上下文 importSkill(appId=34):行落 app_id=34;</li>
 *   <li>无上下文 page(34) 能读到该行(修复前恒 0),page(1) 读不到;</li>
 *   <li>无上下文 activate 后,运行态 AppContext=34 的 activatedSkills 可见,
 *       AppContext=1 不可见(运行态隔离不弱化)。</li>
 * </ul>
 * 由 maven-failsafe-plugin 执行(类名 *IT 结尾)。
 */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SkillAdminAppScopeIT {

    private static final long TARGET_APP = 34L;

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("postgres:17-alpine"))
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    private static SqlSessionFactory sqlSessionFactory;
    private static AppSkillCatalogService skillService;

    @BeforeAll
    static void bootstrapMybatisPlus() {
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
        dbConfig.setLogicDeleteValue("true");
        dbConfig.setLogicNotDeleteValue("false");
        globalConfig.setDbConfig(dbConfig);
        globalConfig.setMetaObjectHandler(new MybatisPlusMetaHandler());
        GlobalConfigUtils.setGlobalConfig(configuration, globalConfig);

        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 与 MybatisPlusConfig 装配一致:行级拦截在最前,其后分页(page.total 依赖)
        interceptor.addInnerInterceptor(new AppTenantLineInnerInterceptor());
        interceptor.addInnerInterceptor(
                new com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor());
        configuration.addInterceptor(interceptor);

        configuration.addMapper(IaSkillMapper.class);
        configuration.addMapper(IaSkillFileMapper.class);
        sqlSessionFactory = new MybatisSqlSessionFactoryBuilder().build(configuration);

        // 单长会话(auto-commit)充当 mapper 宿主;行级注入靠拦截器,与
        // 上下文无关,service 内部不管理会话(生产由 MyBatis-Spring 代理)
        SqlSession session = sqlSessionFactory.openSession(true);
        skillService = new AppSkillCatalogService(
                new SkillHubProperties(),
                session.getMapper(IaSkillMapper.class),
                session.getMapper(IaSkillFileMapper.class),
                mock(ToolAuditService.class),
                new ObjectMapper());
    }

    @AfterAll
    static void releaseSession() {
        // 会话随进程结束释放(Testcontainers 容器由 JUnit 扩展管理)
    }

    @AfterEach
    void clearContexts() {
        AppContext.clear();
    }

    @Test
    @Order(1)
    @DisplayName("无上下文 importSkill(appId=34):行落 app_id=34")
    void importWithoutContextLandsOnExplicitApp() throws Exception {
        SkillHubProperties p = new SkillHubProperties();
        assertThat(p.getMaxActivePerApp()).isGreaterThan(0);

        AppSkillCatalogService.SkillView view = skillService.importSkill(
                TARGET_APP, "skills.zip", skillZip("report-style"),
                null, true, null);

        assertThat(view.appId()).isEqualTo(TARGET_APP);
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT app_id, status FROM ia_skill WHERE id = ?")) {
            statement.setLong(1, view.id());
            try (ResultSet resultSet = statement.executeQuery()) {
                assertThat(resultSet.next()).isTrue();
                assertThat(resultSet.getLong("app_id")).isEqualTo(TARGET_APP);
                assertThat(resultSet.getString("status")).isEqualTo("inactive");
            }
        }
    }

    @Test
    @Order(2)
    @DisplayName("无上下文 page(34) 可见目标应用行(修复前恒 0),page(1) 不可见")
    void pageWithoutContextHonorsExplicitAppScope() {
        var page34 = skillService.page(TARGET_APP, 1, 10);
        assertThat(page34.getTotal()).isEqualTo(1L);
        assertThat(page34.getList()).extracting(AppSkillCatalogService.SkillView::appId)
                .containsExactly(TARGET_APP);
        assertThat(skillService.page(1L, 1, 10).getList()).isEmpty();
    }

    @Test
    @Order(3)
    @DisplayName("无上下文 activate 后:运行态 AppContext=34 可见、AppContext=1 不可见")
    void activatedSkillVisibleOnlyToOwningAppRuntime() {
        AppSkillCatalogService.SkillView view =
                skillService.page(TARGET_APP, 1, 10).getList().get(0);
        AppSkillCatalogService.SkillView activated = skillService.activate(view.id(), null);
        assertThat(activated.active()).isTrue();

        AppContext.runInApp(TARGET_APP, () -> {
            assertThat(skillService.activatedSkills(TARGET_APP))
                    .extracting(AppSkillCatalogService.ActivatedSkill::name)
                    .containsExactly("report-style");
        });
        AppContext.runInApp(1L, () -> {
            assertThat(skillService.activatedSkills(1L)).isEmpty();
        });
    }

    @Test
    @Order(4)
    @DisplayName("无上下文同名覆盖重导入:幂等复用同行,不产生第二行")
    void overwriteReimportReusesSameRow() {
        AppSkillCatalogService.SkillView before =
                skillService.page(TARGET_APP, 1, 10).getList().get(0);
        AppSkillCatalogService.SkillView after = skillService.importSkill(
                TARGET_APP, "skills.zip", skillZip("report-style"),
                null, true, null);
        assertThat(after.id()).isEqualTo(before.id());
        assertThat(skillService.page(TARGET_APP, 1, 10).getTotal()).isEqualTo(1L);
    }

    // ------------------------------------------------------------------
    // fixtures
    // ------------------------------------------------------------------

    private static byte[] skillZip(String name) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("skill.json", ("{\"name\":\"" + name + "\",\"displayName\":\"报告写作\","
                + "\"description\":\"ACME 报告写作规范技能\",\"version\":\"1.0.0\"}")
                .getBytes(StandardCharsets.UTF_8));
        entries.put("SKILL.md", ("---\nname: " + name
                + "\ndescription: ACME 报告写作规范技能\n---\n\n按规范完成报告。\n")
                .getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zipStream = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                zipStream.putNextEntry(new ZipEntry(entry.getKey()));
                zipStream.write(entry.getValue());
                zipStream.closeEntry();
            }
        } catch (java.io.IOException failure) {
            throw new IllegalStateException(failure);
        }
        return output.toByteArray();
    }

    private static Connection openConnection() throws java.sql.SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }
}
