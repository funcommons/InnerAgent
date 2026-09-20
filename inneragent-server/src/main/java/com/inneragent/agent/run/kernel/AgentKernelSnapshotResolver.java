package com.inneragent.agent.run.kernel;

import java.util.List;

public interface AgentKernelSnapshotResolver {

    AgentKernelSnapshot resolve(
            String persistedCanonicalJson,
            String persistedFingerprint,
            long currentModelConfigVersion,
            List<ToolManifestSnapshot> currentTools);
}
