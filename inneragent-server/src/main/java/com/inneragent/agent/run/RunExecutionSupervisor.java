package com.inneragent.agent.run;

import com.inneragent.agent.run.model.ExecutionStopReason;
import com.inneragent.agent.run.model.ResumeAgentExecutionCommand;
import com.inneragent.agent.run.model.StartAgentExecutionCommand;
import reactor.core.publisher.Mono;

public interface RunExecutionSupervisor extends AgentRuntimeShutdownPort {

    Mono<Void> start(StartAgentExecutionCommand command);

    Mono<Void> resume(ResumeAgentExecutionCommand command);

    Mono<Boolean> interruptOwned(
            String runId,
            String ownerInstanceId,
            long ownerEpoch,
            ExecutionStopReason reason);
}
