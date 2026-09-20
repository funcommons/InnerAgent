package com.inneragent.agent.run.kernel;

import com.inneragent.agent.kernel.AgentKernelSpec;

public interface AgentKernelSnapshotBuilder {

    AgentKernelSnapshot build(AgentKernelSnapshotPayload payload);

    AgentKernelSnapshot build(AgentKernelSpec spec);
}
