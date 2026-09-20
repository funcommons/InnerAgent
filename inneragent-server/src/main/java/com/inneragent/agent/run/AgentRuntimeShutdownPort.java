package com.inneragent.agent.run;

import reactor.core.publisher.Mono;

import java.time.Duration;

public interface AgentRuntimeShutdownPort {
    Mono<Void> shutdown(Duration drainTimeout);
}
