package com.inneragent.agent.run;

import com.inneragent.platform.config.AgentScopeV2Properties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import com.inneragent.platform.tenant.TenantContext;

/** Periodic lease heartbeat, cancellation retry, and expired-owner convergence. */
@Component
@Slf4j
public final class AgentRunMaintenanceScheduler {

    private static final int BATCH_SIZE = 100;

    private final OwnedExecutionRegistry executions;
    private final RunLeaseGuard leases;
    private final AgentRunReconciliationService reconciliation;
    private final CancellationCoordinator cancellations;
    private final AgentMessageProjectionService projections;
    private final Duration ownerLease;
    private final AtomicBoolean running = new AtomicBoolean();

    public AgentRunMaintenanceScheduler(
            OwnedExecutionRegistry executions,
            RunLeaseGuard leases,
            AgentRunReconciliationService reconciliation,
            CancellationCoordinator cancellations,
            AgentMessageProjectionService projections,
            AgentScopeV2Properties properties) {
        this.executions = Objects.requireNonNull(
                executions, "executions must not be null");
        this.leases = Objects.requireNonNull(leases, "leases must not be null");
        this.reconciliation = Objects.requireNonNull(
                reconciliation, "reconciliation must not be null");
        this.cancellations = Objects.requireNonNull(
                cancellations, "cancellations must not be null");
        this.projections = Objects.requireNonNull(
                projections, "projections must not be null");
        this.ownerLease = Objects.requireNonNull(
                properties, "properties must not be null")
                .getExecution()
                .getOwnerLease();
    }

    @Scheduled(
            initialDelayString =
                    "${fusion.agentscope.v2.execution.maintenance-initial-delay-ms:10000}",
            fixedDelayString =
                    "${fusion.agentscope.v2.execution.maintenance-delay-ms:5000}")
    public void maintain() {
        // 定时任务线程天然跨租户跨应用：统一以系统模式执行(租户+应用行级
        // 注入均跳过,AppContext.runAsSystem 与 TenantContext.runAsSystem 对齐;
        // 调度器传播器会延续系统身份到 journal 线程)。此前只跳过租户,应用列
        // 仍按缺省 1 注入——多应用部署下 app≠1 的运行租约收敛/取消重试/投影
        // 恢复扫描全部扫不到(多应用运行 500 二轮根修顺带修正)。
        TenantContext.runAsSystem(() ->
                com.inneragent.platform.context.AppContext.runAsSystem(
                        this::domaintain));
    }

    void domaintain() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        maintainOnce()
                .doFinally(ignored -> running.set(false))
                .subscribe(
                        ignored -> { },
                        failure -> log.error(
                                "Agent run maintenance failed: type={}",
                                failure.getClass().getSimpleName(),
                                failure));
    }

    public Mono<Void> maintainOnce() {
        return heartbeatOwned()
                .then(reconciliation.reconcileBatch(BATCH_SIZE))
                .then(cancellations.retryBatch(BATCH_SIZE))
                // [adapt] P4-W14:父已终态而子运行仍活跃的孤儿兜底(级联取消收尾)
                .then(cancellations.cancelOrphanedChildren(BATCH_SIZE))
                .then(projections.recoverTerminalBatch(BATCH_SIZE));
    }

    private Mono<Void> heartbeatOwned() {
        return Flux.fromIterable(executions.snapshot())
                .concatMap(handle -> leases.heartbeat(
                                handle.runId(),
                                handle.ownerInstanceId(),
                                handle.ownerEpoch(),
                                ownerLease)
                        .onErrorResume(failure -> {
                            log.warn(
                                    "Agent owner heartbeat failed and was fenced: runId={}, type={}",
                                    handle.runId(),
                                    failure.getClass().getSimpleName());
                            return Mono.empty();
                        }))
                .then();
    }
}
