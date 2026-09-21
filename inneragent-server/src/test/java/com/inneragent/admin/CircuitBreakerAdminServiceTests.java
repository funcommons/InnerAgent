package com.inneragent.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.CancellationCoordinator;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import com.inneragent.platform.circuit.CircuitBreakerLimits;
import com.inneragent.platform.circuit.CircuitEvent;
import com.inneragent.platform.circuit.mapper.CircuitEventMapper;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import com.inneragent.agent.run.AgentRuntimeMetrics;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.server.admin.AppRegistration;
import com.inneragent.server.admin.CircuitBreakerAdminService;
import com.inneragent.server.admin.CircuitBreakerAdminService.CircuitEventView;
import com.inneragent.server.admin.CircuitBreakerAdminService.StateView;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.test.StepVerifier;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 熔断 admin 服务测试(优化建议 #2 服务端半):状态视图(mock 契约
 * CircuitBreakerState 形 + activeRuns)、limits 合并/校验/落库、紧急停用与
 * 恢复(总开关翻转 + 事件流水)、run 发起守卫 403、terminate-run 复用取消
 * 基建 + forced-policy 审计。mapper/协调器 mock,MockMvc 无关。
 */
class CircuitBreakerAdminServiceTests {

    private com.inneragent.server.admin.mapper.AppRegistrationMapper appMapper;
    private CircuitEventMapper circuitEventMapper;
    private AgentRunMapper runMapper;
    private CancellationCoordinator cancellations;
    private ToolAuditService auditService;
    private CircuitBreakerAdminService service;
    private AgentRuntimeSchedulers schedulers;

    @BeforeEach
    void setUp() {
        appMapper = mock(com.inneragent.server.admin.mapper.AppRegistrationMapper.class);
        circuitEventMapper = mock(CircuitEventMapper.class);
        runMapper = mock(AgentRunMapper.class);
        cancellations = mock(CancellationCoordinator.class);
        auditService = mock(ToolAuditService.class);
        AgentScopeRuntimeProperties properties = new AgentScopeRuntimeProperties();
        properties.setStateThreads(1);
        properties.setJournalThreads(1);
        properties.setModelThreads(1);
        properties.setToolThreads(1);
        schedulers = new AgentRuntimeSchedulers(properties, AgentRuntimeMetrics.noop());
        service = new CircuitBreakerAdminService(
                appMapper, circuitEventMapper, runMapper, cancellations,
                auditService, new ObjectMapper(), schedulers);
    }

    @AfterEach
    void tearDown() {
        schedulers.close();
        org.springframework.security.core.context.SecurityContextHolder.clearContext();
    }

    private static AppRegistration app(boolean stopped) {
        AppRegistration app = new AppRegistration();
        app.setId(1L);
        app.setAppKey("default");
        app.setName("默认应用");
        app.setCircuitStopped(stopped);
        app.setCircuitStopReason(stopped ? "成本异常" : null);
        app.setCircuitStoppedAt(stopped
                ? java.time.LocalDateTime.of(2026, 9, 20, 12, 0, 0) : null);
        app.setCircuitLimitsJson(null);
        return app;
    }

    @Test
    @DisplayName("状态视图:mock 契约形(emergencyStopped/stoppedAt/stopReason/limits/recentEvents)+ activeRuns")
    void stateReturnsContractShape() {
        when(appMapper.selectById(1L)).thenReturn(app(true));
        when(runMapper.selectCount(any())).thenReturn(3L);
        when(circuitEventMapper.selectList(any())).thenReturn(List.of());

        StateView view = service.state(1L);

        assertThat(view.emergencyStopped()).isTrue();
        assertThat(view.stoppedAt()).isEqualTo("2026-09-20T12:00:00Z");
        assertThat(view.stopReason()).isEqualTo("成本异常");
        // limits JSON 缺失 → §4.7 默认值兜底(8/20 核心护栏可读)
        assertThat(view.limits()).isEqualTo(CircuitBreakerLimits.DEFAULTS);
        assertThat(view.limits().mcpConcurrency()).isEqualTo(8);
        assertThat(view.limits().mcpQps()).isEqualTo(20);
        assertThat(view.activeRuns()).isEqualTo(3L);
        assertThat(view.recentEvents()).isEmpty();
    }

