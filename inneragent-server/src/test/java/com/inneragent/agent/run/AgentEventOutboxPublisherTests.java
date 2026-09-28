package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import com.inneragent.platform.config.AgentScopeRuntimeProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import reactor.core.Disposable;
import reactor.core.publisher.Mono;
import reactor.core.publisher.MonoSink;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** [O-1] outbox 发布批量化:锁定批量行为(调用次数、失败隔离、租约/退避不变)。 */
class AgentEventOutboxPublisherTests {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 9, 28, 12, 0);
    private static final long MIN_RETRY_MILLIS = 100;
    private static final long MAX_RETRY_MILLIS = 30_000;
    private static final long CLAIM_LEASE_SECONDS = 30;

    private final AgentRuntimeSchedulers schedulers = schedulers();
    private AgentEventMapper eventMapper;
    private AgentRunMapper runMapper;
    private PlatformTransactionManager transactionManager;
    private AgentRunRedisSignalService signals;
    private AgentEventEnvelopeSanitizer sanitizer;
    private AgentEventOutboxPublisher publisher;

    @BeforeEach
    void setUp() {
        eventMapper = mock(AgentEventMapper.class);
        runMapper = mock(AgentRunMapper.class);
        transactionManager = mock(PlatformTransactionManager.class);
        signals = mock(AgentRunRedisSignalService.class);
        sanitizer = new AgentEventEnvelopeSanitizer(new ObjectMapper());
        publisher = new AgentEventOutboxPublisher(
                eventMapper,
                runMapper,
                transactionManager,
                signals,
                sanitizer,
                schedulers);
        TransactionStatus status = mock(TransactionStatus.class);
        when(transactionManager.getTransaction(any(TransactionDefinition.class)))
                .thenReturn(status);
        when(runMapper.selectDatabaseNow()).thenReturn(NOW);
        when(eventMapper.countOutstandingPublish()).thenReturn(0L);
    }

    @AfterEach
    void closeSchedulers() {
        schedulers.close();
    }

    @Test
    @DisplayName("O-1 成功路径:整批一次 UPDATE ... IN 认领 + n 次并行唤醒 + 一次 UPDATE ... IN ack,不再逐条往返")
    void batchPathUsesSingleClaimAndSingleAcknowledge() {
        List<AgentEvent> claimed = claimedEvents(5);
        stubClaimSucceeds(claimed);
        when(signals.publishWakeup(eq("run-batch"), anyLong()))
                .thenReturn(Mono.empty());
        when(eventMapper.markPublishedBatch(anyString(), anyList())).thenReturn(5);

        StepVerifier.create(publisher.publishBatch("owner", 5))
                .verifyComplete();

        verify(eventMapper).claimPublishCandidatesBatch(
                anyString(), any(), eq(NOW), eq(List.of(1L, 2L, 3L, 4L, 5L)));
        verify(eventMapper, never()).claimPublishCandidate(
                anyLong(), anyString(), any(), any());
        verify(signals, times(5)).publishWakeup(eq("run-batch"), anyLong());
        verify(eventMapper).markPublishedBatch(
                anyString(), eq(List.of(1L, 2L, 3L, 4L, 5L)));
        verify(eventMapper, never()).markPublished(anyLong(), anyString());
        verify(eventMapper).countOutstandingPublish();
    }

    @Test
    @DisplayName("O-1 空批次:不触发唤醒与 ack,仅刷新积压指标")
    void emptyClaimSkipsPublishAndAcknowledge() {
        when(eventMapper.selectPendingPublishCandidatesForUpdate(NOW, 200))
                .thenReturn(List.of());
        when(eventMapper.selectExpiredPublishCandidatesForUpdate(NOW, 200))
                .thenReturn(List.of());

        StepVerifier.create(publisher.publishBatch("owner", 200))
                .verifyComplete();

        verifyNoInteractions(signals);
        verify(eventMapper, never()).markPublishedBatch(anyString(), anyList());
        verify(eventMapper).countOutstandingPublish();
    }

    @Test
    @DisplayName("O-1 失败隔离:单事件唤醒失败仅该事件回退退避重试,其余照常批量 ack,整批不失败")
    void singleWakeupFailureIsIsolatedAndOthersStillAcknowledged() {
        List<AgentEvent> claimed = claimedEvents(3);
        stubClaimSucceeds(claimed);
        RuntimeException failure = new IllegalStateException("redis down");
        when(signals.publishWakeup(anyString(), anyLong())).thenAnswer(invocation ->
                ((long) invocation.getArgument(1)) == 2L
                        ? Mono.error(failure)
                        : Mono.empty());
        when(eventMapper.markPublishedBatch(anyString(), eq(List.of(1L, 3L))))
                .thenReturn(2);
        when(eventMapper.releasePublishForRetry(
                eq(2L), anyString(), any(), anyString())).thenReturn(1);

        StepVerifier.create(publisher.publishBatch("owner", 3))
                .verifyComplete();

        verify(eventMapper).markPublishedBatch(anyString(), eq(List.of(1L, 3L)));
        verify(eventMapper, never()).markPublished(anyLong(), anyString());
        ArgumentCaptor<LocalDateTime> nextAttemptAt =
                ArgumentCaptor.forClass(LocalDateTime.class);
        ArgumentCaptor<String> lastError = ArgumentCaptor.forClass(String.class);
        verify(eventMapper).releasePublishForRetry(
                eq(2L), anyString(), nextAttemptAt.capture(), lastError.capture());
        assertThat(nextAttemptAt.getValue())
                .isAfterOrEqualTo(NOW.plus(Duration.ofMillis(MIN_RETRY_MILLIS)))
                .isBeforeOrEqualTo(NOW.plus(Duration.ofMillis(MAX_RETRY_MILLIS)));
        assertThat(lastError.getValue()).isEqualTo(
                sanitizer.sanitize(TextNode.valueOf("redis down")).asText());
    }

    @Test
    @DisplayName("O-1 唤醒并行派发:批内 4 条唤醒在任一完成前全部进入订阅(pipeline,非逐条串行)")
    void wakeupsAreDispatchedConcurrently() throws Exception {
        List<AgentEvent> claimed = claimedEvents(4);
        stubClaimSucceeds(claimed);
        CountDownLatch dispatched = new CountDownLatch(4);
        List<MonoSink<Long>> pending = new CopyOnWriteArrayList<>();
        when(signals.publishWakeup(anyString(), anyLong())).thenAnswer(invocation ->
                Mono.create((MonoSink<Long> sink) -> {
                    pending.add(sink);
                    dispatched.countDown();
                }));
        when(eventMapper.markPublishedBatch(anyString(), anyList())).thenReturn(4);

        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Disposable> subscription = new AtomicReference<>();
        Thread runner = new Thread(() -> subscription.set(
                publisher.publishBatch("owner", 4).subscribe(
                        ignored -> { },
                        failure -> done.countDown(),
                        done::countDown)));
        runner.start();
        try {
            assertThat(dispatched.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(pending).hasSize(4);
            pending.forEach(sink -> sink.success(1L));
            assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
        } finally {
            runner.join(5_000);
            if (subscription.get() != null) {
                subscription.get().dispose();
            }
        }
        assertThat(runner.isAlive()).isFalse();
        verify(eventMapper).markPublishedBatch(
                anyString(), eq(List.of(1L, 2L, 3L, 4L)));
    }

    @Test
    @DisplayName("O-1 批量 ack 行数不足(租约被抢)时回退逐条判定,claim 丢失事件不误标 PUBLISHED")
    void bulkAcknowledgeMismatchFallsBackToPerEventJudgement() {
        List<AgentEvent> claimed = claimedEvents(2);
        stubClaimSucceeds(claimed);
        when(signals.publishWakeup(anyString(), anyLong()))
                .thenReturn(Mono.empty());
        when(eventMapper.markPublishedBatch(anyString(), eq(List.of(1L, 2L))))
                .thenReturn(1);
        when(eventMapper.markPublished(eq(1L), anyString())).thenReturn(1);
        when(eventMapper.markPublished(eq(2L), anyString())).thenReturn(0);
        when(eventMapper.releasePublishForRetry(
                eq(2L), anyString(), any(), anyString())).thenReturn(0);

        StepVerifier.create(publisher.publishBatch("owner", 2))
                .verifyComplete();

        verify(eventMapper).markPublished(eq(1L), anyString());
        verify(eventMapper).markPublished(eq(2L), anyString());
        verify(eventMapper, times(1)).markPublishedBatch(anyString(), anyList());
        verify(eventMapper).releasePublishForRetry(
                eq(2L), anyString(), any(), anyString());
        verify(eventMapper, never()).releasePublishForRetry(
                eq(1L), anyString(), any(), anyString());
    }

    @Test
    @DisplayName("O-1 认领守卫:批量认领租期保持 30 秒;行数不符时整批失败且不发布")
    void claimKeepsLeaseAndFailsWhenRowcountMismatch() {
        List<AgentEvent> claimed = claimedEvents(2);
        stubClaimSucceeds(claimed);
        when(eventMapper.claimPublishCandidatesBatch(
                anyString(), any(), any(), anyList())).thenReturn(1);

        StepVerifier.create(publisher.publishBatch("owner", 2))
                .expectError(IllegalStateException.class)
                .verify();

        ArgumentCaptor<LocalDateTime> claimUntil =
                ArgumentCaptor.forClass(LocalDateTime.class);
        verify(eventMapper).claimPublishCandidatesBatch(
                anyString(), claimUntil.capture(), eq(NOW), eq(List.of(1L, 2L)));
        assertThat(claimUntil.getValue())
                .isEqualTo(NOW.plusSeconds(CLAIM_LEASE_SECONDS));
        verifyNoInteractions(signals);
        verify(eventMapper, never()).markPublishedBatch(anyString(), anyList());
        verify(eventMapper, never()).countOutstandingPublish();
    }

    private void stubClaimSucceeds(List<AgentEvent> claimed) {
        when(eventMapper.selectPendingPublishCandidatesForUpdate(
                eq(NOW), eq(claimed.size()))).thenReturn(claimed);
        when(eventMapper.claimPublishCandidatesBatch(
                anyString(), any(), any(), anyList())).thenReturn(claimed.size());
    }

    private List<AgentEvent> claimedEvents(int count) {
        List<AgentEvent> events = new ArrayList<>(count);
        for (int index = 1; index <= count; index++) {
            AgentEvent event = new AgentEvent();
            event.setId((long) index);
            event.setRunId("run-batch");
            event.setSequenceNo((long) index);
            event.setPublishAttempts(1);
            events.add(event);
        }
        return events;
    }

    private AgentRuntimeSchedulers schedulers() {
        AgentScopeRuntimeProperties properties = new AgentScopeRuntimeProperties();
        properties.setStateThreads(1);
        properties.setJournalThreads(1);
        properties.setModelThreads(1);
        properties.setToolThreads(1);
        return new AgentRuntimeSchedulers(properties);
    }
}
