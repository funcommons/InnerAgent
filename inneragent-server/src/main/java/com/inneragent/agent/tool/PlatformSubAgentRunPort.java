package com.inneragent.agent.tool;

import reactor.core.publisher.Mono;

public interface PlatformSubAgentRunPort {

    Mono<PlatformSubAgentRun> start(PlatformSubAgentCommand command);

    Mono<PlatformSubAgentRun> awaitCompletion(PlatformSubAgentRun childRun);

    Mono<Void> cancelChildren(String parentRunId);
}
