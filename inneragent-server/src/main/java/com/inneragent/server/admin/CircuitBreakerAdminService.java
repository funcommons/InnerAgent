package com.inneragent.server.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.CancellationCoordinator;
import com.inneragent.platform.circuit.CircuitBreakerLimits;
import com.inneragent.platform.circuit.CircuitEvent;
import com.inneragent.platform.circuit.mapper.CircuitEventMapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.toolhub.ToolAuditService;
import com.inneragent.platform.toolhub.ToolDecisionSource;
import com.inneragent.server.admin.mapper.AppRegistrationMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;

/**
 * 熔断与资源上限 admin 服务(优化建议 #2 服务端半,V14;mock 契约
 * handlers.ts circuitHandlers 为产品契约锚点)。
 *
 * <p><strong>紧急停用最小实现语义</strong>:
 * <ul>
 *   <li>停用后<strong>新 run 403</strong>:{@link #assertRunStartAllowed} 挂在
 *       run 发起唯一入口({@code AgentScopePipelineRunService} prepare 阶段,
 *       SDK 对话链/续跑全覆盖),文案「应用已紧急停用」;</li>
 *   <li><strong>进行中 run 不自动终止</strong>:mock 契约的紧急停用仅翻转
 *       总开关 + 记事件,无批量取消语义;进行中 run 由管理员用
 *       terminate-run 逐个强制终止(复用 {@link CancellationCoordinator}
 *       既有 cancel 基建:置 CANCEL_REQUESTED → Redis 取消信号 → 中断)。</li>
 * </ul>
 *
 * <p>terminate-run 审计照 T2a 形态落 ia_audit_log(decision=run-terminated、
 * decision_source=forced-policy);停用/恢复事件落 ia_circuit_event(操作者:
 * 管理会话用户名,引导 key 通道为 admin)。
 *
 * <p>limits(mcpConcurrency/mcpQps 等)<strong>执行层接线待后续</strong>:
 * 本版落库 + 管理面读写,内核暂无挂点(见 {@link CircuitBreakerLimits})。
 */
@Service
@Slf4j
public class CircuitBreakerAdminService {

    /** recentEvents 条数(mock 契约 slice(0, 20)) */
    static final int RECENT_EVENTS_LIMIT = 20;

    private static final String OPERATOR_FALLBACK = "admin";

    private final AppRegistrationMapper appMapper;
    private final CircuitEventMapper circuitEventMapper;
    private final AgentRunMapper runMapper;
    private final CancellationCoordinator cancellations;
    private final ToolAuditService auditService;
    private final ObjectMapper objectMapper;
    private final AgentRuntimeSchedulers schedulers;