    @Test
    @DisplayName("应用不存在 → 404(状态/limits/停用/恢复一致)")
    void missingAppMapsTo404() {
        when(appMapper.selectById(9L)).thenReturn(null);

        assertThatThrownBy(() -> service.state(9L))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(404));
        assertThatThrownBy(() -> service.emergencyStop(9L, "x"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.resume(9L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("limits 部分更新:仅传入字段生效,合并全量回写 ia_app")
    void updateLimitsMergesPartialPatchAndPersists() {
        when(appMapper.selectById(1L)).thenReturn(app(false));
        CircuitBreakerLimits.PartialPatch patch = new CircuitBreakerLimits.PartialPatch(
                null, null, null, null, 16, 40, null);

        CircuitBreakerLimits merged = service.updateLimits(1L, patch);

        assertThat(merged.mcpConcurrency()).isEqualTo(16);
        assertThat(merged.mcpQps()).isEqualTo(40);
        assertThat(merged.maxToolCallsPerRun()).isEqualTo(32);
        ArgumentCaptor<AppRegistration> captor = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(captor.capture());
        CircuitBreakerLimits persisted = CircuitBreakerLimits.fromJson(
                new ObjectMapper(), captor.getValue().getCircuitLimitsJson());
        assertThat(persisted.mcpConcurrency()).isEqualTo(16);
        assertThat(persisted.mcpQps()).isEqualTo(40);
    }

    @Test
    @DisplayName("limits 全空 patch 回显当前配置不落库;越界值 400 不落库")
    void updateLimitsGuards() {
        when(appMapper.selectById(1L)).thenReturn(app(false));

        CircuitBreakerLimits unchanged = service.updateLimits(1L, new CircuitBreakerLimits.PartialPatch(
                null, null, null, null, null, null, null));
        assertThat(unchanged).isEqualTo(CircuitBreakerLimits.DEFAULTS);
        verify(appMapper, never()).updateById(any(AppRegistration.class));

        CircuitBreakerLimits.PartialPatch invalid = new CircuitBreakerLimits.PartialPatch(
                null, null, null, null, null, 0, null);
        assertThatThrownBy(() -> service.updateLimits(1L, invalid))
                .isInstanceOfSatisfying(BusinessException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(400);
                    assertThat(e.getMessage()).contains("mcpQps");
                });
        verify(appMapper, never()).updateById(any(AppRegistration.class));
    }

    @Test
    @DisplayName("紧急停用:reason 缺失 400;成功翻转总开关 + 落事件(mock 契约形)")
    void emergencyStopFlipsSwitchAndRecordsEvent() {
        when(appMapper.selectById(1L)).thenReturn(app(false));

        assertThatThrownBy(() -> service.emergencyStop(1L, "  "))
                .isInstanceOfSatisfying(BusinessException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(400);
                    assertThat(e.getMessage()).isEqualTo("reason 不能为空");
                });

        CircuitEventView view = service.emergencyStop(1L, " 成本异常 ");

        assertThat(view.type()).isEqualTo("emergency-stop");
        assertThat(view.runId()).isNull();
        assertThat(view.reason()).isEqualTo("成本异常");
        assertThat(view.operator()).isEqualTo("admin");
        ArgumentCaptor<AppRegistration> appCaptor = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(appCaptor.capture());
        assertThat(appCaptor.getValue().getCircuitStopped()).isTrue();
        assertThat(appCaptor.getValue().getCircuitStopReason()).isEqualTo("成本异常");
        assertThat(appCaptor.getValue().getCircuitStoppedAt()).isNotNull();
        ArgumentCaptor<CircuitEvent> eventCaptor = ArgumentCaptor.forClass(CircuitEvent.class);
        verify(circuitEventMapper).insert(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getType()).isEqualTo("emergency-stop");
        assertThat(eventCaptor.getValue().getAppId()).isEqualTo(1L);
    }

    @Test
    @DisplayName("恢复:清空停用三列 + 事件 reason 固定「人工恢复」(mock 契约)")
    void resumeClearsSwitchAndRecordsEvent() {
        when(appMapper.selectById(1L)).thenReturn(app(true));

        CircuitEventView view = service.resume(1L);

        assertThat(view.type()).isEqualTo("resume");
        assertThat(view.reason()).isEqualTo("人工恢复");
        ArgumentCaptor<AppRegistration> appCaptor = ArgumentCaptor.forClass(AppRegistration.class);
        verify(appMapper).updateById(appCaptor.capture());
        assertThat(appCaptor.getValue().getCircuitStopped()).isFalse();
        assertThat(appCaptor.getValue().getCircuitStoppedAt()).isNull();
        assertThat(appCaptor.getValue().getCircuitStopReason()).isNull();
    }

    @Test
    @DisplayName("run 发起守卫:停用中 403「应用已紧急停用」;未停用/应用缺失放行")
    void runStartGuardBlocksOnlyStoppedApps() {
        when(appMapper.selectById(1L)).thenReturn(app(true));

        assertThatThrownBy(() -> service.assertRunStartAllowed(1L))
                .isInstanceOfSatisfying(BusinessException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(403);
                    assertThat(e.getMessage()).contains("应用已紧急停用").contains("成本异常");
                });

        when(appMapper.selectById(1L)).thenReturn(app(false));
        service.assertRunStartAllowed(1L);

        when(appMapper.selectById(2L)).thenReturn(null);
        service.assertRunStartAllowed(2L);
    }

