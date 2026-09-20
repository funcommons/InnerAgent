package com.inneragent.agent.context;

import com.inneragent.agent.permission.ToolExecutionMode;

import java.util.Objects;

/** Exact AgentScope tool policy selected for the current conversation. */
public record ToolPermissionContext(ToolExecutionMode mode) {

    public ToolPermissionContext {
        mode = Objects.requireNonNull(mode, "mode must not be null");
    }
}
