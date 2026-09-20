package com.inneragent.agent.run;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

/** Periodically drains the durable event outbox so SSE subscribers receive wakeups. */
@Component
@Slf4j
public final class AgentEventOutboxScheduler {

    private static final int BATCH_SIZE = 200;

    private final AgentEventOutboxPublisher publisher;
    private final AgentRuntimeInstanceIdentity instanceIdentity;
    private final AtomicBoolean running = new AtomicBoolean();

    public AgentEventOutboxScheduler(
            AgentEventOutboxPublisher publisher,
            AgentRuntimeInstanceIdentity instanceIdentity) {
        this.publisher = Objects.requireNonNull(publisher, "publisher must not be null");
        this.instanceIdentity = Objects.requireNonNull(
                instanceIdentity, "instanceIdentity must not be null");
    }

    @Scheduled(
            initialDelayString =
                    "${fusion.agentscope.v2.execution.outbox-initial-delay-ms:1000}",
            fixedDelayString =
                    "${fusion.agentscope.v2.execution.outbox-delay-ms:500}")
    public void publish() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        publisher.publishBatch(instanceIdentity.value(), BATCH_SIZE)
                .doFinally(ignored -> running.set(false))
                .subscribe(
                        ignored -> { },
                        failure -> log.error(
                                "Agent outbox publish failed: type={}",
                                failure.getClass().getSimpleName(),
                                failure));
    }
}
