package com.inneragent.agent.run;

import com.inneragent.platform.repository.ai.AgentEventRepository;
import com.inneragent.platform.repository.ai.AgentEventRepository.ReplaySnapshot;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/** Ordered replay/live bridge whose only durable source is the MySQL journal. */
@Service
@Slf4j
public class AgentRunReplayService {

    static final int REPLAY_PAGE_SIZE = 256;
    static final Duration POLL_INTERVAL = Duration.ofMillis(300);

    private final AgentEventRepository repository;
    private final AgentRunRedisSignalService signals;
    private final AgentRuntimeSchedulers schedulers;
    private AgentRuntimeMetrics metrics = AgentRuntimeMetrics.noop();

    @Autowired
    void setMetrics(AgentRuntimeMetrics metrics) {
        this.metrics = Objects.requireNonNull(metrics, "metrics must not be null");
    }

    public AgentRunReplayService(
            AgentEventRepository repository,
            AgentRunRedisSignalService signals,
            AgentRuntimeSchedulers schedulers) {
        this.repository = Objects.requireNonNull(
                repository, "repository must not be null");
        this.signals = Objects.requireNonNull(signals, "signals must not be null");
        this.schedulers = Objects.requireNonNull(
                schedulers, "schedulers must not be null");
    }

    public Flux<CommittedAgentEvent> replayThenLive(
            String runId, long afterSequence) {
        return Flux.defer(() -> {
            String safeRunId = requireRunId(runId);
            if (afterSequence < 0) {
                return Flux.error(new IllegalArgumentException(
                        "afterSequence must not be negative"));
            }

            AtomicLong cursor = new AtomicLong(afterSequence);
            AtomicLong deliveredTerminal = new AtomicLong(
                    afterSequence == 0 ? 0 : afterSequence);
            ReplayWakeGate gate = new ReplayWakeGate();
            java.util.concurrent.atomic.AtomicBoolean firstSnapshot =
                    new java.util.concurrent.atomic.AtomicBoolean(true);
            return signals.wakeupsWhenSubscribed(safeRunId)
                    .onErrorResume(failure -> {
                        log.warn(
                                "Agent replay Redis subscription unavailable; polling MySQL: runId={}, type={}",
                                safeRunId,
                                failure.getClass().getSimpleName());
                        return Mono.just(Flux.<Long>never());
                    })
                    .flatMapMany(wakeups -> Flux.using(
                            () -> subscribeWakeups(
                                    safeRunId, wakeups, gate),
                            ignored -> replayCycle(
                                    safeRunId,
                                    cursor,
                                    deliveredTerminal,
                                    gate,
                                    firstSnapshot),
                            Disposable::dispose));
        });
    }

    private Disposable subscribeWakeups(
            String runId, Flux<Long> wakeups, ReplayWakeGate gate) {
        return wakeups.subscribe(
                gate::markDirty,
                failure -> {
                    log.warn(
                            "Agent replay Redis listener ended; polling MySQL: runId={}, type={}",
                            runId,
                            failure.getClass().getSimpleName());
                    gate.requestPoll();
                },
                gate::requestPoll);
    }

    private Flux<CommittedAgentEvent> replayCycle(
            String runId,
            AtomicLong cursor,
            AtomicLong deliveredTerminal,
            ReplayWakeGate gate,
            java.util.concurrent.atomic.AtomicBoolean firstSnapshot) {
        return loadSnapshot(runId)
                .flatMapMany(snapshot -> {
                    if (firstSnapshot.getAndSet(false)
                            && snapshot.terminalSequence() != null) {
                        metrics.replayTerminalRecovered();
                    }
                    validateCursor(runId, cursor.get(), snapshot.latestSequence());
                    acknowledgeCursorTerminal(
                            cursor.get(), deliveredTerminal, snapshot);
                    Flux<CommittedAgentEvent> drained = snapshot.latestSequence() > cursor.get()
                            ? drainThrough(
                                    runId,
                                    cursor,
                                    deliveredTerminal,
                                    snapshot)
                            : Flux.empty();
                    return drained.concatWith(Flux.defer(() -> afterDrain(
                            runId,
                            cursor,
                            deliveredTerminal,
                            gate,
                            snapshot,
                            firstSnapshot)));
                });
    }

    private Flux<CommittedAgentEvent> drainThrough(
            String runId,
            AtomicLong cursor,
            AtomicLong deliveredTerminal,
            ReplaySnapshot snapshot) {
        long firstAfter = cursor.get();
        return loadPage(runId, firstAfter, snapshot.latestSequence())
                .expandDeep(page -> page.lastSequence() < snapshot.latestSequence()
                        ? loadPage(
                                runId,
                                page.lastSequence(),
                                snapshot.latestSequence())
                        : Mono.empty())
                .concatMapIterable(ReplayPage::events)
                .doOnNext(event -> advanceCursor(cursor, event))
                .filter(CommittedAgentEvent::publishRequired)
                .doOnNext(ignored -> metrics.replayDelivered())
                .doOnNext(event -> {
                    Long terminalSequence = snapshot.terminalSequence();
                    if (terminalSequence != null
                            && event.sequence() == terminalSequence) {
                        deliveredTerminal.set(terminalSequence);
                    }
                });
    }

    private Flux<CommittedAgentEvent> afterDrain(
            String runId,
            AtomicLong cursor,
            AtomicLong deliveredTerminal,
            ReplayWakeGate gate,
            ReplaySnapshot drainedSnapshot,
            java.util.concurrent.atomic.AtomicBoolean firstSnapshot) {
        Long terminalSequence = drainedSnapshot.terminalSequence();
        if (terminalSequence != null
                && deliveredTerminal.get() >= terminalSequence) {
            return confirmTerminalTailEmpty(
                    runId, cursor, deliveredTerminal, gate, firstSnapshot);
        }
        return awaitNextCycle(
                runId, cursor, deliveredTerminal, gate, firstSnapshot);
    }

