package com.inneragent.agent.context;

public record ProjectContext(Long projectId) {

    public ProjectContext {
        projectId = ContextValues.requirePositive(projectId, "projectId");
    }
}
