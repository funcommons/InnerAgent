package com.inneragent.agent.run;

import com.inneragent.agent.run.model.CommittedAgentEvent;
import com.inneragent.agent.run.model.RunTerminalRequest;
import com.inneragent.agent.run.model.SystemTerminalActor;
import reactor.core.publisher.Mono;

import java.util.Optional;

/** Reactive boundary for owner-fenced and allow-listed system terminal CAS operations. */
public interface RunTerminalCoordinator {

    Mono<Optional<CommittedAgentEvent>> terminateOwned(
            RunTerminalRequest request,
            String ownerInstanceId,
            long ownerEpoch);

    Mono<Optional<CommittedAgentEvent>> terminateSystem(
            RunTerminalRequest request,
            SystemTerminalActor actor);
}
