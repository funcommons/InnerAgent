package com.inneragent.agent.kernel;

@FunctionalInterface
public interface AgentKernelToolkitResources extends AutoCloseable {

    static AgentKernelToolkitResources none() {
        return () -> { };
    }

    @Override
    void close();
}