    private Flux<CommittedAgentEvent> confirmTerminalTailEmpty(
            String runId,
            AtomicLong cursor,
            AtomicLong deliveredTerminal,
            ReplayWakeGate gate,
            java.util.concurrent.atomic.AtomicBoolean firstSnapshot) {
        return loadSnapshot(runId)
                .flatMapMany(confirmed -> {
                    acknowledgeCursorTerminal(
                            cursor.get(), deliveredTerminal, confirmed);
                    Long terminalSequence = confirmed.terminalSequence();
                    if (terminalSequence != null
                            && deliveredTerminal.get() >= terminalSequence
                            && confirmed.latestSequence() <= cursor.get()) {
                        return Flux.empty();
                    }
                    return replayCycle(
                            runId, cursor, deliveredTerminal, gate, firstSnapshot);
                });
    }

    private Flux<CommittedAgentEvent> awaitNextCycle(
            String runId,
            AtomicLong cursor,
            AtomicLong deliveredTerminal,
            ReplayWakeGate gate,
            java.util.concurrent.atomic.AtomicBoolean firstSnapshot) {
        return gate.awaitDirtyOrPoll(POLL_INTERVAL)
                .flatMapMany(sequenceHint -> {
                    if (sequenceHint > 0 && sequenceHint <= cursor.get()) {
                        metrics.replayDuplicateSuppressed();
                    }
                    return Flux.defer(() -> replayCycle(
                            runId, cursor, deliveredTerminal, gate, firstSnapshot));
                });
    }

    /**
     * [adapt] 多应用运行 500 二轮根修:重放/活尾按全局唯一 run_id 读行,
     * 属系统读路径——执行线程可能是丢失 ThreadLocal 上下文的唤醒/轮询线程
     * (Redis 订阅 netty 线程、Mono.delay 并行线程),环境行级注入会把
     * 非缺省应用的行过滤成「不存在」。统一以系统模式(租户+应用注入均跳过)
     * 读取;SSE 的用户归属鉴权已在入口(requireAuthorizedRun)完成。
     */
    private Mono<ReplaySnapshot> loadSnapshot(String runId) {
        return Mono.fromCallable(() ->
                        com.inneragent.platform.tenant.TenantContext.runAsSystem(() ->
                                com.inneragent.platform.context.AppContext.runAsSystem(() ->
                                        repository.loadReplaySnapshot(runId))))
                .subscribeOn(schedulers.journal());
    }

    private Mono<ReplayPage> loadPage(
            String runId, long afterSequence, long throughSequence) {
        return Mono.fromCallable(() ->
                        com.inneragent.platform.tenant.TenantContext.runAsSystem(() ->
                                com.inneragent.platform.context.AppContext.runAsSystem(() ->
                                        repository.loadReplayPage(
                                                runId,
                                                afterSequence,
                                                throughSequence,
                                                REPLAY_PAGE_SIZE))))
                .subscribeOn(schedulers.journal())
                .map(events -> requirePage(
                        runId, afterSequence, throughSequence, events));
    }

    private ReplayPage requirePage(
            String runId,
            long afterSequence,
            long throughSequence,
            List<CommittedAgentEvent> events) {
        if (events.isEmpty()) {
            throw new IllegalStateException(
                    "Committed Agent event range is empty: runId=" + runId
                            + ", after=" + afterSequence
                            + ", through=" + throughSequence);
        }
        return new ReplayPage(events, events.getLast().sequence());
    }

    private void advanceCursor(
            AtomicLong cursor, CommittedAgentEvent event) {
        long expected = cursor.get() + 1;
        if (event.sequence() != expected
                || !cursor.compareAndSet(expected - 1, event.sequence())) {
            throw new IllegalStateException(
                    "Agent replay sequence is not contiguous: runId=" + event.runId()
                            + ", expected=" + expected
                            + ", actual=" + event.sequence());
        }
    }

    private void acknowledgeCursorTerminal(
            long cursor,
            AtomicLong deliveredTerminal,
            ReplaySnapshot snapshot) {
        Long terminalSequence = snapshot.terminalSequence();
        if (terminalSequence != null && cursor >= terminalSequence) {
            deliveredTerminal.accumulateAndGet(terminalSequence, Math::max);
        }
    }

    private void validateCursor(
            String runId, long cursor, long latestSequence) {
        if (cursor > latestSequence) {
            throw new IllegalArgumentException(
                    "Agent replay cursor exceeds committed history: runId=" + runId
                            + ", cursor=" + cursor
                            + ", latest=" + latestSequence);
        }
    }

    private String requireRunId(String runId) {
        if (runId == null || runId.isBlank()) {
            throw new IllegalArgumentException("runId must not be blank");
        }
        if (runId.length() > 64
                || !StandardCharsets.US_ASCII.newEncoder().canEncode(runId)) {
            throw new IllegalArgumentException(
                    "runId must be at most 64 ASCII characters");
        }
        return runId;
    }

    private record ReplayPage(
            List<CommittedAgentEvent> events, long lastSequence) {

        private ReplayPage {
            events = List.copyOf(events);
            if (events.isEmpty()) {
                throw new IllegalArgumentException("events must not be empty");
            }
            if (lastSequence != events.getLast().sequence()) {
                throw new IllegalArgumentException(
                        "lastSequence must match the final event");
            }
        }
    }
}
