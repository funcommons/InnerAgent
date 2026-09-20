package com.inneragent.agent.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.agent.kernel.AgentKernelSpec;
import com.inneragent.agent.kernel.AgentKernelSpecFactory;
import com.inneragent.agent.tool.AgentScopeToolSchema;
import com.inneragent.agent.tool.PlatformSubAgentRunPort;
import com.inneragent.agent.run.RunLeaseGuard;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class AgentScopeSubAgentToolAdapterTests {

    @Test
    void durableChildRunToolAllowsParallelInvocations() {
        AiAgentDefinition.SubAgentToolDef definition =
                AiAgentDefinition.SubAgentToolDef.builder()
                        .toolName("episode_scene_writer")
                        .description("Parse one episode")
                        .parametersSchema("{\"type\":\"object\"}")
                        .refAgentType("episode_scene_writer")
                        .build();
        ObjectMapper objectMapper = new ObjectMapper();

        AgentScopeSubAgentToolAdapter adapter = new AgentScopeSubAgentToolAdapter(
                definition,
                mock(AgentKernelSpec.class),
                AgentScopeToolSchema.prepareSubAgent(
                        objectMapper,
                        definition.getParametersSchema(),
                        definition.getToolName()),
                mock(AgentKernelSpecFactory.class),
                () -> mock(PlatformSubAgentRunPort.class),
                mock(RunLeaseGuard.class),
                objectMapper);

        assertThat(adapter.isConcurrencySafe()).isTrue();
        assertThat(adapter.isReadOnly()).isFalse();
    }
}
