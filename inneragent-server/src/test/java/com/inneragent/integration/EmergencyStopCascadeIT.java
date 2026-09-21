package com.inneragent.integration;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.auth.support.EmbedTokenTestSupport;
import com.inneragent.agent.conversation.AgentConversationService;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.run.AgentRunCoordinator;
import com.inneragent.agent.run.AgentRunRedisSignalService;
import com.inneragent.agent.run.CancellationCoordinator;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.agent.run.kernel.AgentKernelSnapshotPayload;
import com.inneragent.agent.run.kernel.CanonicalAgentKernelSnapshotBuilder;
import com.inneragent.agent.run.model.StartAgentRunCommand;
import com.inneragent.agent.run.model.StartedAgentRun;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.server.admin.AdminAppService;
import com.inneragent.server.admin.CircuitBreakerAdminService;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.security.KeyPair;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 紧急停用级联取消在途运行(收尾批次 P2 缺口收口;真实 PostgreSQL +
 * Testcontainers,复用 P4 子 Agent 批次取消测试基建,同
 * {@code AgentFencingCancellationIT} 形态)。
 *
 * <p>语义收口:紧急停用(应用级总开关)此前只挡新 run(assertRunStartAllowed
 * 403),在途 run 继续跑,违背「停用即生效」的运维直觉。现停用动作触发时对
 * 该应用全部活跃运行发起取消——复用 {@link CancellationCoordinator} 既有取消链
 * (CANCEL_REQUESTED → Redis 信号 → 本实例终态化/跨实例中断),异步尽力而为:
 * 接口同步返回停用成功 + {@code counts.cancelInitiated};单 run 失败由既有
 * 兜底扫描收敛,不连坐停用响应。
 *
 * <p>覆盖四面:停用后新 run 被拒(403)、停用应用的在途运行收到取消并终态化、
 * 取消按 app 隔离(其他应用的在途运行不受牵连)、无在途运行时 counts=0 不空指。
 * 运行状态/app_id 断言走裸 JDBC(绕开行级拦截器的 AppContext 注入,与被测
 * 上下文解耦)。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers(disabledWithoutDocker = false)
class EmergencyStopCascadeIT {

    private static final long USER_ID = 42L;
    private static final long PROJECT_ID = 77L;
    private static final String INSTANCE_ID = "emergency-node-a";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("inneragent")
            .withUsername("inneragent")
            .withPassword("inneragent");

    @DynamicPropertySource
    static void configureDatabase(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        properties.add("spring.datasource.username", POSTGRES::getUsername);
        properties.add("spring.datasource.password", POSTGRES::getPassword);
        properties.add("fusion.agentscope.v2.state.mode", () -> "IN_MEMORY");
        properties.add("fusion.agentscope.v2.execution.instance-id", () -> INSTANCE_ID);
        properties.add(
                "fusion.agentscope.v2.execution.maintenance-initial-delay-ms",
                () -> "3600000");
        properties.add(
                "fusion.agentscope.v2.execution.maintenance-delay-ms",
                () -> "3600000");
    }

    @Autowired
    private CircuitBreakerAdminService circuitService;

    @Autowired
    private AgentRunCoordinator coordinator;

    @Autowired
    private AgentConversationService conversationService;

    @Autowired
    private AgentRunMapper runMapper;

    @Autowired
    private AdminAppService adminAppService;

    @Autowired
    private AppRegistrationMapper appMapper;

    @MockitoBean
    private AgentRunRedisSignalService signals;

    @BeforeEach
    void configureSignals() {
        when(signals.publishCancel(anyString())).thenReturn(Mono.empty());
        when(signals.publishWakeup(anyString(), anyLong())).thenReturn(Mono.empty());
        when(signals.cancellations(anyString())).thenReturn(Flux.never());
    }

    @Test
    void emergencyStopCancelsInFlightRunsOfTheAppAndScopesByApp() {
        // 停用目标:单应用缺省 app 1(V4 种子行);对照:显式注册的 app 2
        StartedAgentRun first = startRoot("stop-first", INSTANCE_ID);
        StartedAgentRun second = startRoot("stop-second", INSTANCE_ID);

        long otherAppId = registerProbeApp("it-esc-app2");
        StartedAgentRun otherAppRun = AppContext.runInApp(
                otherAppId, () -> startRoot("other-app", INSTANCE_ID));

        // 行级注入随 AppContext 落对了 app(裸 JDBC 断言,AgentRun 实体不映射 app_id)
        assertThat(dbAppId(first.runId())).isEqualTo(1L);
        assertThat(dbAppId(otherAppRun.runId())).isEqualTo(otherAppId);
        // 新 mapper 查询的 app 隔离口径(上下文内调用,注入条件同值)
        assertThat(AppContext.runInApp(1L, () -> runMapper.selectActiveRunsByApp(1L)))
                .extracting(com.inneragent.agent.entity.AgentRun::getRunId)
                .containsExactlyInAnyOrder(first.runId(), second.runId());
        assertThat(AppContext.runInApp(otherAppId, () -> runMapper.selectActiveRunsByApp(otherAppId)))
                .extracting(com.inneragent.agent.entity.AgentRun::getRunId)
                .containsExactly(otherAppRun.runId());

        AtomicReference<CircuitBreakerAdminService.EmergencyStopView> stop =
                new AtomicReference<>();
        AppContext.runInApp(1L, () -> stop.set(
                circuitService.emergencyStop(1L, "IT 级联取消探针")));

        // 停用响应:事件形 + 已发起取消计数(两个 app 1 在途运行)
        assertThat(stop.get().type()).isEqualTo("emergency-stop");
        assertThat(stop.get().counts().cancelInitiated()).isEqualTo(2);
        // 新 run 守卫立即生效(停用同步语义)
        assertThatThrownBy(() -> circuitService.assertRunStartAllowed(1L))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("应用已紧急停用");

        // 在途运行收到取消并终态化(本实例 owned → 取消链本地终态化,异步收敛)
        await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> {
            assertThat(dbStatus(first.runId())).isEqualTo(AgentRunStatus.CANCELLED.name());
            assertThat(dbStatus(second.runId())).isEqualTo(AgentRunStatus.CANCELLED.name());
        });
        // 取消按 app 隔离:其他应用的在途运行不受牵连
        assertThat(dbStatus(otherAppRun.runId())).isEqualTo(AgentRunStatus.RUNNING.name());

