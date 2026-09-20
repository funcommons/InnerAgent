package com.inneragent.agent.kernel;

import io.agentscope.core.tool.Toolkit;

@FunctionalInterface
public interface AgentKernelToolRegistry {
    AgentKernelToolkitResources register(AgentKernelSpec spec, Toolkit toolkit);
}