    @Test
    @DisplayName("terminate-run:参数缺失 400;run 缺失 404;终态 409;成功走取消基建+审计 forced-policy")
    void terminateRunReusesCancellationInfrastructure() {
        when(appMapper.selectById(1L)).thenReturn(app(false));
        assertThatThrownBy(() -> service.terminateRun(1L, " ", "x"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.terminateRun(1L, "run-1", null))
                .isInstanceOf(BusinessException.class);

        when(runMapper.selectByRunId("run-404")).thenReturn(null);
        assertThatThrownBy(() -> service.terminateRun(1L, "run-404", "违规操作"))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(404));

        when(runMapper.selectByRunId("run-done"))
                .thenReturn(runningRun("run-done", AgentRunStatus.COMPLETED));
        assertThatThrownBy(() -> service.terminateRun(1L, "run-done", "违规操作"))
                .isInstanceOfSatisfying(BusinessException.class, e ->
                        assertThat(e.getCode()).isEqualTo(409));

        AgentRun live = runningRun("run-live", AgentRunStatus.RUNNING);
        when(runMapper.selectByRunId("run-live")).thenReturn(live);
        when(cancellations.request("run-live"))
                .thenReturn(reactor.core.publisher.Mono.empty());

        StepVerifier.create(service.terminateRun(1L, "run-live", " 违规操作 "))
                .assertNext(view -> {
                    assertThat(view.type()).isEqualTo("run-terminated");
                    assertThat(view.runId()).isEqualTo("run-live");
                    assertThat(view.reason()).isEqualTo("违规操作");
                })
                .verifyComplete();

        verify(cancellations).request("run-live");
        ArgumentCaptor<ToolAuditService.ToolAuditEntry> auditCaptor =
                ArgumentCaptor.forClass(ToolAuditService.ToolAuditEntry.class);
        verify(auditService).append(auditCaptor.capture());
        assertThat(auditCaptor.getValue().decision()).isEqualTo("run-terminated");
        assertThat(auditCaptor.getValue().decisionSource()).isEqualTo("forced-policy");
        assertThat(auditCaptor.getValue().runId()).isEqualTo("run-live");
        assertThat(auditCaptor.getValue().resultSummary()).contains("管理员强制终止").contains("违规操作");
        verify(circuitEventMapper).insert(any(CircuitEvent.class));
    }

    @Test
    @DisplayName("取消基建失败时事件与审计不落(错误透传)")
    void terminateRunPropagatesCancellationFailure() {
        when(appMapper.selectById(1L)).thenReturn(app(false));
        when(runMapper.selectByRunId("run-x"))
                .thenReturn(runningRun("run-x", AgentRunStatus.RUNNING));
        when(cancellations.request("run-x"))
                .thenReturn(reactor.core.publisher.Mono.error(
                        new BusinessException(404, "Agent 运行不存在")));

        StepVerifier.create(service.terminateRun(1L, "run-x", "reason"))
                .expectError(BusinessException.class)
                .verify();

        verify(auditService, never()).append(any());
        verify(circuitEventMapper, never()).insert(any(CircuitEvent.class));
    }

    @Test
    @DisplayName("操作者:管理会话通道取用户名,无 SecurityContext 缺省 admin")
    void operatorFallsBackToAdminForBootstrapChannel() {
        when(appMapper.selectById(1L)).thenReturn(app(false));

        CircuitEventView view = service.emergencyStop(1L, "演练");
        assertThat(view.operator()).isEqualTo("admin");

        org.springframework.security.core.context.SecurityContextHolder.getContext()
                .setAuthentication(new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        "ops-admin", null, java.util.List.of()));
        try {
            CircuitEventView sessionView = service.emergencyStop(1L, "演练");
            assertThat(sessionView.operator()).isEqualTo("ops-admin");
        } finally {
            org.springframework.security.core.context.SecurityContextHolder.clearContext();
        }
    }

    private static AgentRun runningRun(String runId, AgentRunStatus status) {
        return AgentRun.builder()
                .runId(runId)
                .conversationId("conv-1")
                .userId(42L)
                .agentType("demo")
                .kernelFingerprint("fp")
                .agentDefinitionSnapshotJson("{}")
                .agentStateSessionId("session")
                .status(status.name())
                .deadlineAt(java.time.LocalDateTime.now().plusMinutes(5))
                .startedAt(java.time.LocalDateTime.now())
                .build();
    }
}
