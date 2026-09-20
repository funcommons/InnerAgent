package com.inneragent.agent.run.model;

import com.inneragent.agent.context.AgentScopeRuntimeContextRequest;
import com.inneragent.agent.run.kernel.AgentKernelSnapshot;
import io.agentscope.core.message.Msg;

import java.util.List;
import java.util.Objects;

public record ResumeAgentExecutionCommand(
        ResumedAgentRun run,
        List<Msg> messages,
        AgentKernelSnapshot kernelSnapshot,
        AgentScopeRuntimeContextRequest runtimeContextRequest) {

    public ResumeAgentExecutionCommand {
        run = Objects.requireNonNull(run, "run must not be null");
        messages = List.copyOf(Objects.requireNonNull(messages, "messages must not be null"));
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("messages must not be empty");
        }
        kernelSnapshot = Objects.requireNonNull(kernelSnapshot, "kernelSnapshot must not be null");
        runtimeContextRequest = Objects.requireNonNull(
                runtimeContextRequest, "runtimeContextRequest must not be null");
    }
}
