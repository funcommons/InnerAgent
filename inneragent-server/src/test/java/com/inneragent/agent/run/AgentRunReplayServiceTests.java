package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.platform.repository.ai.AgentEventRepository;
import com.inneragent.platform.repository.ai.AgentEventRepository.ReplaySnapshot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.core.scheduler.Schedulers;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 回放/活尾循环的计数与时序锁定（2026-09-28 O-3 内存泄漏根修的回归网）。
 *
 * <p>泄漏本体（活跃轮订阅链持有全部祖先轮操作器，O(周期数) 保留）难以在
 * 单测内断言可达堆 —— 那半边走活体协议（200 挂起会话零流量 drift + 堆
 * 直方图，见提交说明）。这里锁定触发路径的行为：挂起运行持续轮询、终态
 * 追平恰好收口、取消后轮询停止 —— 三者任何一处回归，泄漏路径都会重新
 * 打开。
 */
class AgentRunReplayServiceTests {

    private static final String RUN_ID = "run-replay-loop";

    private AgentEventRepository repository;
    private AgentRunReplayService service;
    private final AtomicInteger snapshotLoads = new AtomicInteger();

    @BeforeEach
    void setUp() {
        repository = mock(AgentEventRepository.class);
        AiStreamRedisService redis = mock(AiStreamRedisService.class);
        when(redis.runWakeupPayloadsWhenSubscribed(anyString()))
                .thenReturn(Mono.just(Flux.<String>never()));
        AgentRunRedisSignalService signals =
                new AgentRunRedisSignalService(redis);
        AgentRuntimeSchedulers schedulers = mock(AgentRuntimeSchedulers.class);
        when(schedulers.journal()).thenReturn(Schedulers.boundedElastic());
        service = new AgentRunReplayService(repository, signals, schedulers);
        when(repository.loadReplaySnapshot(anyString())).thenAnswer(
                ignored -> {
                    snapshotLoads.incrementAndGet();
                    return new ReplaySnapshot(1, null);
                });
        when(repository.loadReplayPage(
                anyString(), anyLong(), anyLong(), anyInt()))
                .thenAnswer(ignored -> List.of(contentEvent(1)));
    }

    @Test
    void waitingRunKeepsPollingAndStopsOnCancel() {
        Disposable disposable = service.replayThenLive(RUN_ID, 0)
                .subscribe(ignored -> { });

        try {
            // 挂起运行没有终态：循环必须持续轮询（300ms 间隔，5 个间隔 ≥ 4 轮）。
            long deadline = System.nanoTime() + duration(5).toNanos();
            while (snapshotLoads.get() < 4
                    && System.nanoTime() < deadline) {
                Thread.sleep(20);
            }
            assertThat(snapshotLoads.get())
                    .as("循环在无终态时持续轮询")
                    .isGreaterThanOrEqualTo(4);

            // 取消订阅后轮询必须停止（允许取消竞态内的最后一轮）。
            disposable.dispose();
            int atCancel = snapshotLoads.get();
            Thread.sleep(duration(3).toMillis());
            assertThat(snapshotLoads.get())
                    .as("取消后循环停止")
                    .isLessThanOrEqualTo(atCancel + 1);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    @Test
    void terminalDeliveryCompletesAndStopsPolling() {
        when(repository.loadReplaySnapshot(anyString())).thenAnswer(
                ignored -> {
                    snapshotLoads.incrementAndGet();
                    return new ReplaySnapshot(1, 1L);
                });

        StepVerifier.create(service.replayThenLive(RUN_ID, 0))
                .expectNextCount(1)
                .expectComplete()
                .verify(duration(15));

        // 终态追平收口后循环必须终止（允许收口竞态内的最后一轮）。
        int atComplete = snapshotLoads.get();
        try {
            Thread.sleep(duration(3).toMillis());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
        assertThat(snapshotLoads.get())
                .as("终态收口后循环停止")
                .isLessThanOrEqualTo(atComplete + 1);
    }

    @Test
    void wakeupHintTriggersCycleWithoutWaitingForPoll() {
        Sinks.Many<String> hints = Sinks.many().unicast().onBackpressureBuffer();
        AiStreamRedisService redis = mock(AiStreamRedisService.class);
        when(redis.runWakeupPayloadsWhenSubscribed(anyString()))
                .thenReturn(Mono.just(hints.asFlux()));
        AgentRunRedisSignalService signals =
                new AgentRunRedisSignalService(redis);
        AgentRuntimeSchedulers schedulers = mock(AgentRuntimeSchedulers.class);
        when(schedulers.journal()).thenReturn(Schedulers.boundedElastic());
        service = new AgentRunReplayService(repository, signals, schedulers);

        Disposable disposable = service.replayThenLive(RUN_ID, 0)
                .subscribe(ignored -> { });
        try {
            // 等第一轮完成，游标停在 1。
            long deadline = System.nanoTime() + duration(5).toNanos();
            while (snapshotLoads.get() < 1 && System.nanoTime() < deadline) {
                Thread.sleep(20);
            }
            int before = snapshotLoads.get();
            long startedAt = System.nanoTime();
            // 重复提示（序号不超前）：按既有口径计数后丢弃，但立即驱动一轮 ——
            // 轮询路径的下界是 POLL_INTERVAL，比它快就证明是提示驱动。
            hints.tryEmitNext("1");
            deadline = System.nanoTime() + duration(3).toNanos();
            while (snapshotLoads.get() <= before
                    && System.nanoTime() < deadline) {
                Thread.sleep(10);
            }
            long elapsed = System.nanoTime() - startedAt;
            assertThat(snapshotLoads.get())
                    .as("唤醒提示驱动一轮")
                    .isGreaterThan(before);
            assertThat(elapsed)
                    .as("提示驱动先于 300ms 轮询下界")
                    .isLessThan(AgentRunReplayService.POLL_INTERVAL.toNanos());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        } finally {
            disposable.dispose();
        }
    }

    private static Duration duration(int polls) {
        return AgentRunReplayService.POLL_INTERVAL.multipliedBy(polls);
    }

    private static CommittedAgentEvent contentEvent(long sequence) {
        return new CommittedAgentEvent(
                sequence,
                RUN_ID,
                sequence,
                new AgentEventEnvelope(
                        "raw-" + sequence,
                        "CONTENT",
                        "main",
                        null,
                        null,
                        null,
                        null,
                        null,
                        "CONTENT",
                        JsonNodeFactory.instance.objectNode(),
                        Instant.now()),
                Instant.now());
    }
}
