package com.inneragent.agent.run;

import com.fasterxml.jackson.databind.node.TextNode;
import com.inneragent.agent.entity.AgentEvent;
import com.inneragent.agent.mapper.AgentEventMapper;
import com.inneragent.agent.mapper.AgentRunMapper;
import com.inneragent.agent.runtime.AgentRuntimeSchedulers;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Claims committed outbox rows briefly and publishes Redis wake-up hints. */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentEventOutboxPublisher {

    private static final int MAX_BATCH_SIZE = 500;
    private static final int MAX_OWNER_PREFIX_LENGTH = 95;
    private static final int MAX_ERROR_LENGTH = 1024;
    private static final Duration CLAIM_LEASE = Duration.ofSeconds(30);
    private static final long MIN_RETRY_MILLIS = 100;
    private static final long MAX_RETRY_MILLIS = 30_000;

    /**
     * [O-1] 批内 Redis 唤醒的并发度。Lettuce 反应式连接对未决命令在同一
     * TCP 连接上天然按 pipeline 复用,flatMap 并发订阅即等效批量发布——
     * 单批 200 行的唤醒从 200 次串行往返收敛为 ~2 波并发往返。上限同时
     * 约束单批在途命令数,避免积压洪峰打满 Redis 连接。
     */
    private static final int WAKEUP_PIPELINE_CONCURRENCY = 128;

    private final AgentEventMapper eventMapper;
    private final AgentRunMapper runMapper;
    private final PlatformTransactionManager transactionManager;
    private final AgentRunRedisSignalService signals;
    private final AgentEventEnvelopeSanitizer sanitizer;
    private final AgentRuntimeSchedulers schedulers;
    private AgentRuntimeMetrics metrics = AgentRuntimeMetrics.noop();

    @Autowired
    void setMetrics(AgentRuntimeMetrics metrics) {
        this.metrics = java.util.Objects.requireNonNull(
                metrics, "metrics must not be null");
    }

    /**
     * [O-1] 批量发布三段式:认领(单条批量 UPDATE)→ 批内唤醒并行派发
     * (Lettuce pipeline)→ 整批一次 UPDATE ack;失败个体回退逐条退避,
     * 单事件失败不拖死整批。语义与旧逐条路径一致(at-least-once、
     * 30s 租约守卫、退避与脱敏),批内主要往返从 O(n) 降到 O(常数)。
     */
    public Mono<Void> publishBatch(String owner, int limit) {
        String claimToken = claimToken(owner);
        int safeLimit = requireLimit(limit);
        return Mono.fromCallable(() -> claim(claimToken, safeLimit))
                .subscribeOn(schedulers.journal())
                .flatMap(claimed -> publishClaimed(claimToken, claimed))
                .then(refreshBacklog());
    }

    private Mono<Void> publishClaimed(String claimToken, List<AgentEvent> claimed) {
        if (claimed.isEmpty()) {
            return Mono.empty();
        }
        return dispatchWakeups(claimed)
                .flatMap(outcomes -> settle(claimToken, outcomes))
                .then();
    }

    /** 批内唤醒并行派发;逐事件错误隔离为 {@link WakeupOutcome}。 */
    private Mono<List<WakeupOutcome>> dispatchWakeups(List<AgentEvent> claimed) {
        return Flux.fromIterable(claimed)
                .flatMap(this::dispatchWakeup, WAKEUP_PIPELINE_CONCURRENCY)
                .collectList();
    }

    private Mono<WakeupOutcome> dispatchWakeup(AgentEvent event) {
        // defer:runId/sequence 校验同步抛出时也退化为单事件失败,不中断整批
        return Mono.defer(() ->
                        signals.publishWakeup(event.getRunId(), event.getSequenceNo()))
                .thenReturn(new WakeupOutcome(event, null))
                .onErrorResume(failure ->
                        Mono.just(new WakeupOutcome(event, failure)));
    }

    private Mono<Void> settle(String claimToken, List<WakeupOutcome> outcomes) {
        List<AgentEvent> published = outcomes.stream()
                .filter(WakeupOutcome::succeeded)
                .map(WakeupOutcome::event)
                .toList();
        List<WakeupOutcome> failed = outcomes.stream()
                .filter(outcome -> !outcome.succeeded())
                .toList();
        return acknowledgePublished(claimToken, published)
                .then(releaseFailedWakeups(claimToken, failed));
    }

    /** 成功路径一次 UPDATE ... IN;返回行数不足(租约被抢)时回退逐条判定。 */
    private Mono<Void> acknowledgePublished(
            String claimToken, List<AgentEvent> published) {
        if (published.isEmpty()) {
            return Mono.empty();
        }
        return Mono.fromCallable(() -> eventMapper.markPublishedBatch(
                        claimToken, eventIds(published)))
                .subscribeOn(schedulers.journal())
                .flatMap(updated -> updated == published.size()
                        ? Mono.<Void>empty()
                        : acknowledgeIndividually(claimToken, published))
                .then();
    }

    /** 旧逐条 ack 路径:仅在批量返回行数不符时触发。 */
    private Mono<Void> acknowledgeIndividually(
            String claimToken, List<AgentEvent> published) {
        return Flux.fromIterable(published)
                .concatMap(event -> markPublished(event.getId(), claimToken)
                        .flatMap(marked -> marked
                                ? Mono.<Void>empty()
                                : Mono.error(
                                        new OutboxClaimLostException(event.getId())))
                        .onErrorResume(failure ->
                                releaseForRetryAndLog(event, claimToken, failure)))
                .then();
    }

    private Mono<Void> releaseFailedWakeups(
            String claimToken, List<WakeupOutcome> failed) {
        return Flux.fromIterable(failed)
                .concatMap(outcome -> releaseForRetryAndLog(
                        outcome.event(), claimToken, outcome.failure()))
                .then();
    }

    private Mono<Void> releaseForRetryAndLog(
            AgentEvent event, String claimToken, Throwable failure) {
        return releaseForRetry(event, claimToken, failure)
                .doOnNext(released -> logPublishFailure(
                        event.getId(), failure, released))
                .onErrorResume(releaseFailure -> {
                    log.error(
                            "Agent outbox retry release failed: eventId={}, type={}",
                            event.getId(),
                            releaseFailure.getClass().getSimpleName());
                    return Mono.empty();
                })
                .then();
    }

    private List<AgentEvent> claim(String claimToken, int limit) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        List<AgentEvent> claimed = transaction.execute(
                ignored -> claimTransaction(claimToken, limit));
        if (claimed == null) {
            throw new IllegalStateException("Agent outbox claim transaction returned no result");
        }
        return claimed;
    }

    private List<AgentEvent> claimTransaction(String claimToken, int limit) {
        LocalDateTime databaseNow = runMapper.selectDatabaseNow();
        List<AgentEvent> candidates = new ArrayList<>(limit);
        candidates.addAll(eventMapper.selectPendingPublishCandidatesForUpdate(
                databaseNow, limit));
        int remaining = limit - candidates.size();
        if (remaining > 0) {
            candidates.addAll(eventMapper.selectExpiredPublishCandidatesForUpdate(
                    databaseNow, remaining));
        }
        if (candidates.isEmpty()) {
            return List.of();
        }
        LocalDateTime claimUntil = databaseNow.plus(CLAIM_LEASE);
        // [O-1] 行已在同事务内 FOR UPDATE 锁定,一次 UPDATE ... IN 完成整批
        // 认领;守卫与旧逐行 UPDATE 一致,行数不符即回滚(防御分支)。
        List<Long> candidateIds = eventIds(candidates);
        int claimedCount = eventMapper.claimPublishCandidatesBatch(
                claimToken, claimUntil, databaseNow, candidateIds);
        if (claimedCount != candidates.size()) {
            throw new IllegalStateException(
                    "Agent outbox claim changed while its row was locked: claimed="
                            + claimedCount + ", expected=" + candidates.size());
        }
        for (AgentEvent event : candidates) {
            event.setPublishStatus("CLAIMED");
            event.setPublishClaimOwner(claimToken);
            event.setPublishClaimUntil(claimUntil);
            event.setPublishAttempts(event.getPublishAttempts() + 1);
            event.setNextPublishAttemptAt(null);
        }
        return List.copyOf(candidates);
    }

    private Mono<Boolean> markPublished(long eventId, String claimToken) {
        return Mono.fromCallable(() ->
                        eventMapper.markPublished(eventId, claimToken) == 1)
                .subscribeOn(schedulers.journal());
    }

    private Mono<Boolean> releaseForRetry(
            AgentEvent event,
            String claimToken,
            Throwable failure) {
        metrics.outboxRetry();
        return Mono.fromCallable(() -> {
                    LocalDateTime databaseNow = runMapper.selectDatabaseNow();
                    LocalDateTime nextAttempt = databaseNow.plusNanos(
                            retryDelayMillis(
                                    event.getId(), event.getPublishAttempts())
                                    * 1_000_000L);
                    return eventMapper.releasePublishForRetry(
                            event.getId(),
                            claimToken,
                            nextAttempt,
                            sanitizeFailure(failure)) == 1;
                })
                .subscribeOn(schedulers.journal());
    }

    private Mono<Void> refreshBacklog() {
        return Mono.fromCallable(eventMapper::countOutstandingPublish)
                .subscribeOn(schedulers.journal())
                .doOnNext(metrics::outboxBacklog)
                .then();
    }

    private long retryDelayMillis(long eventId, int attempts) {
        int exponent = Math.min(8, Math.max(0, attempts - 1));
        long base = Math.min(MAX_RETRY_MILLIS, MIN_RETRY_MILLIS << exponent);
        long jitterRange = Math.max(1, Math.min(base, MAX_RETRY_MILLIS - base + 1));
        long mixed = eventId * 0x9E3779B97F4A7C15L
                ^ Integer.toUnsignedLong(attempts * 0x85EBCA6B);
        long jitter = Math.floorMod(mixed, jitterRange);
        return Math.min(MAX_RETRY_MILLIS, base + jitter);
    }

    private String sanitizeFailure(Throwable failure) {
        String message = failure == null || failure.getMessage() == null
                || failure.getMessage().isBlank()
                ? failure == null ? "Outbox publish failed" : failure.getClass().getSimpleName()
                : failure.getMessage();
        String safe = sanitizer.sanitize(TextNode.valueOf(message)).asText();
        return safe.length() <= MAX_ERROR_LENGTH
                ? safe
                : safe.substring(0, MAX_ERROR_LENGTH);
    }

    private void logPublishFailure(long eventId, Throwable failure, boolean released) {
        log.warn(
                "Agent outbox publish failed: eventId={}, type={}, retryReleased={}",
                eventId,
                failure == null ? "unknown" : failure.getClass().getSimpleName(),
                released);
    }

    private String claimToken(String owner) {
        if (owner == null || owner.isBlank()) {
            throw new IllegalArgumentException("owner must not be blank");
        }
        if (owner.length() > MAX_OWNER_PREFIX_LENGTH
                || !StandardCharsets.US_ASCII.newEncoder().canEncode(owner)) {
            throw new IllegalArgumentException(
                    "owner must be at most " + MAX_OWNER_PREFIX_LENGTH
                            + " ASCII characters");
        }
        return owner + ':' + UUID.randomUUID().toString().replace("-", "");
    }

    private int requireLimit(int limit) {
        if (limit <= 0 || limit > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException(
                    "limit must be between 1 and " + MAX_BATCH_SIZE);
        }
        return limit;
    }

    private static List<Long> eventIds(List<AgentEvent> events) {
        return events.stream().map(AgentEvent::getId).toList();
    }

    /** 单事件唤醒结果:成功为 null failure;失败携带异常供逐条退避回退。 */
    private record WakeupOutcome(AgentEvent event, Throwable failure) {

        boolean succeeded() {
            return failure == null;
        }
    }

    private static final class OutboxClaimLostException extends IllegalStateException {

        private OutboxClaimLostException(long eventId) {
            super("Agent outbox claim was lost for eventId=" + eventId);
        }
    }
}
