package com.inneragent.agent.kernel;

@FunctionalInterface
public interface AgentKernelModelFactory {
    OwnedChatModel create(AgentKernelSpec spec);
}
