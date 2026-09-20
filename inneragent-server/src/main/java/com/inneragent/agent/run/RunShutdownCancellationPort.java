package com.inneragent.agent.run;

import reactor.core.publisher.Mono;

@FunctionalInterface
public interface RunShutdownCancellationPort {
    Mono<Void> request(String runId);
}
