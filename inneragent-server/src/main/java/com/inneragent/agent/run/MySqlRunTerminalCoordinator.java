package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.agent.entity.AgentRun;
import com.inneragent.platform.enums.ai.AgentRunStatus;
import com.inneragent.platform.enums.ai.AgentRuntimeErrorCode;
import com.inneragent.platform.repository.ai.AgentEventRepository;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.state.StateStoreFailure;
import com.inneragent.agent.state.StateStoreFailureGuard;
import com.inneragent.agent.state.StateStoreSlot;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import com.inneragent.platform.context.AppContext;
import com.inneragent.platform.webhook.WebhookDeliveryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Reactive terminal adapter with fail-closed StateStore completion checks. */
@Service
@RequiredArgsConstructor
@Slf4j
public class MySqlRunTerminalCoordinator implements RunTerminalCoordinator {

    private static final String STATE_STORE_FAILURE_MESSAGE =
            "Agent state persistence failed before completion";

    private final AgentEventRepository repository;
    private final AgentRunMapper runMapper;
    private final StateStoreFailureGuard stateStoreFailureGuard;
    private final AgentRuntimeSchedulers schedulers;
    private final AgentRunRedisSignalService signals;
    /**
     * [adapt] 任务 #18b(W5):终态 Webhook——终态事务提交后异步入队投递
     * 记录(PRD「终态通知」最小事件集:run.finished/failed/cancelled)。
     * ObjectProvider 软依赖:webhook 未装配时静默跳过,入队异常绝不影响
     * 终态本身(见 {@link #notifyWebhookTerminal(CommittedAgentEvent)})。
     */
    private final ObjectProvider<WebhookDeliveryService> webhookDelivery;
    private AgentRuntimeMetrics metrics = AgentRuntimeMetrics.noop();

    @Autowired
    void setMetrics(AgentRuntimeMetrics metrics) {
        this.metrics = Objects.requireNonNull(
                metrics, "metrics must not be null");
    }

    @Override
    public Mono<Optional<CommittedAgentEvent>> terminateOwned(
            RunTerminalRequest request,
            String ownerInstanceId,
            long ownerEpoch) {
        return Mono.fromCallable(() -> repository.terminateOwnedTx(
                        failClosedCompletion(request), ownerInstanceId, ownerEpoch))
                .subscribeOn(schedulers.journal())
                .flatMap(this::afterTerminalCommit);
    }

    @Override
    public Mono<Optional<CommittedAgentEvent>> terminateSystem(
            RunTerminalRequest request,
            SystemTerminalActor actor) {
        return Mono.fromCallable(() -> repository.terminateSystemTx(request, actor))
                .subscribeOn(schedulers.journal())
                .flatMap(this::afterTerminalCommit);
    }

    private Mono<Optional<CommittedAgentEvent>> afterTerminalCommit(
            Optional<CommittedAgentEvent> committed) {
        recordTerminal(committed);
        committed.ifPresent(this::notifyWebhookTerminal);
        return committed.filter(CommittedAgentEvent::publishRequired)
                .map(event -> signals.publishWakeup(event.runId(), event.sequence())
                        .onErrorResume(failure -> Mono.empty())
                        .thenReturn(committed))
                .orElseGet(() -> Mono.just(committed));
    }

    /**
     * [adapt] 任务 #18b(W5):终态 Webhook 入队。映射:DONE→run.finished、
     * ERROR→run.failed、CANCELLED→run.cancelled;仅当 outputType 非空
     * (终态事件)时触发。fire-and-forget:任何异常只记 WARN。
     */
    private void notifyWebhookTerminal(CommittedAgentEvent event) {
        String outputType = event.outputType();
        if (outputType == null) {
            return;
        }
        WebhookDeliveryService service = webhookDelivery.getIfAvailable();
        if (service == null) {
            return;
        }
        try {
            String eventType = switch (outputType) {
                case "DONE" -> WebhookDeliveryService.EVENT_RUN_FINISHED;
                case "ERROR" -> WebhookDeliveryService.EVENT_RUN_FAILED;
                case "CANCELLED" -> WebhookDeliveryService.EVENT_RUN_CANCELLED;
                default -> null;
            };
            if (eventType == null) {
                return;
            }
            String errorCode = event.envelope().payload() == null
                    ? null
                    : textOrNull(event.envelope().payload().get("errorCode"));
            String errorMessage = event.envelope().payload() == null
                    ? null
                    : textOrNull(event.envelope().payload().get("error"));
            service.onRunTerminal(new WebhookDeliveryService.TerminalEvent(
                    AppContext.currentOrDefault(),
                    eventType,
                    event.runId(),
                    outputType,
                    event.committedAt() == null
                            ? Instant.now().toString()
                            : event.committedAt().toString(),
                    errorCode,
                    errorMessage));
        } catch (Exception failure) {
            // Webhook 入队失败不影响运行终态;投递记录缺失属可观测降级。
            log.warn("Webhook terminal enqueue failed: runId={}, type={}",
                    event.runId(), failure.getClass().getSimpleName(), failure);
        }
    }

    private static String textOrNull(com.fasterxml.jackson.databind.JsonNode node) {
        return node == null || node.isNull() ? null : node.asText();
    }

    private void recordTerminal(Optional<CommittedAgentEvent> committed) {
        committed.ifPresent(event -> metrics.terminal(switch (event.outputType()) {
            case "DONE" -> AgentRunStatus.COMPLETED;
            case "ERROR" -> AgentRunStatus.FAILED;
            case "CANCELLED" -> AgentRunStatus.CANCELLED;
            default -> throw new IllegalStateException(
                    "Unknown Agent terminal output type: " + event.outputType());
        }));
    }

    private RunTerminalRequest failClosedCompletion(RunTerminalRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request must not be null");
        }
        AgentRun run = runMapper.selectOne(new LambdaQueryWrapper<AgentRun>()
                .select(AgentRun::getUserId, AgentRun::getAgentStateSessionId)
                .eq(AgentRun::getRunId, request.runId()));
        if (run != null) {
            StateStoreSlot authoritativeSlot = new StateStoreSlot(
                    String.valueOf(run.getUserId()), run.getAgentStateSessionId());
            if (!authoritativeSlot.equals(request.stateStoreSlot())) {
                throw new IllegalArgumentException(
                        "Run terminal StateStore slot does not match persisted run identity");
            }
        }
        if (request.terminalStatus() != AgentRunStatus.COMPLETED) {
            return request;
        }
        try {
            stateStoreFailureGuard.throwIfFailed(request.stateStoreSlot());
            return request;
        } catch (StateStoreFailure failure) {
            return request.asFailure(
                    AgentRuntimeErrorCode.STATE_STORE_FAILED,
                    STATE_STORE_FAILURE_MESSAGE,
                    stateStoreFailureEnvelope(request.terminalEnvelope()));
        }
    }

    private AgentEventEnvelope stateStoreFailureEnvelope(AgentEventEnvelope original) {
        ObjectNode payload = JsonNodeFactory.instance.objectNode()
                .put("outputType", "ERROR")
                .put("errorCode", AgentRuntimeErrorCode.STATE_STORE_FAILED.getCode())
                .put("error", STATE_STORE_FAILURE_MESSAGE)
                .put("finished", true);
        return new AgentEventEnvelope(
                "state-store-failure-" + UUID.randomUUID().toString().replace("-", ""),
                "STATE_STORE_FAILED",
                original.source(),
                original.replyId(),
                original.blockId(),
                original.toolCallId(),
                original.parentToolCallId(),
                original.agentName(),
                "ERROR",
                payload,
                Instant.now());
    }
}
