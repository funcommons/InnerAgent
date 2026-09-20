package com.inneragent.agent.run.model;

import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import io.agentscope.core.message.Msg;

import java.util.List;
import java.util.Objects;

public record StartAgentExecutionCommand(
        StartedAgentRun run,
        List<Msg> messages,
        AgentKernelSnapshot kernelSnapshot,
        AgentKernelSpec kernelSpec,
        AgentScopeRuntimeContextRequest runtimeContextRequest) {

    public StartAgentExecutionCommand {
        run = Objects.requireNonNull(run, "run must not be null");
        messages = List.copyOf(Objects.requireNonNull(messages, "messages must not be null"));
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("messages must not be empty");
        }
        kernelSnapshot = Objects.requireNonNull(kernelSnapshot, "kernelSnapshot must not be null");
        kernelSpec = Objects.requireNonNull(kernelSpec, "kernelSpec must not be null");
        runtimeContextRequest = Objects.requireNonNull(
                runtimeContextRequest, "runtimeContextRequest must not be null");
    }
}