    public CircuitBreakerAdminService(
            AppRegistrationMapper appMapper,
            CircuitEventMapper circuitEventMapper,
            AgentRunMapper runMapper,
            CancellationCoordinator cancellations,
            ToolAuditService auditService,
            ObjectMapper objectMapper,
            AgentRuntimeSchedulers schedulers) {
        this.appMapper = Objects.requireNonNull(appMapper, "appMapper must not be null");
        this.circuitEventMapper =
                Objects.requireNonNull(circuitEventMapper, "circuitEventMapper must not be null");
        this.runMapper = Objects.requireNonNull(runMapper, "runMapper must not be null");
        this.cancellations = Objects.requireNonNull(cancellations, "cancellations must not be null");
        this.auditService = Objects.requireNonNull(auditService, "auditService must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.schedulers = Objects.requireNonNull(schedulers, "schedulers must not be null");
    }

    // ------------------------------------------------------------------
    // 状态读取(GET /admin/circuit-breaker)
    // ------------------------------------------------------------------

    public StateView state(long appId) {
        AppRegistration app = requireApp(appId);
        return new StateView(
                Boolean.TRUE.equals(app.getCircuitStopped()),
                toIso(app.getCircuitStoppedAt()),
                app.getCircuitStopReason(),
                currentLimits(app),
                countActiveRuns(),
                recentEvents(appId));
    }

    // ------------------------------------------------------------------
    // limits 配置(PUT /admin/circuit-breaker/limits;body {limits: partial})
    // ------------------------------------------------------------------

    public CircuitBreakerLimits updateLimits(long appId, CircuitBreakerLimits.PartialPatch patch) {
        AppRegistration app = requireApp(appId);
        if (patch == null || patch.isEmpty()) {
            return currentLimits(app);
        }
        CircuitBreakerLimits merged = currentLimits(app).merge(patch);
        app.setCircuitLimitsJson(merged.toJson(objectMapper));
        appMapper.updateById(app);
        log.info("熔断上限已更新: appId={}, limits={}", appId, app.getCircuitLimitsJson());
        return merged;
    }

    // ------------------------------------------------------------------
    // 紧急停用 / 恢复(应用级总开关)
    // ------------------------------------------------------------------

    public CircuitEventView emergencyStop(long appId, String reason) {
        if (reason == null || reason.isBlank()) {
            throw new BusinessException(400, "reason 不能为空");
        }
        AppRegistration app = requireApp(appId);
        app.setCircuitStopped(true);
        app.setCircuitStoppedAt(LocalDateTime.now(ZoneOffset.UTC));
        app.setCircuitStopReason(reason.trim());
        appMapper.updateById(app);
        log.warn("应用紧急停用: appId={}, reason={}", appId, reason.trim());
        return insertEvent(appId, CircuitEvent.TYPE_EMERGENCY_STOP, null, reason.trim(), currentOperator());
    }

    public CircuitEventView resume(long appId) {
        requireApp(appId);
        // 恢复须显式清空 stopped_at/stop_reason(V14 DDL「恢复时清空」):
        // 整行 updateById 按 MP 缺省字段策略跳过 null 字段,清空不会落库
        // (AppRegistrationWritePathsIT 真库守卫捕获),改定向 UPDATE
        appMapper.update(null, new LambdaUpdateWrapper<AppRegistration>()
                .set(AppRegistration::getCircuitStopped, false)
                .set(AppRegistration::getCircuitStoppedAt, null)
                .set(AppRegistration::getCircuitStopReason, null)
                .eq(AppRegistration::getId, appId));
        log.info("应用从紧急停用恢复: appId={}", appId);
        // 文案对齐 mock 契约(resume 事件 reason 固定「人工恢复」)
        return insertEvent(appId, CircuitEvent.TYPE_RESUME, null, "人工恢复", currentOperator());
    }

    /**
     * run 发起守卫(新 run 403;嵌入链/SDK 对话链的发起入口统一调用)。
     * 应用行缺失时跳过(应用存在性由 embed 验签链路/应用注册校验兜底,
     * 守卫不重复承担 404 语义)。
     */
    public void assertRunStartAllowed(long appId) {
        AppRegistration app = appMapper.selectById(appId);
        if (app != null && Boolean.TRUE.equals(app.getCircuitStopped())) {
            throw new BusinessException(403, "应用已紧急停用"
                    + (app.getCircuitStopReason() == null ? "" : ":" + app.getCircuitStopReason())
                    + ",新运行已被拒绝,请等待管理员恢复后再试");
        }
    }

    // ------------------------------------------------------------------
    // 单运行强制终止(POST /admin/circuit-breaker/terminate-run)
    // ------------------------------------------------------------------

    public Mono<CircuitEventView> terminateRun(long appId, String runId, String reason) {
        if (runId == null || runId.isBlank() || reason == null || reason.isBlank()) {
            throw new BusinessException(400, "runId/reason 不能为空");
        }
        String safeRunId = runId.trim();
        String safeReason = reason.trim();
        AgentRun run = runMapper.selectByRunId(safeRunId);
        if (run == null) {
            throw new BusinessException(404, "运行不存在: " + safeRunId);
        }
        if (AgentRunStatus.valueOf(run.getStatus()).isTerminal()) {
            throw new BusinessException(409, "运行已处于终态,无需强制终止: " + safeRunId);
        }
        String operator = currentOperator();
        // 复用既有 cancel 基建:置 CANCEL_REQUESTED + Redis 取消信号 + 中断执行;
        // 管理员通道不做归属校验(requestInternal 语义)
        return cancellations.request(safeRunId)
                .then(Mono.fromCallable(() -> {
                    appendAudit(appId, run, safeReason, operator);
                    return insertEvent(
                            appId, CircuitEvent.TYPE_RUN_TERMINATED, safeRunId, safeReason, operator);
                }).subscribeOn(schedulers.journal()));
    }

    // ------------------------------------------------------------------
    // 内部装配
    // ------------------------------------------------------------------

    private AppRegistration requireApp(long appId) {
        AppRegistration app = appMapper.selectById(appId);
        if (app == null) {
            throw new BusinessException(404, "应用不存在: " + appId);
        }
        return app;
    }

    private CircuitBreakerLimits currentLimits(AppRegistration app) {
        return CircuitBreakerLimits.fromJson(objectMapper, app.getCircuitLimitsJson());
    }

    /** 当前活跃 run 数(非终态;管理请求行级拦截器按单应用缺省注入 app_id)。 */
    private long countActiveRuns() {
        Long count = runMapper.selectCount(new LambdaQueryWrapper<AgentRun>()
                .in(AgentRun::getStatus,
                        AgentRunStatus.RUNNING.name(),
                        AgentRunStatus.WAITING_CONFIRMATION.name(),
                        AgentRunStatus.WAITING_EXTERNAL.name(),
                        AgentRunStatus.CANCEL_REQUESTED.name()));
        return count == null ? 0L : count;
    }

    private List<CircuitEventView> recentEvents(long appId) {
        return circuitEventMapper.selectList(new LambdaQueryWrapper<CircuitEvent>()
                        .eq(CircuitEvent::getAppId, appId)
                        .orderByDesc(CircuitEvent::getId)
                        .last("LIMIT " + RECENT_EVENTS_LIMIT))
                .stream()
                .map(CircuitBreakerAdminService::toView)
                .toList();
    }

    private CircuitEventView insertEvent(
            long appId, String type, String runId, String reason, String operator) {
        CircuitEvent event = new CircuitEvent();
        event.setAppId(appId);
        event.setType(type);
        event.setRunId(runId);
        event.setReason(reason);
        event.setOperator(operator);
        circuitEventMapper.insert(event);
        return toView(event);
    }

    private void appendAudit(long appId, AgentRun run, String reason, String operator) {
        // T2a 形态:decision_source=forced-policy;decision 用事件码
        // (V12 列宽 VARCHAR(32) 兼容),失败即业务失败(fail-closed)
        auditService.append(new ToolAuditService.ToolAuditEntry(
                appId,
                null,
                run.getUserId(),
                run.getConversationId(),
                run.getRunId(),
                null,
                "run-terminated",
                ToolDecisionSource.FORCED_POLICY.code(),
                null,
                null,
                "管理员强制终止(" + operator + "): " + reason,
                null,
                null));
    }

    static CircuitEventView toView(CircuitEvent event) {
        return new CircuitEventView(
                event.getId(),
                event.getType(),
                event.getRunId(),
                event.getReason(),
                event.getOperator(),
                toIso(event.getCreateTime()));
    }

    /**
     * 操作者:管理会话通道取登录用户名(AdminTokenFilter 写入
     * SecurityContext),引导 key/自动化通道缺省 admin。
     */
    private static String currentOperator() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()
                && authentication.getName() != null
                && !"anonymousUser".equals(authentication.getName())) {
            return authentication.getName();
        }
        return OPERATOR_FALLBACK;
    }

    private static String toIso(LocalDateTime time) {
        return time == null ? null : time.toInstant(ZoneOffset.UTC).toString();
    }

    /** 熔断事件视图(mock 契约 CircuitBreakerEvent 形;occurredAt=ISO-8601)。 */
    public record CircuitEventView(
            Long id,
            String type,
            String runId,
            String reason,
            String operator,
            String occurredAt) {
    }

    /** 熔断状态视图(mock 契约 CircuitBreakerState 形 + activeRuns 扩展)。 */
    public record StateView(
            boolean emergencyStopped,
            String stoppedAt,
            String stopReason,
            CircuitBreakerLimits limits,
            long activeRuns,
            List<CircuitEventView> recentEvents) {
    }
}
