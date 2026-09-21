package com.inneragent.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.auth.support.EmbedTokenTestSupport;
import com.inneragent.platform.circuit.CircuitBreakerLimits;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.admin.CircuitBreakerAdminService;
import com.inneragent.server.admin.WebhookConfigAdminService;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.security.KeyPair;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * DEF-08 永久守卫(R3 验证轮):ia_app 共享实体行 UPDATE 全写路径在
 * <strong>真实 PostgreSQL</strong> 上必须可用——熔断列(V14)入行后,
 * 公钥轮换/limits 保存/Webhook 配置保存/紧急停用/恢复均经
 * selectById → 改字段 → updateById 整行更新,circuit_limits_json 列随行。
 *
 * <p><strong>为何此前的 IT 没拦住</strong>:Testcontainers IT 普遍经
 * {@code AgentRuntimeContainers.postgresJdbcUrl} / StorageConfigServiceIT 给
 * 连接串追加 {@code stringtype=unspecified},而运行态 application.yml 没有——
 * 该参数掩盖了 MySQL 形 {@code JsonbTypeHandler}(ps.setString → varchar)在
 * 真实 PG jsonb 列上的绑定失败(R3 DEF-08:ia_app 行任何 UPDATE 全链 500)。
 * <strong>本类刻意不加该参数</strong>,连接串与运行态 application.yml 同形:
 * 一旦有人再把该列改回 JSONB+字符串直写(或新增共享实体 JSONB 列走同款
 * handler),此处即以运行态同款失败报警。
 *
 * <p>覆盖五条写路径(DEF-08 缺陷清单全部端点的 service 层入口):
 * AdminAppService.update(轮换)、CircuitBreakerAdminService.updateLimits、
 * WebhookConfigAdminService.save、emergencyStop/resume;并断言列类型为
 * TEXT(V15 取舍:零 PG 方言耦合,序列化收敛在 CircuitBreakerLimits)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class AppRegistrationWritePathsIT {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            "postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        // 运行态同形连接串:刻意不加 stringtype=unspecified(见类注释,DEF-08 守卫核心)
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> "app-write-node");
    }

    @Autowired
    private AdminAppService adminAppService;

    @Autowired
    private CircuitBreakerAdminService circuitService;

    @Autowired
    private WebhookConfigAdminService webhookConfigService;

    @Autowired
    private AppRegistrationMapper appMapper;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void circuitLimitsColumnIsPlainTextWithoutPgDialectCoupling() throws Exception {
        assertThat(columnType("ia_app", "circuit_limits_json"))
                .as("V15 应将 ia_app.circuit_limits_json 定为 TEXT(实体纯 String,"
                        + "序列化在服务层;JSONB+MySQL 形 handler 即 DEF-08 根因)")
                .isEqualTo("text");
    }

    @Test
    void keyRotationUpdatesAppRowAlongsideCircuitColumns() {
        AppRegistration app = registerProbeApp("it-rotate");
        String originalPem = app.getSignPublicKey();
        String rotatedPem = toPemOfFreshKey();

        // 轮换即「selectById 整行 → 改公钥 → updateById」:V14 入行后即 DEF-08 首个回归面
        adminAppService.update(app.getId(), null, rotatedPem, null, null, null);

        AppRegistration reloaded = appMapper.selectById(app.getId());
        assertThat(reloaded.getSignPublicKey()).isEqualTo(rotatedPem);
        assertThat(reloaded.getPreviousSignPublicKey()).isEqualTo(originalPem);
        assertThat(reloaded.getSignKeyRotatedAt()).isNotNull();
        // 熔断/Webhook 列不受轮换牵连(DEF-08 时代的失败即整行更新连坐)
        assertThat(reloaded.getCircuitStopped()).isFalse();
        assertThat(reloaded.getWebhookEnabled()).isTrue();
    }

    @Test
    void limitsSavePersistsMergedJsonOnAppRow() {
        AppRegistration app = registerProbeApp("it-limits");

        CircuitBreakerLimits merged = circuitService.updateLimits(
                app.getId(),
                new CircuitBreakerLimits.PartialPatch(null, null, null, null, 16, 40, null));

        assertThat(merged.mcpConcurrency()).isEqualTo(16);
        assertThat(merged.mcpQps()).isEqualTo(40);
        AppRegistration reloaded = appMapper.selectById(app.getId());
        // TEXT 列直存服务层序列化 JSON(无 jsonb 规范化,逐字节可断言)
        assertThat(reloaded.getCircuitLimitsJson())
                .isEqualTo(merged.toJson(objectMapper));
        CircuitBreakerLimits reparsed = CircuitBreakerLimits.fromJson(
                objectMapper, reloaded.getCircuitLimitsJson());
        assertThat(reparsed.mcpConcurrency()).isEqualTo(16);
        assertThat(reparsed.mcpQps()).isEqualTo(40);
        // 未传入字段保持 §4.7 默认(部分合并语义)
        assertThat(reparsed.maxToolCallsPerRun()).isEqualTo(32);
        assertThat(reparsed.confirmTimeoutHours()).isEqualTo(24);
    }

    @Test
    void webhookConfigSavePersistsOnAppRow() {
        AppRegistration app = registerProbeApp("it-webhook");

        WebhookConfigAdminService.ConfigView view = webhookConfigService.save(
                app.getId(),
                new WebhookConfigAdminService.SaveReq(
                        "https://hook.example/end", "whsec-it-1", false,
                        List.of("run.finished", "run.failed")));

        assertThat(view.enabled()).isFalse();
        assertThat(view.events()).containsExactly("run.finished", "run.failed");
        AppRegistration reloaded = appMapper.selectById(app.getId());
        assertThat(reloaded.getWebhookUrl()).isEqualTo("https://hook.example/end");
        assertThat(reloaded.getWebhookEnabled()).isFalse();
        assertThat(reloaded.getWebhookEvents()).isEqualTo("run.finished,run.failed");
        // secret write-only 仅响应面:库内落明文
        assertThat(reloaded.getWebhookSecret()).isEqualTo("whsec-it-1");
    }

    @Test
    void emergencyStopAndResumeUpdateAppRowAndGuardRunStart() {
        AppRegistration app = registerProbeApp("it-stop");

        CircuitBreakerAdminService.CircuitEventView stop = AppContext.runInApp(
                app.getId(),
                () -> circuitService.emergencyStop(app.getId(), "IT 紧急停用探针"));
        // IT 无管理会话:引导通道缺省 admin(V14 DDL operator 口径)
        assertThat(stop.operator()).isEqualTo("admin");
        AppRegistration stopped = appMapper.selectById(app.getId());
        assertThat(stopped.getCircuitStopped()).isTrue();
        assertThat(stopped.getCircuitStopReason()).isEqualTo("IT 紧急停用探针");
        assertThatThrownBy(() -> circuitService.assertRunStartAllowed(app.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("应用已紧急停用");

        CircuitBreakerAdminService.CircuitEventView resume = AppContext.runInApp(
                app.getId(),
                () -> circuitService.resume(app.getId()));
        assertThat(resume.type()).isEqualTo("resume");
        AppRegistration resumed = appMapper.selectById(app.getId());
        assertThat(resumed.getCircuitStopped()).isFalse();
        assertThat(resumed.getCircuitStoppedAt()).isNull();
        assertThat(resumed.getCircuitStopReason()).isNull();
    }

    // ------------------------------------------------------------------
    // 脚手架
    // ------------------------------------------------------------------

    /** 注册探针应用(register 即 ia_app INSERT 路径,亦在守卫面内)。 */
    private AppRegistration registerProbeApp(String purpose) {
        String appKey = purpose + "-" + UUID.randomUUID().toString().substring(0, 8);
        AdminAppService.AppView view =
                adminAppService.register(appKey, "IT 探针-" + purpose, toPemOfFreshKey(), null, null);
        return appMapper.selectById(view.id());
    }

    private static String toPemOfFreshKey() {
        KeyPair keyPair = EmbedTokenTestSupport.generateKeyPair();
        return EmbedTokenTestSupport.toPem(keyPair.getPublic());
    }

    private String columnType(String table, String column) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
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