        // 恢复:仅翻回总开关(已取消运行不追回)
        CircuitBreakerAdminService.CircuitEventView resume = AppContext.runInApp(
                1L, () -> circuitService.resume(1L));
        assertThat(resume.type()).isEqualTo("resume");
        assertThat(appMapper.selectById(1L).getCircuitStopped()).isFalse();
        assertThat(dbStatus(first.runId())).isEqualTo(AgentRunStatus.CANCELLED.name());
    }

    @Test
    void emergencyStopWithoutActiveRunsStillStopsAndReportsZeroCounts() {
        AppContext.runInApp(1L, () -> {
            CircuitBreakerAdminService.EmergencyStopView stop =
                    circuitService.emergencyStop(1L, "无在途运行演练");
            assertThat(stop.type()).isEqualTo("emergency-stop");
            assertThat(stop.counts().cancelInitiated()).isZero();
        });
        assertThatThrownBy(() -> circuitService.assertRunStartAllowed(1L))
                .isInstanceOf(BusinessException.class);
        AppContext.runInApp(1L, () -> circuitService.resume(1L));
    }

    // ------------------------------------------------------------------
    // 脚手架(照 AgentFencingCancellationIT;run 行 app_id 随 AppContext 注入)
    // ------------------------------------------------------------------

    private StartedAgentRun startRoot(String prefix, String owner) {
        String conversationId = unique("conversation-" + prefix);
        conversationService.createOrUpdate(
                conversationId,
                USER_ID,
                PROJECT_ID,
                "project",
                PROJECT_ID,
                "assistant",
                "emergency stop cascade test",
                "chat");
        Instant deadline = Instant.now().plus(Duration.ofMinutes(2))
                .truncatedTo(ChronoUnit.MILLIS);
        return blockMono(coordinator.start(new StartAgentRunCommand(
                unique("run-" + prefix),
                conversationId,
                USER_ID,
                PROJECT_ID,
                "assistant",
                null,
                null,
                null,
                unique("session-" + prefix),
                snapshot("assistant"),
                owner,
                Duration.ofSeconds(30),
                deadline,
                "run",
                null)));
    }

    private AgentKernelSnapshot snapshot(String stableKey) {
        return new CanonicalAgentKernelSnapshotBuilder().build(
                new AgentKernelSnapshotPayload(
                        AgentKernelSnapshotPayload.CURRENT_SCHEMA_VERSION,
                        stableKey,
                        stableKey,
                        "test",
                        "system",
                        5,
                        "1",
                        1,
                        "openai",
                        "test-model",
                        JsonNodeFactory.instance.objectNode(),
                        List.of(),
                        "test"));
    }

    /** 注册探针应用(ia_app 行 id 即 app_id;AppRegistrationWritePathsIT 同款)。 */
    private long registerProbeApp(String purpose) {
        String appKey = purpose + "-" + UUID.randomUUID().toString().substring(0, 8);
        AdminAppService.AppView view = adminAppService.register(
                appKey, "IT 探针-" + purpose, toPemOfFreshKey(), null, null);
        return view.id();
    }

    private static String toPemOfFreshKey() {
        KeyPair keyPair = EmbedTokenTestSupport.generateKeyPair();
        return EmbedTokenTestSupport.toPem(keyPair.getPublic());
    }

    /** 裸 JDBC 读运行状态(绕开行级拦截器的 AppContext 注入)。 */
    private String dbStatus(String runId) {
        return dbString("SELECT status FROM ia_agent_run WHERE run_id = ?", runId);
    }

    /** 裸 JDBC 读运行行 app_id(AgentRun 实体不映射该列,行级注入落值核验用)。 */
    private long dbAppId(String runId) {
        return Long.parseLong(dbString("SELECT app_id FROM ia_agent_run WHERE run_id = ?", runId));
    }

    private String dbString(String sql, String runId) {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, runId);
            try (ResultSet resultSet = statement.executeQuery()) {
                assertThat(resultSet.next()).as("run 行应存在: " + runId).isTrue();
                return resultSet.getString(1);
            }
        } catch (Exception exception) {
            throw new IllegalStateException("裸 JDBC 查询失败: " + sql, exception);
        }
    }

    private <T> T blockMono(Mono<T> publisher) {
        return publisher.block(Duration.ofSeconds(15));
    }

    private static String unique(String prefix) {
        return prefix + '-' + UUID.randomUUID().toString().replace("-", "");
    }
}
