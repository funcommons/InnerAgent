package com.inneragent.agent.run;

import com.inneragent.agent.run.model.AgentEventEnvelope;
import com.inneragent.agent.run.model.CommittedAgentEvent;
import reactor.core.publisher.Mono;

import java.util.Optional;

/** Owner-fenced reactive event journal. */
public interface AgentEventJournal {

    Mono<Optional<CommittedAgentEvent>> appendOwned(
            String runId,
            String ownerInstanceId,
            long ownerEpoch,
            AgentEventEnvelope event);
}
